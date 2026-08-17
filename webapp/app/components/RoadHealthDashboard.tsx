'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Popup, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

interface DamageBreakdownItem {
  class_name: string;
  count: number;
  confidence: number;
}

interface RoadSegment {
  id: string;
  name: string;
  region: string;
  road_type: string;
  priority_tier: 1 | 2 | 3;
  composite_priority: number;
  damage_count: number;
  breakdown: DamageBreakdownItem[];
  repair_reasoning: string;
  latitude?: number;
  longitude?: number;
  photo_url?: string | null;
  notes?: string | null;
}

const PRIORITY_COLORS: Record<1 | 2 | 3, string> = {
  1: '#D64545',
  2: '#DB7F2E',
  3: '#2E9E5B',
};

const PRIORITY_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Urgent',
  2: 'High',
  3: 'Monitor',
};

const TIER_BORDER: Record<1 | 2 | 3, string> = {
  1: 'border-l-[#D64545]',
  2: 'border-l-[#DB7F2E]',
  3: 'border-l-[#2E9E5B]',
};

const FAQ_ITEMS = [
  {
    q: 'How does this work?',
    a: 'Upload a photo of a damaged road, add its location, and a detection model scans it for potholes and cracks. Each report gets a priority score based on the type and severity of damage found, then appears as a pin on the map.',
  },
  {
    q: 'How do I take a photo that gives accurate results?',
    a: 'Stand a few steps from the damage and angle the camera down toward the road surface, filling as much of the frame with the damage as you can. Daylight works best. Avoid photos taken from a moving car or from very far away — the model needs a clear, close view to detect damage reliably.',
  },
  {
    q: 'How do I set the location?',
    a: 'Use "Use my location" if you\'re reporting damage where you\'re currently standing. If the photo was taken somewhere else, switch to "Enter manually" and paste in coordinates — long-press any spot in Google Maps to copy its coordinates.',
  },
  {
    q: 'How do I stay safe while taking a photo?',
    a: 'Never step into an active lane to take a photo. Park safely off the road, wait for a gap in traffic, and photograph from the shoulder or sidewalk whenever possible. If a road is busy, it\'s safer to note the location and come back on foot later.',
  },
];

function FaqModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-2000 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E7EB] sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-[#1A1D23]">Help &amp; safety</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[#5B6470] hover:text-[#1A1D23] text-xl leading-none w-7 h-7 flex items-center justify-center rounded hover:bg-[#F5F6F7]"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-5">
          {FAQ_ITEMS.map((item, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-[#1A1D23] mb-1">{item.q}</p>
              <p className="text-sm text-[#5B6470] leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RoadHealthDashboard() {
  const [segments, setSegments] = useState<RoadSegment[]>([]);
  const [selectedSegment, setSelectedSegment] = useState<RoadSegment | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [useManualLocation, setUseManualLocation] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');
  const [activeTab, setActiveTab] = useState<'urgent' | 'high' | 'monitor'>('urgent');
  const [showFaq, setShowFaq] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude]);
          setUseManualLocation(false);
          setIsLocating(false);
        },
        () => {
          alert('Could not get your location. Check location permissions and try again.');
          setIsLocating(false);
        }
      );
    }
  };

  // Deepens and darkens as the score climbs within its tier's range,
  // so a 96 reads as urgent much more strongly than a 61 does.
  const TIER_SCORE_RANGES: Record<1 | 2 | 3, [number, number]> = {
    1: [60, 100],
    2: [35, 59],
    3: [0, 34],
  };
  const TIER_HUES: Record<1 | 2 | 3, number> = { 1: 4, 2: 32, 3: 142 };

  const getPriorityColor = (tier: 1 | 2 | 3, score: number): string => {
    const [min, max] = TIER_SCORE_RANGES[tier];
    const t = Math.max(0, Math.min(1, (score - min) / (max - min || 1)));
    const saturation = 55 + t * 35;
    const lightness = 62 - t * 22;
    return `hsl(${TIER_HUES[tier]}, ${saturation}%, ${lightness}%)`;
  };

  const getActiveLocation = (): [number, number] | null => {
    if (useManualLocation) {
      const lat = parseFloat(manualLat);
      const lon = parseFloat(manualLon);
      if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
      return null;
    }
    return userLocation;
  };

  const handlePhotoUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const location = getActiveLocation();
    if (!location) {
      alert('Set a location first — either "Use my location" or enter coordinates manually.');
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData(event.currentTarget);
      formData.append('latitude', location[0].toString());
      formData.append('longitude', location[1].toString());
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await response.json();
      if (response.ok) {
        alert(`Uploaded. Detected ${result.detections?.length ?? 0} damage instance(s).`);
        formRef.current?.reset();
        setManualLat('');
        setManualLon('');
        const refreshed = await fetch('/api/segments');
        if (refreshed.ok) setSegments(await refreshed.json());
      } else {
        alert(`Upload failed: ${result.message ?? 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading photo.');
    } finally {
      setIsUploading(false);
    }
  };

  const urgentSegments = segments.filter((s) => s.priority_tier === 1).slice(0, 5);
  const highSegments = segments.filter((s) => s.priority_tier === 2).slice(0, 5);
  const monitorSegments = segments.filter((s) => s.priority_tier === 3).slice(0, 5);
  const displayedSegments =
    activeTab === 'urgent' ? urgentSegments : activeTab === 'high' ? highSegments : monitorSegments;
  const activeLocation = getActiveLocation();

  return (
    <div className="flex h-screen bg-[#F5F6F7] font-sans">
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-104 bg-white shadow-sm overflow-y-auto flex flex-col border-r border-[#E4E7EB]">
        {/* Header with road-marking signature stripe */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold font-rubik-vinyl text-[#1A1D23] tracking-widest">Zefet.</h1>
              <p className="text-xs text-[#5B6470] mt-0.5">
                Lebanese road damage detection &amp; repair prioritisation
              </p>
            </div>
            <button
              onClick={() => setShowFaq(true)}
              className="shrink-0 w-8 h-8 rounded-full border border-[#E4E7EB] text-[#5B6470] hover:text-[#1A1D23] hover:border-[#DB7F2E] text-sm font-semibold flex items-center justify-center transition-colors"
              aria-label="Help and safety information"
              title="Help & safety"
            >
              ?
            </button>
          </div>
        </div>
        {/* road-marking dashed divider */}
        <div
          className="h-0.75 w-full"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, #DB7F2E 0px, #DB7F2E 14px, transparent 14px, transparent 24px)',
          }}
        />

        {/* Upload card */}
        <div className="p-5 border-b border-[#E4E7EB]">
          <p className="font-semibold text-sm text-[#1A1D23] mb-3">Report road damage</p>
          <form ref={formRef} onSubmit={handlePhotoUpload} className="space-y-2.5">
            <input
              ref={fileInputRef}
              type="file"
              name="photo"
              accept="image/*"
              required
              className="w-full text-xs text-[#1A1D23] border border-[#D6DAE0] rounded-md px-3 py-2 bg-white file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-[#F5F6F7] file:text-xs file:font-medium file:text-[#1A1D23] file:cursor-pointer"
            />
            <textarea
              name="notes"
              placeholder="Notes (optional)"
              className="w-full text-sm text-[#1A1D23] placeholder-[#8A93A0] border border-[#D6DAE0] rounded-md px-3 py-2 h-16 resize-none focus:outline-none focus:ring-2 focus:ring-[#DB7F2E]/40 focus:border-[#DB7F2E]"
            />

            {/* Location section */}
            <div className="bg-[#F5F6F7] rounded-md p-3 border border-[#E4E7EB]">
              <div className="flex items-center gap-2 mb-2.5">
                <button
                  type="button"
                  onClick={() => setUseManualLocation(false)}
                  className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                    !useManualLocation
                      ? 'bg-[#1A1D23] text-white'
                      : 'bg-white text-[#5B6470] border border-[#D6DAE0]'
                  }`}
                >
                  Use my location
                </button>
                <button
                  type="button"
                  onClick={() => setUseManualLocation(true)}
                  className={`text-xs px-2.5 py-1.5 rounded font-medium transition-colors ${
                    useManualLocation
                      ? 'bg-[#1A1D23] text-white'
                      : 'bg-white text-[#5B6470] border border-[#D6DAE0]'
                  }`}
                >
                  Enter manually
                </button>
              </div>

              {!useManualLocation ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={getUserLocation}
                    disabled={isLocating}
                    className="text-xs border border-[#D6DAE0] rounded px-3 py-1.5 bg-white hover:bg-[#F5F6F7] disabled:bg-[#F5F6F7] disabled:text-[#8A93A0] text-[#1A1D23] font-medium flex items-center gap-1.5"
                  >
                    {isLocating && (
                      <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {isLocating ? 'Locating…' : 'Get location'}
                  </button>
                  {userLocation && !useManualLocation && (
                    <span className="text-xs text-[#2E9E5B] font-medium">
                      {userLocation[0].toFixed(4)}, {userLocation[1].toFixed(4)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Latitude"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    className="text-sm text-[#1A1D23] placeholder-[#8A93A0] border border-[#D6DAE0] rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#DB7F2E]/40"
                  />

                  <input
                    type="text"
                    placeholder="Longitude"
                    value={manualLon}
                    onChange={(e) => setManualLon(e.target.value)}
                    className="text-sm text-[#1A1D23] placeholder-[#8A93A0] border border-[#D6DAE0] rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#DB7F2E]/40"
                  />

                  <div className="col-span-2">
                    <p className="text-xs text-[#8A93A0] mt-2">
                      Tip: long-press a spot in Google Maps to copy its coordinates.
                    </p>
                  </div>
                </div>
                
              )}
            </div>

            <button
              type="submit"
              disabled={isUploading}
              className="w-full text-sm bg-[#1A1D23] hover:bg-[#2A2E37] disabled:bg-[#B3B8C0] text-white rounded-md py-2.5 font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {isUploading && (
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {isUploading ? 'Uploading… this may take a few minutes' : 'Upload photo'}
            </button>
          </form>
        </div>

        {/* Priority tabs */}
        <div className="flex border-b border-[#E4E7EB] text-sm font-medium">
          <button
            onClick={() => setActiveTab('urgent')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'urgent'
                ? 'border-b-2 border-[#D64545] text-[#D64545]'
                : 'text-[#8A93A0] hover:text-[#5B6470]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#D64545] inline-block" />
            Urgent ({urgentSegments.length})
          </button>
          <button
            onClick={() => setActiveTab('high')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'high'
                ? 'border-b-2 border-[#DB7F2E] text-[#DB7F2E]'
                : 'text-[#8A93A0] hover:text-[#5B6470]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#DB7F2E] inline-block" />
            High ({highSegments.length})
          </button>
          <button
            onClick={() => setActiveTab('monitor')}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'monitor'
                ? 'border-b-2 border-[#2E9E5B] text-[#2E9E5B]'
                : 'text-[#8A93A0] hover:text-[#5B6470]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#2E9E5B] inline-block" />
            Monitor ({monitorSegments.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {displayedSegments.length === 0 ? (
            <p className="text-sm text-[#8A93A0] text-center mt-8">
              No reports yet — upload a photo to populate the map.
            </p>
          ) : (
            displayedSegments.map((seg) => (
              <div
                key={seg.id}
                onClick={() => setSelectedSegment(seg)}
                className={`cursor-pointer border-l-[3px] ${TIER_BORDER[seg.priority_tier]} rounded-md bg-white shadow-sm p-3.5 hover:shadow-md transition-shadow ${
                  selectedSegment?.id === seg.id ? 'ring-2 ring-[#DB7F2E]/30' : ''
                }`}
              >
                <div className="flex justify-between items-start gap-2">
                  <p className="font-semibold text-sm text-[#1A1D23] truncate">{seg.name}</p>
                  <span
                    className="text-xs font-bold text-white px-2 py-0.5 rounded shrink-0"
                    style={{ backgroundColor: getPriorityColor(seg.priority_tier, seg.composite_priority) }}
                  >
                    {seg.composite_priority.toFixed(0)}
                  </span>
                </div>
                <p className="text-xs text-[#5B6470] mt-1">
                  {seg.damage_count} damage{seg.damage_count === 1 ? '' : 's'} detected
                </p>
              </div>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedSegment && (
          <div className="border-t border-[#E4E7EB] p-5 bg-white">
            <div className="flex justify-between items-start mb-2">
              <p className="font-bold text-sm text-[#1A1D23] w-64 leading-tight">{selectedSegment.name}</p>
              <button
                onClick={() => setSelectedSegment(null)}
                className="text-[#8A93A0] hover:text-[#1A1D23] text-lg leading-none"
                aria-label="Close details"
              >
                ×
              </button>
            </div>
            <p
              className="text-xs font-semibold mb-3"
              style={{ color: PRIORITY_COLORS[selectedSegment.priority_tier] }}
            >
              {PRIORITY_LABELS[selectedSegment.priority_tier]}
            </p>

            <p className="text-xs text-[#5B6470] mb-1">Priority score</p>
            <div className="flex items-center gap-2 mb-3">
              <div className="h-2 bg-[#E4E7EB] rounded flex-1">
                <div
                  className="h-2 rounded transition-all"
                  style={{
                    width: `${selectedSegment.composite_priority}%`,
                    backgroundColor: getPriorityColor(selectedSegment.priority_tier, selectedSegment.composite_priority),
                  }}
                />
              </div>
              <span className="text-sm font-bold text-[#1A1D23]">
                {selectedSegment.composite_priority.toFixed(1)}
              </span>
            </div>

            {selectedSegment.breakdown.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-[#5B6470] mb-1.5">Damage detected</p>
                <div className="space-y-1.5">
                  {selectedSegment.breakdown.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-[#F5F6F7] rounded-md px-3 py-2"
                    >
                      <span className="text-sm text-[#1A1D23] font-medium">
                        {item.class_name}
                        {item.count > 1 ? ` ×${item.count}` : ''}
                      </span>
                      <span className="text-xs text-[#5B6470]">{item.confidence}% confidence</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedSegment.notes && (
              <div className="bg-[#F5F6F7] rounded-md p-2.5 mb-3">
                <p className="text-xs font-semibold text-[#1A1D23] mb-1">Reporter&apos;s note</p>
                <p className="text-xs text-[#5B6470] leading-relaxed">{selectedSegment.notes}</p>
              </div>
            )}

            {selectedSegment.photo_url ? (
              <a
                href={selectedSegment.photo_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center text-sm bg-white border border-[#D6DAE0] hover:border-[#1A1D23] text-[#1A1D23] rounded-md py-2.5 font-semibold transition-colors"
              >
                View reported photo
              </a>
            ) : (
              <p className="text-xs text-[#8A93A0] text-center">No photo available</p>
            )}
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
                  fillColor: getPriorityColor(segment.priority_tier, segment.composite_priority),
                  color: '#fff',
                  weight: 2,
                  fillOpacity: 0.9,
                }}
                eventHandlers={{ click: () => setSelectedSegment(segment) }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold">{segment.name}</p>
                    <p style={{ color: PRIORITY_COLORS[segment.priority_tier] }}>
                      {PRIORITY_LABELS[segment.priority_tier]}
                    </p>
                    <p>Score: {segment.composite_priority.toFixed(1)}/100</p>
                    <p>{segment.damage_count} damage(s) detected</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        <div className="absolute bottom-6 left-6 bg-white rounded-lg shadow-lg p-4 z-1000 border border-[#E4E7EB]">
          <p className="font-semibold text-xs text-[#1A1D23] mb-2">Priority</p>
          <div className="space-y-1.5 text-xs">
            {([1, 2, 3] as const).map((tier) => (
              <div key={tier} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[tier] }} />
                <span className="text-[#5B6470]">{PRIORITY_LABELS[tier]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
