'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Popup, CircleMarker, useMap } from 'react-leaflet';
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

// Resize Leaflet when the sheet, viewport or desktop sidebar changes size.
function MapLayout({ selected, sheetSize, reports }: { selected: RoadSegment | null; sheetSize: string; reports: RoadSegment[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !reports.length) return;
    const points = reports.filter((r) => r.latitude != null && r.longitude != null)
      .map((r): [number, number] => [r.latitude!, r.longitude!]);
    if (points.length) {
      if (window.matchMedia('(max-width: 767px)').matches && !selected) {
        map.fitBounds(points, { padding: [32, 32], maxZoom: 10, animate: false });
      }
      fitted.current = true;
    }
  }, [map, reports, selected]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: true, animate: false, debounceMoveend: true }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    if (selected?.latitude != null && selected.longitude != null) {
      // Wait for the sheet's new layout before centering the visible map.
      const frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: true, animate: false });
        map.setView([selected.latitude!, selected.longitude!], Math.max(map.getZoom(), 14), { animate: false });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [map, selected, sheetSize]);
  return null;
}

function containDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab' || !event.currentTarget.matches(':modal')) return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.matches(':disabled') && element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

function FaqModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onKeyDown={containDialogFocus} className="zefet-help" aria-labelledby="help-title" onCancel={onClose} onClose={onClose}>
      <div className="zefet-dialog-heading">
        <h2 id="help-title">Help &amp; safety</h2>
        <button onClick={onClose} aria-label="Close help">×</button>
      </div>
      <div className="zefet-help-content p-5 space-y-5" tabIndex={0} role="region" aria-label="Frequently asked questions">
        {FAQ_ITEMS.map((item) => (
          <div key={item.q}>
            <p className="text-sm font-semibold text-[#1A1D23] mb-1">{item.q}</p>
            <p className="text-sm text-[#5B6470] leading-relaxed">{item.a}</p>
          </div>
        ))}
      </div>
    </dialog>
  );
}

