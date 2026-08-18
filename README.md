# Zefet — An AI-powered Road Damage Detection And Repair Prioritization For Lebanon

Built as a capstone project for the **LebNet Tech Fellows Program — AI for Lebanon**.

Zefet detects potholes and cracks from reported photos submitted by users, where each photo is geolocated according to the damaged location. It computes a priority score that is weighted based on severity, giving Lebanese municipalities and civil-society groups an evidence-based tool for deciding which roads to repair first.

---

## The Problem

Lebanon's economic crisis has coincided with a sharp decline in road maintenance. Potholes and cracking are widespread, but there's no centralized, evidence-based system for tracking road condition — complaints reach municipalities informally or not at all, and repair prioritization is largely for this purpose.

## The Approach

1. **Baseline model** — YOLOv8m trained on [RDD2022](https://figshare.com/articles/dataset/RDD2022_-_The_multi-national_Road_Damage_Dataset_released_through_CRDDC_2022/21431547), a peer-reviewed multi-national road damage dataset (30,224 images across 6 countries), achieving **mAP50 = 0.674**.
2. **Domain gap testing** — the baseline was tested against real Lebanese road photos, revealing that pothole detection transferred reasonably well, while crack detection collapsed to near-zero confidence.
3. **Local fine-tuning** — the model was fine-tuned in two iterative rounds on 50 self-collected, hand-labeled Lebanese photos using frozen-backbone transfer learning, closing the domain gap significantly (overall mAP50 on the Lebanese validation set improved from 0.102 → 0.230, with longitudinal crack detection improving ~37×).
4. **Deployment** — the fine-tuned model powers a full-stack web dashboard where anyone can upload a photo, see it scored and pinned on an interactive map, and browse reports by priority tier.


## Features

- 📸 Upload a geotagged road photo (device GPS or manual coordinates)
- 🤖 Automatic damage detection (pothole, longitudinal & transverse crack, alligator crack)
- 📊 Severity-weighted priority scoring (Urgent / High / Monitor tiers)
- 🗺️ Interactive map with severity-graded pins
- 📋 Per-report damage breakdown, photo, and reporter notes
- ❓ Built-in FAQ covering safe photo-taking practices

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Model** | YOLOv8m (Ultralytics), PyTorch |
| **Training** | Google Colab Pro, NVIDIA A100 GPU |
| **Annotation** | Roboflow |
| **Backend** | Next.js API routes (Node.js), Python inference subprocess |
| **Database** | Supabase (PostgreSQL + Storage) |
| **Frontend** | Next.js 16, TypeScript, Tailwind CSS, react-leaflet |

---

## Project Structure

```
road-damage-lebanon/
├── data/
│   └── lebanon_photos/       # 50 hand-labeled Lebanese road photos
│       ├── raw/              # Original photos
│       ├── images/           # Train/val split (YOLO format)
│       └── labels/           # YOLO-format annotations
├── models/                   # Trained model weights (not tracked — see below)
├── scripts/
│   ├── train_yolo_rdd.py     # Baseline training on RDD2022
│   ├── finetune_lebanon.py   # Fine-tuning on Lebanese data
│   ├── eval_finetuned.py     # Baseline vs. fine-tuned evaluation
│   ├── inference.py          # Single-image inference
│   └── priority_scorer.py    # Priority scoring logic (Python reference)
├── results/                  # Evaluation metrics (JSON)
├── webapp/                   # Next.js dashboard
│   └── app/
│       ├── api/upload/       # Photo upload + inference endpoint
│       ├── api/segments/     # Priority scoring + map data endpoint
│       └── components/       # RoadHealthDashboard.tsx
└── data.yaml                 # Class definitions (YOLO format)
```

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/weaamrichani/road-damage-lebanon.git
cd road-damage-lebanon

python -m venv venv
venv\Scripts\activate          # Windows
pip install ultralytics opencv-python pillow pyyaml numpy --break-system-packages

cd webapp
npm install
```

### 2. Configure Supabase

Create a [Supabase](https://supabase.com) project, run the schema (see `scripts/` for table definitions), and add your keys to `webapp/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Train or download a model

Either run the training pipeline yourself:
```bash
python scripts/train_yolo_rdd.py       # Baseline (requires RDD2022 dataset)
python scripts/finetune_lebanon.py     # Fine-tune on the included Lebanese data
```
or place a pre-trained `best.pt` at `models/rdd2022_lebanon_finetuned/weights/best.pt`.

### 4. Run the app

```bash
cd webapp
npm run dev
```

Visit `http://localhost:3000`.

---

## Dataset Attribution

- **RDD2022**: Arya, D., Maeda, H., Ghosh, S. K., Toshniwal, D., & Sekimoto, Y. (2022). Released via CRDDC'2022 / IEEE BigData Cup.
- **Lebanese road photos**: self-collected and hand-labeled for this project.
- **Map tiles**: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

This project was built for educational purposes as part of the LebNet Tech Fellows Program. RDD2022 is used under CC BY 4.0.