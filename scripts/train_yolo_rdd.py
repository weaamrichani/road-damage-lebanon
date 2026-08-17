"""
RDD2022 YOLOv8 Training Pipeline - Fixed for actual dataset structure.

Real structure discovered:
  RDD2022_all_countries/
    Japan/Japan/test/images/         <- no annotations
    Czech/Czech/test/images/
    Czech/Czech/train/images/
    Czech/Czech/train/annotations/xmls/
    (Japan has no train folder - test only!)
"""

import os
import shutil
import random
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml
from ultralytics import YOLO


BASE_DIR = Path(".")
RDD_ROOT = BASE_DIR / "data" / "datasets" / "RDD2022_all_countries"
YOLO_DIR = BASE_DIR / "data" / "datasets" / "RDD2022_YOLO"
MODELS_DIR = BASE_DIR / "models"

CLASS_MAP = {
    'D00': 0,  # Longitudinal crack
    'D10': 1,  # Transverse crack
    'D20': 2,  # Alligator crack
    'D40': 3   # Pothole
}

CLASS_NAMES = {
    0: 'Longitudinal Crack',
    1: 'Transverse Crack',
    2: 'Alligator Crack',
    3: 'Pothole'
}


def convert_bbox_to_yolo(xmin, ymin, xmax, ymax, img_w, img_h):
    cx = ((xmin + xmax) / 2) / img_w
    cy = ((ymin + ymax) / 2) / img_h
    w  = (xmax - xmin) / img_w
    h  = (ymax - ymin) / img_h
    return cx, cy, w, h


def parse_xml(xml_path):
    """Parse PascalVOC XML, return list of (class_id, cx, cy, w, h)."""
    labels = []
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()

        size = root.find('size')
        if size is None:
            return labels
        img_w = int(size.find('width').text)
        img_h = int(size.find('height').text)
        if img_w == 0 or img_h == 0:
            return labels

        for obj in root.findall('object'):
            name = obj.find('name').text
            if name not in CLASS_MAP:
                continue
            bb = obj.find('bndbox')
            xmin = float(bb.find('xmin').text)
            ymin = float(bb.find('ymin').text)
            xmax = float(bb.find('xmax').text)
            ymax = float(bb.find('ymax').text)
            cx, cy, w, h = convert_bbox_to_yolo(xmin, ymin, xmax, ymax, img_w, img_h)
            labels.append((CLASS_MAP[name], cx, cy, w, h))
    except Exception as e:
        print(f"  Warning: could not parse {xml_path}: {e}")
    return labels


