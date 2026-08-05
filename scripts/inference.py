#!/usr/bin/env python3
"""
YOLOv8 Inference Script

Called by Next.js API route to run detection on a single image.
Outputs JSON with detections.

Usage:
  python inference.py --image path/to/image.jpg --model path/to/best.pt --output-format json
"""

import argparse
import json
import sys
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description='Run YOLOv8 inference on road image')
    parser.add_argument('--image', required=True, help='Path to input image')
    parser.add_argument('--model', required=True, help='Path to YOLOv8 model weights')
    parser.add_argument('--output-format', default='json', help='Output format (json or verbose)')
    parser.add_argument('--conf', type=float, default=0.5, help='Confidence threshold')
    
    args = parser.parse_args()
    
    # Validate inputs
    if not Path(args.image).exists():
        print(json.dumps({
            'error': f'Image file not found: {args.image}'
        }), file=sys.stdout)
        sys.exit(1)
    
    if not Path(args.model).exists():
        print(json.dumps({
            'error': f'Model file not found: {args.model}'
        }), file=sys.stdout)
        sys.exit(1)
    
    try:
        # Load model
        model = YOLO(args.model)
        
        # Run inference
        results = model.predict(
            source=args.image,
            conf=args.conf,
            imgsz=640,
            verbose=False
        )
        
        # Parse detections
        detections = []
        class_names = {
            0: 'Longitudinal Crack',
            1: 'Transverse Crack',
            2: 'Alligator Crack',
            3: 'Pothole'
        }
        damage_classes = {
            0: 'D00',
            1: 'D10',
            2: 'D20',
            3: 'D40'
        }
        
        for result in results:
            if result.boxes is not None:
                for box, conf, cls_id in zip(result.boxes.xyxy, result.boxes.conf, result.boxes.cls):
                    x1, y1, x2, y2 = [float(v) for v in box.tolist()]
                    class_id = int(cls_id)
                    
                    detections.append({
                        'damage_class': damage_classes.get(class_id, 'Unknown'),
                        'damage_class_id': class_id,
                        'class_name': class_names.get(class_id, 'Unknown'),
                        'confidence': float(conf),
                        'bbox': {
                            'x1': x1,
                            'y1': y1,
                            'x2': x2,
                            'y2': y2
                        }
                    })
        
        # Output results
        output = {
            'success': True,
            'image': args.image,
            'detection_count': len(detections),
            'detections': detections
        }
        
        if args.output_format == 'json':
            print(json.dumps(output))
        else:
            print(f"Image: {args.image}")
            print(f"Detections: {len(detections)}")
            for i, det in enumerate(detections, 1):
                print(f"  {i}. {det['class_name']} (confidence: {det['confidence']:.2f})")
        
        sys.exit(0)
    
    except Exception as e:
        error_output = {
            'success': False,
            'error': str(e)
        }
        print(json.dumps(error_output), file=sys.stdout)
        sys.exit(1)


if __name__ == '__main__':
    main()
