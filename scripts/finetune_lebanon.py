"""
Fine-tune RDD2022 baseline model on Lebanese road photos - v2 (fixed).

Fixes from v1:
- Remaps Lebanese class IDs (alligator-crack=0, crack=1, pothole=2) to match
  the baseline model's RDD2022 class order (Longitudinal=0, Transverse=1,
  Alligator=2, Pothole=3), so evaluation compares like-for-like classes.
  'crack' (Lebanese) is mapped to 'Longitudinal Crack' (baseline class 0) as
  a reasonable default since Roboflow didn't distinguish longitudinal/transverse.
- Uses device='cpu' explicitly (no CUDA available on this machine).
"""

from pathlib import Path
import json
import shutil
import yaml
from ultralytics import YOLO

BASE_DIR = Path(".")
LEBANON_DIR = BASE_DIR / "data" / "lebanon_photos"
MODELS_DIR = BASE_DIR / "models"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

BASELINE_MODEL = MODELS_DIR / "rdd2022_baseline" / "weights" / "best.pt"

# Baseline model's class order (must match training script / RDD2022)
BASELINE_CLASS_NAMES = {
    0: 'Longitudinal Crack',
    1: 'Transverse Crack',
    2: 'Alligator Crack',
    3: 'Pothole',
}

# Roboflow's Lebanese class order -> baseline class ID
# (alligator-crack=0, crack=1, pothole=2 in Roboflow export)
LEBANON_TO_BASELINE_ID = {
    0: 2,  # alligator-crack -> Alligator Crack
    1: 0,  # crack           -> Longitudinal Crack (best default; no long/trans distinction made)
    2: 3,  # pothole         -> Pothole
}


def remap_labels(split: str):
    """Rewrite label .txt files in-place, remapping class IDs to baseline scheme."""
    labels_dir = LEBANON_DIR / "labels" / split
    remapped_count = 0
    for label_file in labels_dir.glob("*.txt"):
        lines = label_file.read_text().strip().splitlines()
        new_lines = []
        for line in lines:
            if not line.strip():
                continue
            parts = line.split()
            old_id = int(parts[0])
            new_id = LEBANON_TO_BASELINE_ID.get(old_id, old_id)
            new_lines.append(" ".join([str(new_id)] + parts[1:]))
        label_file.write_text("\n".join(new_lines) + ("\n" if new_lines else ""))
        remapped_count += 1
    print(f"  Remapped {remapped_count} label files in {split}/")


def write_lebanon_dataset_yaml():
    """Write dataset.yaml using the BASELINE's 4-class scheme (after remapping labels)."""
    cfg = {
        'path': str(LEBANON_DIR.resolve()),
        'train': 'images/train',
        'val': 'images/val',
        'nc': 4,
        'names': BASELINE_CLASS_NAMES,
    }
    yaml_path = LEBANON_DIR / "dataset.yaml"
    with open(yaml_path, 'w') as f:
        yaml.dump(cfg, f, default_flow_style=False)
    print(f"Lebanese dataset config written (4-class, baseline-aligned): {yaml_path}")
    return yaml_path


def evaluate_baseline(dataset_yaml):
    print("\n" + "=" * 60)
    print("STEP 1: Evaluating BASELINE model on Lebanese val set")
    print("=" * 60)

    if not BASELINE_MODEL.exists():
        print(f"ERROR: baseline model not found at {BASELINE_MODEL}")
        return None

    model = YOLO(str(BASELINE_MODEL))
    metrics = model.val(data=str(dataset_yaml), conf=0.15, split='val', device='cpu')

    result = {
        'model': 'baseline_rdd2022',
        'mAP50': float(metrics.box.map50),
        'mAP50-95': float(metrics.box.map),
        'precision': float(metrics.box.mp),
        'recall': float(metrics.box.mr),
    }
    print(f"\nBaseline results: {result}")
    return result


def finetune_on_lebanon(dataset_yaml, epochs=30, batch=4):
    print("\n" + "=" * 60)
    print(f"STEP 2: Fine-tuning on Lebanese data ({epochs} epochs, CPU)")
    print("=" * 60)
    print("NOTE: only 22 training images — this will still take a while on CPU.")
    print("This is normal for a small fine-tuning set; the point is the before/after comparison.\n")

    model = YOLO(str(BASELINE_MODEL))
    results = model.train(
        data=str(dataset_yaml),
        epochs=epochs,
        imgsz=640,
        batch=batch,
        device='cpu',
        project=str(MODELS_DIR),
        name="rdd2022_lebanon_finetuned",
        patience=15,
        save=True,
        exist_ok=True,
        lr0=0.001,
        freeze=10,
    )
    print("\nFine-tuning complete!")
    return results


def evaluate_finetuned(dataset_yaml):
    print("\n" + "=" * 60)
    print("STEP 3: Evaluating FINE-TUNED model on Lebanese val set")
    print("=" * 60)

    finetuned_model = MODELS_DIR / "rdd2022_lebanon_finetuned" / "weights" / "best.pt"
    if not finetuned_model.exists():
        print(f"ERROR: fine-tuned model not found at {finetuned_model}")
        return None

    model = YOLO(str(finetuned_model))
    metrics = model.val(data=str(dataset_yaml), conf=0.15, split='val', device='cpu')

    result = {
        'model': 'finetuned_lebanon',
        'mAP50': float(metrics.box.map50),
        'mAP50-95': float(metrics.box.map),
        'precision': float(metrics.box.mp),
        'recall': float(metrics.box.mr),
    }
    print(f"\nFine-tuned results: {result}")
    return result


def main():
    print("Lebanon Domain Adaptation: Baseline vs Fine-tuned Comparison (v2 - fixed)")
    print("=" * 60)

    print("\nRemapping Lebanese labels to match baseline class order...")
    remap_labels("train")
    remap_labels("val")

    dataset_yaml = write_lebanon_dataset_yaml()

    baseline_result = evaluate_baseline(dataset_yaml)
    finetune_on_lebanon(dataset_yaml, epochs=30, batch=4)
    finetuned_result = evaluate_finetuned(dataset_yaml)

    comparison = {
        'baseline': baseline_result,
        'finetuned': finetuned_result,
    }
    out_path = RESULTS_DIR / "lebanon_comparison.json"
    with open(out_path, 'w') as f:
        json.dump(comparison, f, indent=2)

    print("\n" + "=" * 60)
    print("FINAL COMPARISON")
    print("=" * 60)
    if baseline_result and finetuned_result:
        print(f"{'Metric':<15} {'Baseline':<12} {'Fine-tuned':<12} {'Change':<10}")
        for key in ['mAP50', 'mAP50-95', 'precision', 'recall']:
            b = baseline_result[key]
            ft = finetuned_result[key]
            change = ft - b
            print(f"{key:<15} {b:<12.4f} {ft:<12.4f} {change:+.4f}")
    print(f"\nSaved to: {out_path}")
    print("\nUse these numbers in your report's Results section!")


if __name__ == "__main__":
    main()