def prepare_dataset(train_split=0.85):
    """
    Scan all country folders for train splits with annotations.
    Convert to YOLO format and split into train/val.
    """
    print("=" * 60)
    print("STEP 1: Scanning RDD2022 for annotated training data")
    print("=" * 60)

    all_pairs = []  # (image_path, xml_path)

    for country_outer in sorted(RDD_ROOT.iterdir()):
        if not country_outer.is_dir():
            continue

        # Handle double-nested structure: Japan/Japan/, Czech/Czech/, etc.
        country_inner = country_outer / country_outer.name
        if not country_inner.exists():
            country_inner = country_outer  # fallback if not nested

        train_dir = country_inner / "train"
        if not train_dir.exists():
            print(f"  Skipping {country_outer.name}: no train folder")
            continue

        images_dir = train_dir / "images"
        annot_dir  = train_dir / "annotations" / "xmls"

        if not images_dir.exists() or not annot_dir.exists():
            print(f"  Skipping {country_outer.name}: missing images or annotations")
            continue

        count = 0
        for xml_file in annot_dir.glob("*.xml"):
            img_file = images_dir / (xml_file.stem + ".jpg")
            if img_file.exists():
                all_pairs.append((img_file, xml_file))
                count += 1

        print(f"  {country_outer.name}: {count} annotated images found")

    print(f"\nTotal annotated images: {len(all_pairs)}")

    if len(all_pairs) == 0:
        print("\nERROR: No annotated images found!")
        print("Check that your dataset has train/annotations/xmls/ folders.")
        return False

    # Create YOLO directory structure
    for split in ["train", "val"]:
        (YOLO_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (YOLO_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    # Shuffle and split
    random.seed(42)
    random.shuffle(all_pairs)
    split_idx = int(len(all_pairs) * train_split)
    splits = {
        "train": all_pairs[:split_idx],
        "val":   all_pairs[split_idx:]
    }

    print(f"\nSplit: {len(splits['train'])} train / {len(splits['val'])} val")
    print("\nConverting annotations to YOLO format...")

    total_converted = 0
    total_skipped = 0

    for split_name, pairs in splits.items():
        for img_path, xml_path in pairs:
            labels = parse_xml(xml_path)

            # Copy image
            dest_img = YOLO_DIR / "images" / split_name / img_path.name
            shutil.copy(img_path, dest_img)

            # Write label file (even if empty — YOLO needs it)
            dest_lbl = YOLO_DIR / "labels" / split_name / (img_path.stem + ".txt")
            if labels:
                with open(dest_lbl, "w") as f:
                    for cls_id, cx, cy, w, h in labels:
                        f.write(f"{cls_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}\n")
                total_converted += 1
            else:
                dest_lbl.touch()  # empty label = background image
                total_skipped += 1

    print(f"  Converted: {total_converted} | Background/empty: {total_skipped}")

    # Write dataset.yaml
    dataset_cfg = {
        'path': str(YOLO_DIR.resolve()),
        'train': 'images/train',
        'val':   'images/val',
        'nc': 4,
        'names': CLASS_NAMES
    }
    yaml_path = YOLO_DIR / "dataset.yaml"
    with open(yaml_path, "w") as f:
        yaml.dump(dataset_cfg, f, default_flow_style=False, allow_unicode=True)

    print(f"\nDataset config written: {yaml_path}")
    print("\nSTEP 1 COMPLETE ✓")
    return True


def train_model(model_size="m", epochs=50, batch=16, device=0):
    """Train YOLOv8 on the prepared dataset."""
    yaml_path = YOLO_DIR / "dataset.yaml"
    if not yaml_path.exists():
        print("ERROR: Run prepare_dataset() first.")
        return

    print("\n" + "=" * 60)
    print(f"STEP 2: Training YOLOv8{model_size} for {epochs} epochs")
    print("=" * 60)
    print(f"  Batch size: {batch} | Device: {device}")
    print("  This will take 2-4 hours on GPU, longer on CPU.")
    print("  Training output will appear below...\n")

    model = YOLO(f"yolov8{model_size}.pt")
    results = model.train(
        data=str(yaml_path),
        epochs=epochs,
        imgsz=640,
        batch=batch,
        device=device,
        project=str(MODELS_DIR),
        name="rdd2022_baseline",
        patience=10,
        save=True,
        verbose=True,
        exist_ok=True,
    )

    best = MODELS_DIR / "rdd2022_baseline" / "weights" / "best.pt"
    print(f"\nSTEP 2 COMPLETE ✓")
    print(f"Best model saved at: {best}")
    return results


def quick_test(image_path=None):
    """Run inference on a sample image to verify the model works."""
    best = MODELS_DIR / "rdd2022_baseline" / "weights" / "best.pt"
    if not best.exists():
        print("No trained model found. Train first.")
        return

    # Use a random val image if no path given
    if image_path is None:
        val_images = list((YOLO_DIR / "images" / "val").glob("*.jpg"))
        if not val_images:
            print("No val images found.")
            return
        image_path = str(random.choice(val_images))

    print(f"\nRunning inference on: {image_path}")
    model = YOLO(str(best))
    results = model.predict(source=image_path, conf=0.5, imgsz=640, verbose=True)

    for r in results:
        if r.boxes is not None and len(r.boxes):
            print(f"\nDetected {len(r.boxes)} damage instance(s):")
            for box, conf, cls in zip(r.boxes.xyxy, r.boxes.conf, r.boxes.cls):
                print(f"  {CLASS_NAMES[int(cls)]} — confidence: {float(conf):.2f}")
        else:
            print("No damage detected in this image.")


if __name__ == "__main__":
    print("RDD2022 YOLOv8 Training Pipeline")
    print("=" * 60)

    # Step 1: Convert dataset
    ok = prepare_dataset(train_split=0.85)
    if not ok:
        exit(1)

    # Step 2: Train
    # Use device=0 for GPU, device='cpu' for CPU
    # Reduce batch to 8 if you get out-of-memory errors
    train_model(model_size="s", epochs=50, batch=8, device='cpu')

    # Step 3: Quick sanity check
    quick_test()