async function readReports(): Promise<RoadSegment[]> {
  const response = await fetch('/api/segments');
  if (!response.ok) throw new Error('Could not load reports');
  return response.json();
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
  const [sheetSize, setSheetSize] = useState<'hidden' | 'peek' | 'half' | 'full'>('peek');
  const [showReport, setShowReport] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const reportDialog = useRef<HTMLDialogElement>(null);
  const sheetScroll = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const reopenPanelRef = useRef<HTMLButtonElement>(null);
  const panelIsOpen = sheetSize === 'half' || sheetSize === 'full';

  const hidePanel = () => {
    setSheetSize('hidden');
    requestAnimationFrame(() => reopenPanelRef.current?.focus({ preventScroll: true }));
  };
  const restorePanel = () => {
    setSheetSize('peek');
    requestAnimationFrame(() => panelToggleRef.current?.focus({ preventScroll: true }));
  };

  // One mounted form: closing the mobile dialog keeps the photo and notes.
  // On desktop the same dialog is non-modal and lives in the sidebar.
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const syncDialog = () => {
      const dialog = reportDialog.current;
      if (!dialog) return;
      if (dialog.open) dialog.close();
      if (media.matches) {
        if (showReport) dialog.showModal();
      } else {
        dialog.show();
      }
    };
    syncDialog();
    media.addEventListener('change', syncDialog);
    return () => media.removeEventListener('change', syncDialog);
  }, [showReport]);

  const selectReport = (segment: RoadSegment, panelSize: 'half' | 'full' = 'half') => {
    setSelectedSegment(segment);
    setSheetSize(panelSize);
    requestAnimationFrame(() => {
      sheetScroll.current?.scrollTo({ top: 0 });
      if (window.matchMedia('(max-width: 767px)').matches) {
        document.getElementById('report-detail-title')?.focus({ preventScroll: true });
      }
    });
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const fetchSegments = async () => {
    try {
      setSegments(await readReports());
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  };

  useEffect(() => {
    let active = true;
    readReports().then((reports) => {
      if (active) { setSegments(reports); setLoadState('ready'); }
    }).catch(() => { if (active) setLoadState('error'); });
    return () => { active = false; };
  }, []);

  const getUserLocation = () => {
    if ('geolocation' in navigator) {
      setFormError('');
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude]);
          setUseManualLocation(false);
          setIsLocating(false);
        },
        () => {
          setFormError('Could not get your location. Check permissions or enter coordinates manually.');
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    } else {
      setFormError('Location is unavailable in this browser. Enter coordinates manually.');
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
      const lat = Number(manualLat);
      const lon = Number(manualLon);
      if (manualLat.trim() && manualLon.trim() && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return [lat, lon];
      return null;
    }
    return userLocation;
  };

  const handlePhotoUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUploading) return;
    setFormError('');
    setNotice('');
    const location = getActiveLocation();
    if (!location) {
      setFormError('Set a valid location first — use your location or enter latitude (−90 to 90) and longitude (−180 to 180).');
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
        setNotice(`Report uploaded. Detected ${result.detections?.length ?? 0} damage instance(s).`);
        setShowReport(false);
        setSheetSize('half');
        formRef.current?.reset();
        setManualLat('');
        setManualLon('');
        await fetchSegments();
      } else {
        setFormError(`Upload failed: ${result.message ?? result.error ?? 'Please try again.'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setFormError('Could not upload the photo. Check your connection and try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const urgentSegments = segments.filter((s) => s.priority_tier === 1);
  const highSegments = segments.filter((s) => s.priority_tier === 2);
  const monitorSegments = segments.filter((s) => s.priority_tier === 3);
  const displayedSegments =
    activeTab === 'urgent' ? urgentSegments : activeTab === 'high' ? highSegments : monitorSegments;


  return (
    <div className="zefet-app bg-[#F5F6F7] font-sans" data-sheet={sheetSize}>
      <header className="zefet-mobile-header">
        <div><h1 className="font-rubik-vinyl">Zefet.</h1><p>Safer roads, one report at a time.</p></div>
        <button onClick={() => setShowFaq(true)} aria-label="Help and safety information">?</button>
      </header>
      {notice && <div className="zefet-notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
      {showFaq && <FaqModal onClose={() => setShowFaq(false)} />}

      {/* ── LEFT SIDEBAR ── */}
      <aside className="zefet-sidebar bg-white shadow-sm border-r border-[#E4E7EB]" aria-label="Road damage reports">
        {/* Header with road-marking signature stripe */}
        <div className="zefet-desktop-header px-6 pt-5 pb-4">
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
          className="zefet-desktop-header h-0.75 w-full shrink-0"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, #DB7F2E 0px, #DB7F2E 14px, transparent 14px, transparent 24px)',
          }}
        />

        {/* Upload card */}
        <dialog ref={reportDialog} onKeyDown={containDialogFocus} className="zefet-report-dialog" aria-labelledby="report-title"
          onCancel={(event) => { event.preventDefault(); setShowReport(false); }}>
          <div className="zefet-dialog-heading">
            <h2 id="report-title">Report road damage</h2>
            <button type="button" className="zefet-mobile-only" onClick={() => setShowReport(false)} aria-label="Close report form">×</button>
          </div>
          <p className="zefet-form-intro">Add a clear photo and the damage location. We’ll analyse it and prioritise the repair.</p>
          <form ref={formRef} onSubmit={handlePhotoUpload} className="space-y-2.5 zefet-upload-form" aria-busy={isUploading}>
            <fieldset disabled={isUploading} className="space-y-2.5">
            <label htmlFor="damage-photo" className="zefet-field-label">Road photo</label>
            <input
              id="damage-photo"
              ref={fileInputRef}
              type="file"
              name="photo"
              accept="image/*"
              required
              className="w-full text-xs text-[#1A1D23] border border-[#D6DAE0] rounded-md px-3 py-2 bg-white file:mr-3 file:py-1 file:px-2 file:rounded file:border-0 file:bg-[#F5F6F7] file:text-xs file:font-medium file:text-[#1A1D23] file:cursor-pointer"
            />
            <label htmlFor="damage-notes" className="zefet-field-label">Notes (optional)</label>
            <textarea
              id="damage-notes"
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
                    aria-label="Latitude"
                    inputMode="decimal"
                    placeholder="Latitude"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    className="text-sm text-[#1A1D23] placeholder-[#8A93A0] border border-[#D6DAE0] rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#DB7F2E]/40"
                  />

                  <input
                    type="text"
                    aria-label="Longitude"
                    inputMode="decimal"
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
            </fieldset>
            {formError && <p className="zefet-form-error" role="alert">{formError}</p>}
          </form>
        </dialog>

        <div className="zefet-sheet-heading">
          <button ref={panelToggleRef} className="zefet-sheet-toggle" aria-expanded={panelIsOpen} aria-controls="report-content"
            aria-label={panelIsOpen ? 'Collapse reports to peek' : 'Open reports panel'}
            onPointerDown={(e) => { swipeStart.current = e.clientY; suppressClick.current = false; e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerUp={(e) => {
              if (swipeStart.current !== null && Math.abs(e.clientY - swipeStart.current) > 35) {
                const up = e.clientY < swipeStart.current;
                setSheetSize(up ? (sheetSize === 'peek' ? 'half' : 'full') : (sheetSize === 'full' ? 'half' : 'peek'));
                suppressClick.current = true;
              }
              swipeStart.current = null;
            }}
            onPointerCancel={() => { swipeStart.current = null; }}
            onClick={() => { if (!suppressClick.current) setSheetSize(sheetSize === 'peek' ? 'half' : 'peek'); suppressClick.current = false; }}>
            <span className="zefet-grip" aria-hidden="true" />
            <span className="zefet-sheet-summary"><span><strong>{loadState === 'loading' ? 'Loading reports…' : `${segments.length} road reports`}</strong><small>{urgentSegments.length} urgent · {highSegments.length} high · {monitorSegments.length} monitor</small></span><span className="zefet-sheet-orbit" data-expanded={panelIsOpen} aria-hidden="true">
              <svg className="zefet-sheet-chevron" style={{ transform: panelIsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} width="20" height="20" viewBox="0 0 24 24" fill="none" focusable="false">
                <path d="m7 14 5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span></span>
            <span className="sr-only">{sheetSize === 'peek' ? 'Expand reports' : 'Collapse reports'}</span>
          </button>
          <button className="zefet-sheet-close" onClick={hidePanel} aria-label="Hide reports panel" title="Hide reports panel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          {panelIsOpen && <button className="zefet-sheet-size" aria-controls="report-content" onClick={() => setSheetSize(sheetSize === 'full' ? 'half' : 'full')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path d={sheetSize === 'full' ? 'M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {sheetSize === 'full' ? 'Show more map' : 'Expand panel'}
          </button>}
        </div>
        <div id="report-content" className="zefet-report-content">
        {/* Priority filters */}
        <div className="zefet-priority-tabs flex border-b border-[#E4E7EB] text-sm font-medium" role="group" aria-label="Filter by priority">
          <button
            aria-pressed={activeTab === 'urgent'}
            onClick={() => { setActiveTab('urgent'); setSelectedSegment(null); }}
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
            aria-pressed={activeTab === 'high'}
            onClick={() => { setActiveTab('high'); setSelectedSegment(null); }}
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
            aria-pressed={activeTab === 'monitor'}
            onClick={() => { setActiveTab('monitor'); setSelectedSegment(null); }}
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

        <div ref={sheetScroll} className="zefet-report-scroll">
        <div className={`zefet-report-list p-4 space-y-2.5 ${selectedSegment ? 'zefet-has-selection' : ''}`}>
          {loadState === 'loading' && <p role="status" className="zefet-load-message">Loading road reports…</p>}
          {loadState === 'error' && <div role="alert" className="zefet-load-message">Could not refresh reports. <button onClick={() => { setLoadState('loading'); void fetchSegments(); }}>Try again</button></div>}
          {loadState === 'ready' && displayedSegments.length === 0 ? (
            <p className="text-sm text-[#8A93A0] text-center mt-8">
              No {activeTab} reports yet.
            </p>
          ) : (
            displayedSegments.map((seg) => (
              <button
                type="button"
                key={seg.id}
                onClick={() => selectReport(seg)}
                aria-pressed={selectedSegment?.id === seg.id}
                className={`w-full text-left cursor-pointer border-l-[3px] ${TIER_BORDER[seg.priority_tier]} rounded-md bg-white shadow-sm p-3.5 hover:shadow-md transition-shadow ${
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
              </button>
            ))
          )}
        </div>

        {/* Detail panel */}
        {selectedSegment && (
          <div className="zefet-detail border-t border-[#E4E7EB] p-5 bg-white">
            <button className="zefet-back zefet-mobile-only" onClick={() => setSelectedSegment(null)}>← All reports</button>
            <div className="flex justify-between items-start mb-2">
              <h2 id="report-detail-title" tabIndex={-1} className="font-bold text-sm text-[#1A1D23] min-w-0 flex-1 leading-tight">{selectedSegment.name}</h2>
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
        </div>
      </aside>
      {sheetSize === 'hidden' && <button ref={reopenPanelRef} className="zefet-reopen-panel" onClick={restorePanel} aria-controls="report-content" aria-expanded={false}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Show reports
      </button>}
      <button className="zefet-report-launch" onClick={() => { setNotice(''); setShowReport(true); }}>
        <span aria-hidden="true">+</span> {isUploading ? 'Uploading report…' : 'Report damage'}
      </button>

      {/* ── MAP ── */}
      <div className="zefet-map" aria-label="Road damage map">
        <MapContainer
          center={[33.8547, 35.8623]}
          zoom={10}
          style={{ height: '100%', width: '100%' }}
        >
          <MapLayout selected={selectedSegment} sheetSize={sheetSize} reports={segments} />
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {segments
            .filter((s) => s.latitude != null && s.longitude != null)
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
                eventHandlers={{ click: () => selectReport(segment, 'full') }}
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

        <div className="zefet-legend absolute bottom-6 left-6 bg-white rounded-lg shadow-lg p-4 z-1000 border border-[#E4E7EB]">
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
