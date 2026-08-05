/**
 * Next.js API Route: POST /api/upload
 * Place this file at: webapp/app/api/upload/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Detection {
  damage_class: string;
  class_name: string;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

async function runYoloInference(imagePath: string): Promise<Detection[]> {
  return new Promise((resolve, reject) => {
    const modelPath = join(process.cwd(), '..', 'models', 'rdd2022_baseline', 'weights', 'best.pt');
    const python = spawn('python', [
      join(process.cwd(), '..', 'scripts', 'inference.py'),
      '--image', imagePath,
      '--model', modelPath,
      '--output-format', 'json',
    ]);

    let output = '';
    python.stdout.on('data', (data) => { output += data.toString(); });
    python.on('close', (code) => {
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          resolve(result.detections ?? []);
        } catch {
          reject(new Error('Failed to parse inference output'));
        }
      } else {
        reject(new Error(`Inference script exited with code ${code}`));
      }
    });
    python.on('error', reject);
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const photo = formData.get('photo') as File | null;
    const latStr = formData.get('latitude') as string | null;
    const lonStr = formData.get('longitude') as string | null;
    const userEmail = formData.get('userEmail') as string | null;
    const notes = formData.get('notes') as string | null;

    if (!photo) {
      return NextResponse.json({ success: false, message: 'No photo provided' }, { status: 400 });
    }
    if (!latStr || !lonStr) {
      return NextResponse.json({ success: false, message: 'Missing location' }, { status: 400 });
    }

    const latitude = parseFloat(latStr);
    const longitude = parseFloat(lonStr);

    // ── 1. Save to temp file for inference ──
    const bytes = await photo.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const tempPath = join(tmpdir(), `upload_${Date.now()}_${photo.name}`);
    await writeFile(tempPath, buffer);

    // ── 2. Upload to Supabase Storage ──
    const storagePath = `uploads/${Date.now()}_${photo.name}`;
    const { error: storageError } = await supabase.storage
      .from('road-photos')
      .upload(storagePath, buffer, { contentType: photo.type });

    if (storageError) {
      return NextResponse.json(
        { success: false, message: `Storage error: ${storageError.message}` },
        { status: 500 }
      );
    }

    // ── 3. Run YOLOv8 inference ──
    let detections: Detection[] = [];
    try {
      detections = await runYoloInference(tempPath);
    } catch (err: unknown) {
      console.warn('Inference failed (model not trained yet?):', err);
      // Continue without detections — still save the photo
    }

    // ── 4. Insert photo record ──
    const { data: photoData, error: photoError } = await supabase
      .from('photo_uploads')
      .insert([{
        file_url: storagePath,
        latitude,
        longitude,
        user_email: userEmail ?? null,
        notes: notes ?? null,
        is_validated: false,
      }])
      .select()
      .single();

    if (photoError || !photoData) {
      return NextResponse.json(
        { success: false, message: `DB error: ${photoError?.message}` },
        { status: 500 }
      );
    }

    // ── 5. Insert detection records ──
    if (detections.length > 0) {
      const detectionRows = detections.map((det) => ({
        photo_id: photoData.id,
        damage_class: det.damage_class,
        confidence: det.confidence,
        bbox_x1: det.bbox.x1,
        bbox_y1: det.bbox.y1,
        bbox_x2: det.bbox.x2,
        bbox_y2: det.bbox.y2,
      }));
      await supabase.from('road_damage_detections').insert(detectionRows);
    }

    return NextResponse.json({
      success: true,
      message: `Uploaded! Detected ${detections.length} damage instance(s).`,
      photo_id: photoData.id as string,
      detections,
      segment_id: null as string | null,
      priority_score: null as number | null,
      priority_tier: null as number | null,
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}