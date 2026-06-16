// BeachTracker — main orchestrator.
// Wires the camera, detector, tracker, geo + transponder feeds, fusion and UI
// into one detection loop.

import './styles.css';
import { loadDetector, detect } from './detector.js';
import { Tracker } from './tracker.js';
import { sizeCanvas, draw } from './overlay.js';
import { startGeo, geo } from './geo.js';
import { AisClient } from './ais.js';
import { AdsbClient } from './adsb.js';
import { fuse } from './fusion.js';
import { describe, vesselSubtype, MANUAL_TAGS } from './classes.js';
import { settings, addSighting, updateSighting } from './store.js';
import {
  setStatus,
  renderCounters,
  renderIdCards,
  renderLog,
  initSettingsUI,
  wireDrawerButtons,
  openDrawer
} from './ui.js';

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');

// Sticky tracker: confirms fast (minHits) and coasts a long time (maxAge) so a
// highlight stays on the target the whole time it's in view.
const tracker = new Tracker({ iouThreshold: 0.2, maxAge: 45, minHits: 2 });
const ais = new AisClient();
const adsb = new AdsbClient();

let running = false;
let facing = 'environment';
let lastIdents = new Map();
let lastDataSync = 0;
// Cumulative unique counts of AIS-identified vessel subtypes (fishing, ferry…).
const vesselTotals = {};

// --- Zoom ---------------------------------------------------------------
// nativeZoom: the camera track's optical/native zoom capability, if any.
// When absent we fall back to digital zoom (CSS scale + cropped detection).
let videoTrack = null;
let nativeZoom = null; // {min, max, step}
let zoom = 1;
// Offscreen canvas used to crop+upscale the centre of the frame so a distant
// ship fills more of the detector's input when digitally zoomed.
const detCanvas = document.createElement('canvas');
const detCtx = detCanvas.getContext('2d', { willReadFrequently: true });
let detCrop = null; // {cx, cy, scale} mapping det-space boxes back to video space

// ------------------------------------------------------------------ camera

async function startCamera() {
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
  await new Promise((res) => {
    if (video.readyState >= 2) return res();
    video.onloadeddata = () => res();
  });
  setupZoom(stream);
}

function stopCamera() {
  const s = video.srcObject;
  if (s) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  videoTrack = null;
}

// Detect native zoom support and configure the zoom slider accordingly.
function setupZoom(stream) {
  videoTrack = stream.getVideoTracks()[0] || null;
  nativeZoom = null;
  const caps = videoTrack?.getCapabilities?.();
  if (caps && 'zoom' in caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
    nativeZoom = {
      min: caps.zoom.min,
      max: caps.zoom.max,
      step: caps.zoom.step || 0.1
    };
  }
  const slider = document.getElementById('zoomSlider');
  if (nativeZoom) {
    slider.min = nativeZoom.min;
    slider.max = nativeZoom.max;
    slider.step = nativeZoom.step;
  } else {
    slider.min = 1;
    slider.max = 6; // digital zoom range
    slider.step = 0.1;
  }
  zoom = nativeZoom ? nativeZoom.min : 1;
  slider.value = zoom;
  applyZoom(zoom);
  document.getElementById('zoomControl').hidden = false;
}

function applyZoom(z) {
  const minZ = nativeZoom ? nativeZoom.min : 1;
  const maxZ = nativeZoom ? nativeZoom.max : 6;
  zoom = Math.max(minZ, Math.min(maxZ, z));
  const slider = document.getElementById('zoomSlider');
  slider.value = zoom;
  document.getElementById('zoomLabel').textContent = `${zoom.toFixed(1)}×`;

  if (nativeZoom && videoTrack) {
    // Optical/native zoom: the camera itself zooms; no CSS transform needed.
    video.style.transform = '';
    canvas.style.transform = '';
    videoTrack.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
  } else {
    // Digital zoom: scale the displayed video + overlay together about centre.
    const t = zoom > 1.001 ? `scale(${zoom})` : '';
    video.style.transformOrigin = 'center center';
    canvas.style.transformOrigin = 'center center';
    video.style.transform = t;
    canvas.style.transform = t;
  }
}

// Build the image we actually run detection on. For digital zoom we crop the
// centre of the frame and upscale it, so distant objects get bigger pixels and
// the detector can resolve them. Returns the source element/canvas to detect.
function detectionSource() {
  if (nativeZoom || zoom <= 1.001) {
    detCrop = null;
    return video;
  }
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (!W || !H) {
    detCrop = null;
    return video;
  }
  const cw = W / zoom;
  const ch = H / zoom;
  const cx = (W - cw) / 2;
  const cy = (H - ch) / 2;
  detCanvas.width = W;
  detCanvas.height = H;
  detCtx.drawImage(video, cx, cy, cw, ch, 0, 0, W, H);
  detCrop = { cx, cy, scale: zoom };
  return detCanvas;
}

