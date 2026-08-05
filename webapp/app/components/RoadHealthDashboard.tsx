'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface RoadSegment {
  id: string;
  name: string;
  region: string;
  road_type: string;
  priority_tier: 1 | 2 | 3;
  composite_priority: number;
  damage_count: number;
  pothole_score: number;
  alligator_score: number;
  repair_reasoning: string;
  latitude?: number;
  longitude?: number;
}

interface Detection {
  damage_class: string;
  confidence: number;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

const PRIORITY_COLORS: Record<1 | 2 | 3, string> = {
  1: '#dc2626',
  2: '#ea580c',
  3: '#10b981',
};

const PRIORITY_LABELS: Record<1 | 2 | 3, string> = {
  1: '🔴 URGENT',
  2: '🟡 HIGH',
  3: '🟢 MONITOR',
};

const TIER_BORDER: Record<1 | 2 | 3, string> = {
  1: 'border-l-red-600',
  2: 'border-l-orange-500',
  3: 'border-l-green-500',
};

export default function RoadHealthDashboard() {
  const [segments, setSegments] = useState<RoadSegment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<RoadSegment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [activeTab, setActiveTab] = useState<'urgent' | 'high'>('urgent');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchSegments = async () => {
      try {
        const response = await fetch('/api/segments');
        if (!response.ok) return;
        const data = await response.json();
        setSegments(data);
      } catch (error) {
        console.error('Failed to fetch segments:', error);
      }
    };
    fetchSegments();
  }, []);

  const getUserLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
      });
    }
  };

  const handlePhotoUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userLocation) {
      alert('Please click "Get Location" first.');
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData(event.currentTarget);
      formData.append('latitude', userLocation[0].toString());
      formData.append('longitude', userLocation[1].toString());
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await response.json();
      if (response.ok) {
        alert(`✅ Uploaded! Detected ${result.detections?.length ?? 0} damage instances.`);
        // Refresh segments
        const refreshed = await fetch('/api/segments');
        if (refreshed.ok) setSegments(await refreshed.json());
      } else {
        alert('❌ Upload failed. Try again.');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('❌ Error uploading photo.');
    } finally {
      setIsUploading(false);
    }
  };

  const urgentSegments = segments.filter((s) => s.priority_tier === 1).slice(0, 5);
  const highSegments = segments.filter((s) => s.priority_tier === 2).slice(0, 5);
  const displayedSegments = activeTab === 'urgent' ? urgentSegments : highSegments;

  return (
    <div className="flex h-screen bg-slate-100 font-sans">
      {/* ── LEFT SIDEBAR ── */}
      <div className="w-96 bg-white shadow-lg overflow-y-auto flex flex-col">
        <div className="p-5 border-b">
          <h1 className="text-xl font-bold text-slate-900">🚗 Road Health Map</h1>
          <p className="text-xs text-slate-500 mt-1">
            Lebanon road damage detection &amp; repair prioritisation
          </p>
        </div>

        {/* Upload card */}
        <div className="p-4 border-b bg-blue-50">
          <p className="font-semibold text-sm text-blue-800 mb-3">📸 Report Road Damage</p>
          <form onSubmit={handlePhotoUpload} className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              name="photo"
              accept="image/*"
              required
              className="w-full text-xs border rounded px-2 py-1.5 bg-white"
            />
            <input
              type="email"
              name="userEmail"
              placeholder="Email (optional)"
              className="w-full text-xs border rounded px-2 py-1.5"
            />
            <textarea
              name="notes"
              placeholder="Notes (optional)"
              className="w-full text-xs border rounded px-2 py-1.5 h-14 resize-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={getUserLocation}
                className="text-xs border rounded px-3 py-1.5 bg-white hover:bg-slate-50"
              >
                📍 Get Location
              </button>
              {userLocation && (
                <span className="text-xs text-green-600 font-medium">✓ Location set</span>
              )}
            </div>
            <button
              type="submit"
              disabled={isUploading}
              className="w-full text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded py-2 font-semibold"
            >
              {isUploading ? 'Uploading...' : 'Upload Photo'}
            </button>
          </form>
        </div>

        {/* Priority tabs */}
        <div className="flex border-b text-xs font-semibold">
          <button
            onClick={() => setActiveTab('urgent')}
            className={`flex-1 py-2 ${activeTab === 'urgent' ? 'border-b-2 border-red-600 text-red-600' : 'text-slate-500'}`}
          >
            🔴 Urgent ({urgentSegments.length})
          </button>
          <button
            onClick={() => setActiveTab('high')}
            className={`flex-1 py-2 ${activeTab === 'high' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-slate-500'}`}
          >
            🟡 High ({highSegments.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {displayedSegments.length === 0 ? (
            <p className="text-xs text-slate-400 text-center mt-6">No data yet — upload photos to populate the map.</p>
          ) : (
            displayedSegments.map((seg) => (
              <div
                key={seg.id}
                onClick={() => setSelectedSegment(seg)}
                className={`cursor-pointer border-l-4 ${TIER_BORDER[seg.priority_tier]} rounded bg-white shadow-sm p-3 hover:shadow-md transition-shadow ${selectedSegment?.id === seg.id ? 'ring-1 ring-blue-400' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <p className="font-semibold text-sm text-slate-800 truncate w-48">{seg.name}</p>
                  <span
                    className="text-xs font-bold text-white px-2 py-0.5 rounded"
                    style={{ backgroundColor: PRIORITY_COLORS[seg.priority_tier] }}
                  >
                    {seg.composite_priority.toFixed(0)}/100
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{seg.region} · {seg.road_type}</p>
                <p className="text-xs text-slate-600 mt-1">⚠️ {seg.damage_count} damages detected</p>
              </div>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedSegment && (
          <div className="border-t p-4 bg-slate-50">
            <div className="flex justify-between items-start mb-2">
              <p className="font-bold text-sm text-slate-900 w-56 leading-tight">{selectedSegment.name}</p>
              <button onClick={() => setSelectedSegment(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>
            <p className="text-xs mb-3">{PRIORITY_LABELS[selectedSegment.priority_tier]}</p>

            {/* Score bar */}
            <p className="text-xs text-slate-500 mb-1">Priority Score</p>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-2 bg-slate-200 rounded flex-1">
                <div
                  className="h-2 rounded transition-all"
                  style={{
                    width: `${selectedSegment.composite_priority}%`,
                    backgroundColor: PRIORITY_COLORS[selectedSegment.priority_tier],
                  }}
                />
              </div>
              <span className="text-sm font-bold">{selectedSegment.composite_priority.toFixed(1)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3 text-center">
              <div className="bg-white rounded p-2 shadow-sm">
                <p className="text-lg font-bold text-red-600">{selectedSegment.pothole_score.toFixed(0)}</p>
                <p className="text-xs text-slate-500">Pothole Score</p>
              </div>
              <div className="bg-white rounded p-2 shadow-sm">
                <p className="text-lg font-bold text-orange-600">{selectedSegment.alligator_score.toFixed(0)}</p>
                <p className="text-xs text-slate-500">Alligator Cracks</p>
              </div>
            </div>

            <div className="bg-white rounded p-2 shadow-sm mb-3">
              <p className="text-xs font-semibold text-slate-600 mb-1">Why this priority?</p>
              <p className="text-xs text-slate-700 leading-relaxed">{selectedSegment.repair_reasoning}</p>
            </div>

            <button className="w-full text-xs bg-slate-800 hover:bg-slate-700 text-white rounded py-2 font-semibold">
              📧 Notify Municipality
            </button>
          </div>
        )}
      </div>

      {/* ── MAP ── */}
      <div className="flex-1 relative">
        <MapContainer
          center={[33.8547, 35.8623]}
          zoom={10}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {segments
            .filter((s) => s.latitude && s.longitude)
            .map((segment) => (
              <CircleMarker
                key={segment.id}
                center={[segment.latitude!, segment.longitude!]}
                radius={10}
                pathOptions={{
                  fillColor: PRIORITY_COLORS[segment.priority_tier],
                  color: '#fff',
                  weight: 2,
                  fillOpacity: 0.9,
                }}
                eventHandlers={{ click: () => setSelectedSegment(segment) }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold">{segment.name}</p>
                    <p>{PRIORITY_LABELS[segment.priority_tier]}</p>
                    <p>Score: {segment.composite_priority.toFixed(1)}/100</p>
                    <p>{segment.damage_count} damages detected</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-6 left-6 bg-white rounded-lg shadow-lg p-4 z-[1000]">
          <p className="font-semibold text-xs text-slate-700 mb-2">Priority Legend</p>
          <div className="space-y-1.5 text-xs">
            {([1, 2, 3] as const).map((tier) => (
              <div key={tier} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[tier] }} />
                <span className="text-slate-600">{PRIORITY_LABELS[tier]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
