"""
Standalone evaluation - v2. Fixed: removed conf=0.15 filter from mAP calculation.
mAP should be computed without a hard confidence cutoff (standard practice) -
Ultralytics' default (conf=None) internally sweeps thresholds correctly.
The conf=0.15 filter is appropriate for live inference/deployment, not for
reporting benchmark mAP.
"""

from pathlib import Path
import json
from ultralytics import YOLO

BASE_DIR = Path(".")
LEBANON_DIR = BASE_DIR / "data" / "lebanon_photos"
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

BASELINE_MODEL = BASE_DIR / "models" / "rdd2022_baseline" / "weights" / "best.pt"
dataset_yaml = LEBANON_DIR / "dataset.yaml"

candidates = list(BASE_DIR.glob("**/rdd2022_lebanon_finetuned/weights/best.pt"))
if not candidates:
    print("ERROR: Could not find fine-tuned best.pt")
    exit(1)
finetuned_model_path = candidates[0]
print(f"Found fine-tuned model at: {finetuned_model_path}")

print("\n" + "=" * 60)
print("Evaluating BASELINE model (no conf filter - standard mAP)")
print("=" * 60)
model_base = YOLO(str(BASELINE_MODEL))
metrics_base = model_base.val(data=str(dataset_yaml), split='val', device='cpu')
baseline_result = {
    'model': 'baseline_rdd2022',
    'mAP50': float(metrics_base.box.map50),
    'mAP50-95': float(metrics_base.box.map),
    'precision': float(metrics_base.box.mp),
    'recall': float(metrics_base.box.mr),
}
print(f"\nBaseline: {baseline_result}")

print("\n" + "=" * 60)
print("Evaluating FINE-TUNED model (no conf filter - standard mAP)")
print("=" * 60)
model_ft = YOLO(str(finetuned_model_path))
metrics_ft = model_ft.val(data=str(dataset_yaml), split='val', device='cpu')
finetuned_result = {
    'model': 'finetuned_lebanon',
    'mAP50': float(metrics_ft.box.map50),
    'mAP50-95': float(metrics_ft.box.map),
    'precision': float(metrics_ft.box.mp),
    'recall': float(metrics_ft.box.mr),
}
print(f"\nFine-tuned: {finetuned_result}")

comparison = {'baseline': baseline_result, 'finetuned': finetuned_result}
out_path = RESULTS_DIR / "lebanon_comparison_v2_standard_map.json"
with open(out_path, 'w') as f:
    json.dump(comparison, f, indent=2)

print("\n" + "=" * 60)
print("FINAL COMPARISON (standard mAP, no conf cutoff)")
print("=" * 60)
print(f"{'Metric':<15} {'Baseline':<12} {'Fine-tuned':<12} {'Change':<10}")
for key in ['mAP50', 'mAP50-95', 'precision', 'recall']:
    b = baseline_result[key]
    ft = finetuned_result[key]
    print(f"{key:<15} {b:<12.4f} {ft:<12.4f} {ft-b:+.4f}")

print(f"\nSaved to: {out_path}")
print("\nNote: this is the standard/academic mAP (no confidence cutoff).")
print("For live-app practical detection, a conf threshold (e.g. 0.15-0.5) still applies at inference time.")