// Map a detection box from cropped det-space back into video-intrinsic space.
function mapBox(b) {
  if (!detCrop) return b;
  const { cx, cy, scale } = detCrop;
  return [cx + b[0] / scale, cy + b[1] / scale, b[2] / scale, b[3] / scale];
}

// ----------------------------------------------------------- data feeds

function syncFeeds() {
  if (!geo.hasFix) return;
  const center = { lat: geo.lat, lon: geo.lon };

  if (settings.ais && settings.aisKey) {
    if (!ais.connected && !ais.ws) ais.start(settings.aisKey, center);
  } else {
    ais.stop();
  }

  if (settings.adsb) {
    adsb.start(center);
    adsb.setCenter(center);
  } else {
    adsb.stop();
  }
}

// ------------------------------------------------------------- the loop

async function loop() {
  if (!running) return;
  try {
    sizeCanvas(canvas, video);

    // Detect on the (digitally) zoomed crop, then map boxes back to video space.
    const source = detectionSource();
    const raw = await detect(source, {
      minScore: settings.confidence,
      maxObjects: 30
    });
    const detections = raw.map((d) => ({ ...d, bbox: mapBox(d.bbox) }));

    const active = tracker.update(detections);

    // Fuse with live transponder data when enabled and oriented.
    let idents = new Map();
    if (settings.fusion && (settings.ais || settings.adsb)) {
      idents = fuse(active, canvas.width, {
        vessels: settings.ais ? ais.active() : [],
        aircraft: settings.adsb ? adsb.active() : [],
        geo,
        fovDeg: settings.fovDeg
      });
      // Persist identity onto the track so it sticks across brief feed gaps.
      for (const t of active) {
        if (idents.has(t.id)) t.ident = idents.get(t.id);
        else if (t.ident) idents.set(t.id, t.ident);
        // Refine generic "boat" into a fishing boat / ferry / cargo ship / …
        if (t.class === 'boat' && t.ident) t.subtype = vesselSubtype(t.ident);
      }
    }
    lastIdents = idents;

    draw(ctx, active, idents);
    handleCounts(active, idents);

    renderCounters(tracker.liveCounts(), tracker.totals, {
      live: liveVesselCounts(active),
      totals: vesselTotals
    });
    renderIdCards(idents);

    // Refresh feed subscriptions when the GPS fix first arrives / moves.
    const now = performance.now();
    if (now - lastDataSync > 8000) {
      syncFeeds();
      lastDataSync = now;
    }
  } catch (e) {
    console.error(e);
  }
  requestAnimationFrame(loop);
}

// Log each newly-confirmed track once, and enrich it with identity later.
function handleCounts(tracks, idents) {
  for (const t of tracks) {
    if (t.justCounted) {
      t.justCounted = false;
      const m = describe(t.class);
      const entry = addSighting({
        kind: m.kind,
        label: m.label,
        lat: geo.lat ?? undefined,
        lon: geo.lon ?? undefined
      });
      t._sightingId = entry.id;
    }
    // Attach identity to the log entry the first time we learn it.
    if (t._sightingId && !t._identLogged) {
      const id = idents.get(t.id) || t.ident;
      if (id) {
        t._identLogged = true;
        const label =
          id.kind === 'boat'
            ? id.name || `MMSI ${id.mmsi}`
            : id.flight || id.reg || id.hex;
        // Promote a generic boat to its identified vessel subtype, counting it
        // once and relabelling its log entry (e.g. "Fishing boat — F/V Pacific").
        const sub = t.class === 'boat' ? vesselSubtype(id) : null;
        if (sub && !t._subCounted) {
          t._subCounted = true;
          vesselTotals[sub.kind] = (vesselTotals[sub.kind] || 0) + 1;
        }
        const baseLabel = sub ? sub.label : describe(t.class).label;
        updateSighting(t._sightingId, {
          kind: sub ? sub.kind : describe(t.class).kind,
          label: `${baseLabel} — ${label}`,
          meta: id
        });
      }
    }
  }
}

// Currently-visible counts of identified vessel subtypes, keyed by subtype kind.
function liveVesselCounts(tracks) {
  const counts = {};
  for (const t of tracks) {
    if (t.class === 'boat' && t.subtype) {
      counts[t.subtype.kind] = (counts[t.subtype.kind] || 0) + 1;
    }
  }
  return counts;
}

