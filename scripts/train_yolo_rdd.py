"""
Road Damage Detection (RDD2022) - YOLOv8 Training Pipeline
Trains YOLOv8 on RDD2022 dataset and supports fine-tuning on Lebanese road photos.

Setup:
  pip install ultralytics opencv-python pillow torch torchvision torchaudio
"""

import os
import json
import shutil
from pathlib import Path
from typing import Dict, List, Tuple
import cv2
from PIL import Image
import numpy as np

from ultralytics import YOLO


class RDD2022Pipeline:
    """Manage RDD2022 dataset, training, and inference."""
    
    def __init__(self, base_dir: str = "./rdd_project"):
        self.base_dir = Path(base_dir)
        self.data_dir = self.base_dir / "data"
        self.datasets_dir = self.data_dir / "datasets"
        self.models_dir = self.base_dir / "models"
        self.lebanon_dir = self.data_dir / "lebanon_photos"
        self.outputs_dir = self.base_dir / "outputs"
        
        # Create directories
        for d in [self.data_dir, self.datasets_dir, self.models_dir, self.lebanon_dir, self.outputs_dir]:
            d.mkdir(parents=True, exist_ok=True)
    
    def download_rdd2022(self):
        """
        Download RDD2022 dataset from Figshare.
        Requires ~2GB disk space.
        
        Manual steps:
        1. Visit: https://figshare.com/articles/dataset/RDD2022_-_The_multi-national_Road_Damage_Dataset_released_through_CRDDC_2022/21431547
        2. Download the dataset zip files
        3. Extract to: {base_dir}/data/datasets/RDD2022_all_countries/
        
        Or use command line (requires curl):
          cd {datasets_dir}
          curl -L -o RDD2022.zip "https://figshare.com/ndownloader/articles/21431547/versions/1"
          unzip RDD2022.zip
        """
        print("📥 RDD2022 Download Instructions:")
        print(f"   1. Go to: https://figshare.com/articles/dataset/RDD2022_-_The_multi-national_Road_Damage_Dataset_released_through_CRDDC_2022/21431547")
        print(f"   2. Download the dataset")
        print(f"   3. Extract to: {self.datasets_dir}/RDD2022_all_countries/")
        print()
        print(f"Expected structure:")
        print(f"  {self.datasets_dir}/RDD2022_all_countries/")
        print(f"    ├── Japan/")
        print(f"    ├── India/")
        print(f"    ├── Czech/")
        print(f"    ├── Norway/")
        print(f"    ├── United_States/")
        print(f"    └── China_Drone/")
    
    def prepare_yolo_dataset(self, countries: List[str] = None, train_split: float = 0.8):
        """
        Convert RDD2022 PascalVOC annotations to YOLO format.
        
        Args:
            countries: List of country folders to include. If None, uses all.
            train_split: Fraction for training (rest goes to val)
        """
        if countries is None:
            countries = ['Japan', 'India', 'Czech', 'Norway', 'United_States', 'China_Drone']
        
        rdd_root = self.datasets_dir / "RDD2022_all_countries"
        if not rdd_root.exists():
            print(f"❌ RDD2022 dataset not found at {rdd_root}")
            print("   Run download_rdd2022() and extract the dataset first.")
            return
        
        yolo_dataset_dir = self.datasets_dir / "RDD2022_YOLO"
        yolo_dataset_dir.mkdir(exist_ok=True)
        
        # Create train/val split
        (yolo_dataset_dir / "images" / "train").mkdir(parents=True, exist_ok=True)
        (yolo_dataset_dir / "images" / "val").mkdir(parents=True, exist_ok=True)
        (yolo_dataset_dir / "labels" / "train").mkdir(parents=True, exist_ok=True)
        (yolo_dataset_dir / "labels" / "val").mkdir(parents=True, exist_ok=True)
        
        # Class mapping (RDD2022)
        class_map = {
            'D00': 0,  # Longitudinal crack
            'D10': 1,  # Transverse crack
            'D20': 2,  # Alligator crack
            'D40': 3   # Pothole
        }
        
        all_images = []
        
        # Scan all countries
        for country in countries:
            country_path = rdd_root / country / "train"
            if not country_path.exists():
                print(f"⚠️  Skipping {country} (not found)")
                continue
            
            images_dir = country_path / "images"
            annotations_dir = country_path / "annotations" / "xmls"
            
            if not images_dir.exists() or not annotations_dir.exists():
                print(f"⚠️  Skipping {country} (missing images or annotations)")
                continue
            
            print(f"📍 Processing {country}...")
            
            # Collect all image-annotation pairs
            for xml_file in annotations_dir.glob("*.xml"):
                img_name = xml_file.stem + ".jpg"
                img_path = images_dir / img_name
                
                if img_path.exists():
                    all_images.append((img_path, xml_file))
        
        print(f"✅ Found {len(all_images)} images with annotations")
        
        # Split train/val
        split_idx = int(len(all_images) * train_split)
        train_images = all_images[:split_idx]
        val_images = all_images[split_idx:]
        
        print(f"   Train: {len(train_images)}, Val: {len(val_images)}")
        
        # Convert annotations
        for split_name, split_images in [("train", train_images), ("val", val_images)]:
            for img_path, xml_path in split_images:
                # Copy image
                dest_img = yolo_dataset_dir / "images" / split_name / img_path.name
                shutil.copy(img_path, dest_img)
                
                # Parse XML and convert to YOLO format
                yolo_labels = []
                try:
                    import xml.etree.ElementTree as ET
                    tree = ET.parse(xml_path)
                    root = tree.getroot()
                    
                    # Get image size for normalization
                    size_elem = root.find('size')
                    img_width = int(size_elem.find('width').text)
                    img_height = int(size_elem.find('height').text)
                    
                    # Parse objects
                    for obj in root.findall('object'):
                        damage_type = obj.find('name').text
                        if damage_type not in class_map:
                            continue
                        
                        bbox = obj.find('bndbox')
                        xmin = float(bbox.find('xmin').text)
                        ymin = float(bbox.find('ymin').text)
                        xmax = float(bbox.find('xmax').text)
                        ymax = float(bbox.find('ymax').text)
                        
                        # Convert to YOLO format (center coords, normalized)
                        center_x = ((xmin + xmax) / 2) / img_width
                        center_y = ((ymin + ymax) / 2) / img_height
                        width = (xmax - xmin) / img_width
                        height = (ymax - ymin) / img_height
                        
                        class_id = class_map[damage_type]
                        yolo_labels.append(f"{class_id} {center_x} {center_y} {width} {height}")
                
                except Exception as e:
                    print(f"⚠️  Error parsing {xml_path}: {e}")
                    continue
                
                # Write YOLO label file
                label_file = yolo_dataset_dir / "labels" / split_name / (img_path.stem + ".txt")
                if yolo_labels:
                    with open(label_file, "w") as f:
                        f.write("\n".join(yolo_labels))
        
        # Write dataset.yaml for YOLO training
        dataset_yaml = {
            'path': str(yolo_dataset_dir),
            'train': 'images/train',
            'val': 'images/val',
            'nc': 4,
            'names': {
                0: 'Longitudinal Crack',
                1: 'Transverse Crack',
                2: 'Alligator Crack',
                3: 'Pothole'
            }
        }
        
        yaml_path = yolo_dataset_dir / "dataset.yaml"
        import yaml
        with open(yaml_path, 'w') as f:
            yaml.dump(dataset_yaml, f, default_flow_style=False)
        
        print(f"✅ YOLO dataset ready at {yolo_dataset_dir}")
        print(f"   Config: {yaml_path}")
    
    def train_model(self, model_size: str = "m", epochs: int = 50, batch_size: int = 16, device: int = 0):
        """
        Train YOLOv8 model on RDD2022.
        
        Args:
            model_size: 'n' (nano), 's' (small), 'm' (medium), 'l' (large)
            epochs: Training epochs
            batch_size: Batch size (reduce if OOM)
            device: GPU device ID (0 for default GPU, -1 for CPU)
        """
        yaml_path = self.datasets_dir / "RDD2022_YOLO" / "dataset.yaml"
        if not yaml_path.exists():
            print(f"❌ Dataset config not found. Run prepare_yolo_dataset() first.")
            return
        
        print(f"🚀 Training YOLOv8-{model_size} on RDD2022...")
        
        # Load model
        model = YOLO(f"yolov8{model_size}.pt")
        
        # Train
        results = model.train(
            data=str(yaml_path),
            epochs=epochs,
            imgsz=640,
            batch=batch_size,
            device=device,
            project=str(self.models_dir),
            name="rdd2022_baseline",
            patience=10,  # Early stopping
            save=True,
            verbose=True
        )
        
        print(f"✅ Training complete!")
        print(f"   Best model: {self.models_dir}/rdd2022_baseline/weights/best.pt")
        print(f"   Last model: {self.models_dir}/rdd2022_baseline/weights/last.pt")
        
        return results
    
    def finetune_on_lebanon(self, epochs: int = 20, batch_size: int = 8, base_model: str = "best.pt"):
        """
        Fine-tune the trained model on Lebanese road photos.
        
        First, add your labeled Lebanese photos to:
          {lebanon_photos_dir}/images/train/*.jpg
          {lebanon_photos_dir}/labels/train/*.txt (YOLO format)
          {lebanon_photos_dir}/images/val/*.jpg
          {lebanon_photos_dir}/labels/val/*.txt
        
        Then call this function.
        """
        lebanon_yaml = self._prepare_lebanon_dataset()
        if not lebanon_yaml:
            return
        
        model_path = self.models_dir / "rdd2022_baseline" / "weights" / base_model
        if not model_path.exists():
            print(f"❌ Base model not found: {model_path}")
            return
        
        print(f"🇱🇧 Fine-tuning on Lebanese road photos...")
        
        model = YOLO(str(model_path))
        
        results = model.train(
            data=str(lebanon_yaml),
            epochs=epochs,
            imgsz=640,
            batch=batch_size,
            device=0,
            project=str(self.models_dir),
            name="rdd2022_lebanon_finetuned",
            patience=5,
            save=True
        )
        
        print(f"✅ Fine-tuning complete!")
        print(f"   Best model: {self.models_dir}/rdd2022_lebanon_finetuned/weights/best.pt")
        
        return results
    
    def _prepare_lebanon_dataset(self) -> Path:
        """Prepare Lebanese dataset in YOLO format."""
        
        # Check structure
        train_images = list((self.lebanon_dir / "images" / "train").glob("*.jpg"))
        val_images = list((self.lebanon_dir / "images" / "val").glob("*.jpg"))
        
        if not train_images and not val_images:
            print(f"❌ No Lebanese photos found. Add images to:")
            print(f"   {self.lebanon_dir}/images/train/")
            print(f"   {self.lebanon_dir}/images/val/")
            return None
        
        print(f"📍 Lebanese dataset: {len(train_images)} train, {len(val_images)} val")
        
        # Write dataset.yaml
        dataset_yaml = {
            'path': str(self.lebanon_dir),
            'train': 'images/train',
            'val': 'images/val',
            'nc': 4,
            'names': {
                0: 'Longitudinal Crack',
                1: 'Transverse Crack',
                2: 'Alligator Crack',
                3: 'Pothole'
            }
        }
        
        yaml_path = self.lebanon_dir / "dataset.yaml"
        import yaml
        with open(yaml_path, 'w') as f:
            yaml.dump(dataset_yaml, f, default_flow_style=False)
        
        return yaml_path
    
    def infer_on_image(self, image_path: str, model_path: str = None, conf_threshold: float = 0.5) -> Dict:
        """
        Run inference on a single image.
        
        Returns:
            Dict with detections, boxes, confidences, class names
        """
        if model_path is None:
            model_path = self.models_dir / "rdd2022_baseline" / "weights" / "best.pt"
        
        if not Path(model_path).exists():
            print(f"❌ Model not found: {model_path}")
            return {}
        
        model = YOLO(str(model_path))
        
        results = model.predict(
            source=image_path,
            conf=conf_threshold,
            imgsz=640,
            verbose=False
        )
        
        # Parse results
        detections = []
        for result in results:
            if result.boxes is not None:
                for box, conf, cls_id in zip(result.boxes.xyxy, result.boxes.conf, result.boxes.cls):
                    x1, y1, x2, y2 = box.tolist()
                    class_names = {0: 'Longitudinal Crack', 1: 'Transverse Crack', 2: 'Alligator Crack', 3: 'Pothole'}
                    detections.append({
                        'class': class_names.get(int(cls_id), 'Unknown'),
                        'class_id': int(cls_id),
                        'confidence': float(conf),
                        'bbox': {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2}
                    })
        
        return {
            'image': image_path,
            'detections': detections,
            'detection_count': len(detections)
        }
    
    def batch_infer(self, image_dir: str, model_path: str = None, conf_threshold: float = 0.5) -> List[Dict]:
        """
        Run inference on all images in a directory.
        """
        image_paths = list(Path(image_dir).glob("*.jpg")) + list(Path(image_dir).glob("*.png"))
        
        results = []
        for i, img_path in enumerate(image_paths, 1):
            print(f"  [{i}/{len(image_paths)}] {img_path.name}...", end=' ', flush=True)
            result = self.infer_on_image(str(img_path), model_path, conf_threshold)
            results.append(result)
            print(f"✓ ({result['detection_count']} damages)")
        
        return results


