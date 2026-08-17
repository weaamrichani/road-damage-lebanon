/**
 * Next.js API Route: GET /api/segments
 * Place this file at: webapp/app/api/segments/route.ts
 *
 * v6: Returns a dynamic per-class breakdown (any damage class, not just
 * pothole/alligator) plus the user's notes, so the dashboard never has
 * silent gaps for classes it didn't hardcode a box for.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const DAMAGE_SEVERITY: Record<string, number> = {
  D00: 1.0,
  D10: 1.5,
  D20: 2.5,
  D40: 3.0,
};
const MAX_SEVERITY = 3.0;

const CLASS_NAMES: Record<string, string> = {
  D00: 'Longitudinal Crack',
  D10: 'Transverse Crack',
  D20: 'Alligator Crack',
  D40: 'Pothole',
};

function publicPhotoUrl(fileUrl: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/road-photos/${fileUrl}`;
}

export async function GET() {
  try {
    const { data: photos, error: photosError } = await supabase
      .from('photo_uploads')
      .select('id, latitude, longitude, notes, uploaded_at, file_url')
      .order('uploaded_at', { ascending: false });

    if (photosError) {
      return NextResponse.json({ error: photosError.message }, { status: 500 });
    }
    if (!photos || photos.length === 0) {
      return NextResponse.json([]);
    }

    const photoIds = photos.map((p) => p.id);
    const { data: detections, error: detError } = await supabase
      .from('road_damage_detections')
      .select('photo_id, damage_class, confidence')
      .in('photo_id', photoIds);

    if (detError) {
      return NextResponse.json({ error: detError.message }, { status: 500 });
    }

    const detectionsByPhoto: Record<string, typeof detections> = {};
    (detections ?? []).forEach((d) => {
      if (!detectionsByPhoto[d.photo_id]) detectionsByPhoto[d.photo_id] = [];
      detectionsByPhoto[d.photo_id].push(d);
    });

    const results = photos
      .filter((p) => p.latitude && p.longitude)
      .map((photo) => {
        const dets = detectionsByPhoto[photo.id] ?? [];

        const detectionScores = dets.map(
          (d) => ((DAMAGE_SEVERITY[d.damage_class] ?? 1) / MAX_SEVERITY) * d.confidence * 100
        );
        const worstScore = detectionScores.length > 0 ? Math.max(...detectionScores) : 0;
        const countBonus = dets.length > 1 ? Math.min((dets.length - 1) * 5, 20) : 0;
        const compositePriority = Math.max(0, Math.min(worstScore + countBonus, 100));

        let priorityTier = 3;
        if (compositePriority >= 60) priorityTier = 1;
        else if (compositePriority >= 35) priorityTier = 2;

        // Dynamic per-class breakdown: group detections by class, track
        // count and best confidence for each class actually present.
        const byClass: Record<string, { count: number; bestConfidence: number }> = {};
        dets.forEach((d) => {
          const key = d.damage_class;
          if (!byClass[key]) byClass[key] = { count: 0, bestConfidence: 0 };
          byClass[key].count += 1;
          byClass[key].bestConfidence = Math.max(byClass[key].bestConfidence, d.confidence);
        });
        const breakdown = Object.entries(byClass)
          .map(([damageClass, info]) => ({
            class_name: CLASS_NAMES[damageClass] ?? damageClass,
            count: info.count,
            confidence: Math.round(info.bestConfidence * 100),
          }))
          .sort((a, b) => b.count - a.count);

        const damageBreakdownText = dets
          .map((d) => `${CLASS_NAMES[d.damage_class] ?? d.damage_class} (${Math.round(d.confidence * 100)}%)`)
          .join(', ');

        return {
          id: photo.id,
          name: `Report near ${photo.latitude.toFixed(4)}, ${photo.longitude.toFixed(4)}`,
          region: 'Lebanon',
          road_type: 'reported',
          latitude: photo.latitude,
          longitude: photo.longitude,
          priority_tier: priorityTier,
          composite_priority: compositePriority,
          damage_count: dets.length,
          breakdown,
          repair_reasoning: dets.length > 0
            ? `Detected: ${damageBreakdownText}`
            : 'No damage detected in this photo',
          photo_url: photo.file_url ? publicPhotoUrl(photo.file_url) : null,
          notes: photo.notes ?? null,
        };
      });

    results.sort((a, b) => {
      if (a.priority_tier !== b.priority_tier) return a.priority_tier - b.priority_tier;
      return b.composite_priority - a.composite_priority;
    });

    return NextResponse.json(results);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}