// ------------------------------------------------------------- controls

async function start() {
  if (running) return;
  const btn = document.getElementById('startBtn');
  btn.disabled = true;
  try {
    setStatus('Requesting camera…');
    await startCamera();

    setStatus('Loading detector (first time needs internet)…');
    await loadDetector({
      customModelUrl: settings.customModelUrl || undefined,
      highAccuracy: settings.highAccuracy
    });

    // Best-effort sensors for the identification fusion.
    if (settings.fusion || settings.ais || settings.adsb) {
      setStatus('Enabling GPS & compass…');
      await startGeo();
    }

    running = true;
    btn.textContent = '⏸ Pause';
    btn.disabled = false;
    setStatus('');
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    setStatus(
      `⚠️ ${e.name === 'NotAllowedError' ? 'Camera permission denied.' : e.message || e}`,
      'error'
    );
  }
}

function pause() {
  running = false;
  document.getElementById('startBtn').textContent = '▶ Resume';
  setStatus('Paused.');
}

// Swap the detection model live when the accuracy / custom-model setting changes.
async function reloadDetector() {
  try {
    setStatus('Switching detection model…');
    await loadDetector({
      customModelUrl: settings.customModelUrl || undefined,
      highAccuracy: settings.highAccuracy
    });
    tracker.reset();
    setStatus('');
  } catch (e) {
    setStatus(`⚠️ ${e.message || e}`, 'error');
  }
}

// --- Zoom input wiring --------------------------------------------------
function zoomStep() {
  return nativeZoom
    ? Math.max(nativeZoom.step, (nativeZoom.max - nativeZoom.min) / 12)
    : 0.5;
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function setupPinch() {
  const stage = document.getElementById('stage');
  let startDist = 0;
  let startZoom = 1;
  stage.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        startDist = touchDist(e.touches);
        startZoom = zoom;
      }
    },
    { passive: true }
  );
  stage.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2 && startDist) {
        e.preventDefault();
        applyZoom(startZoom * (touchDist(e.touches) / startDist));
      }
    },
    { passive: false }
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length < 2) startDist = 0;
    },
    { passive: true }
  );
}

function toggleStart() {
  if (running) pause();
  else start();
}

async function flipCamera() {
  facing = facing === 'environment' ? 'user' : 'environment';
  if (video.srcObject) {
    stopCamera();
    try {
      await startCamera();
    } catch (e) {
      setStatus(`⚠️ ${e.message || e}`, 'error');
    }
  }
}

function logManual(kind) {
  const tag = MANUAL_TAGS[kind];
  addSighting({
    kind: tag.kind,
    label: tag.label,
    lat: geo.lat ?? undefined,
    lon: geo.lon ?? undefined
  });
  // Tiny haptic-style confirmation via the status line.
  setStatus(`${tag.emoji} ${tag.label} logged!`, 'flash');
  setTimeout(() => running && setStatus(''), 1200);
  renderLog();
}

// --------------------------------------------------------------- wire up

function init() {
  initSettingsUI((changed) => {
    if (['ais', 'aisKey', 'adsb', 'fusion'].includes(changed)) {
      lastDataSync = 0; // force a feed re-sync on next loop tick
      if (!running) syncFeeds();
    }
    if (['highAccuracy', 'customModel'].includes(changed) && running) {
      reloadDetector();
    }
  });
  wireDrawerButtons();

  // Zoom: slider, +/- buttons and pinch-to-zoom.
  const zoomSlider = document.getElementById('zoomSlider');
  zoomSlider.addEventListener('input', () =>
    applyZoom(parseFloat(zoomSlider.value))
  );
  document
    .getElementById('zoomIn')
    .addEventListener('click', () => applyZoom(zoom + zoomStep()));
  document
    .getElementById('zoomOut')
    .addEventListener('click', () => applyZoom(zoom - zoomStep()));
  setupPinch();
  renderCounters({}, {});
  renderLog();

  document.getElementById('startBtn').addEventListener('click', toggleStart);
  document.getElementById('flipBtn').addEventListener('click', flipCamera);
  document
    .getElementById('sealBtn')
    .addEventListener('click', () => logManual('seal'));
  document
    .getElementById('otterBtn')
    .addEventListener('click', () => logManual('otter'));
  document.getElementById('logBtn').addEventListener('click', () => {
    renderLog();
    openDrawer('logDrawer');
  });
  document
    .getElementById('settingsBtn')
    .addEventListener('click', () => openDrawer('settingsDrawer'));
}

init();