def main():
    """
    Quick start example.
    """
    pipeline = RDD2022Pipeline(base_dir="./rdd_project")
    
    print("🚗 Road Damage Detection Pipeline")
    print("=" * 50)
    
    # Step 1: Download dataset
    print("\n1️⃣  DOWNLOAD DATASET")
    pipeline.download_rdd2022()
    input("   👉 Press Enter once you've extracted RDD2022 to the datasets folder...")
    
    # Step 2: Prepare YOLO format
    print("\n2️⃣  PREPARE DATASET")
    pipeline.prepare_yolo_dataset(
        countries=['Japan', 'India', 'Czech', 'Norway', 'United_States'],
        train_split=0.8
    )
    input("   👉 Press Enter to start training...")
    
    # Step 3: Train
    print("\n3️⃣  TRAIN YOLOV8")
    print("   This will take ~2-4 hours on GPU (adjust epochs/batch_size if slow)")
    pipeline.train_model(model_size="m", epochs=50, batch_size=16, device=0)
    
    # Step 4: Optional fine-tune on Lebanese photos
    print("\n4️⃣  (OPTIONAL) FINE-TUNE ON LEBANESE PHOTOS")
    print("   Add your Lebanese road photos to:")
    print(f"   {pipeline.lebanon_dir}/images/train/ and /val/")
    print(f"   With labels in: {pipeline.lebanon_dir}/labels/train/ and /val/")
    finetune_input = input("   Fine-tune now? (y/n): ").strip().lower()
    if finetune_input == 'y':
        pipeline.finetune_on_lebanon(epochs=20, batch_size=8)
    
    print("\n✅ Pipeline complete!")


if __name__ == "__main__":
    main()
