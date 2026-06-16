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
import { drawRadar } from './radar.js';
import { describe, vesselSubtype, sceneAllows, MANUAL_TAGS } from './classes.js';
import { settings, addSighting, updateSighting, addSnapshot } from './store.js';
import {
  setStatus,
  renderCounters,
  renderIdCards,
  renderLog,
  initSettingsUI,
  wireDrawerButtons,
  openDrawer,
  buildSceneBar,
  wireViewer,
  flashSnap
} from './ui.js';

const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const radarCanvas = document.getElementById('radar');
const radarCtx = radarCanvas.getContext('2d');

// Sticky tracker: confirms fast (minHits) and coasts a long time (maxAge) so a
// highlight stays on the target the whole time it's in view.
const tracker = new Tracker({ iouThreshold: 0.2, maxAge: 40, minHits: 3 });
const ais = new AisClient();
const adsb = new AdsbClient();

let running = false;
let facing = 'environment';
let lastIdents = new Map();
let lastDataSync = 0;
// Cumulative unique counts of AIS-identified vessel subtypes (fishing, ferry…).
const vesselTotals = {};

// --- Zoom ---------------------------------------------------------------
// Digital zoom: scale the displayed video + overlay with CSS, and crop+upscale
// the centre of the frame before detection so distant objects fill more of the
// model input. (Native/optical zoom via applyConstraints is unreliable in iOS
// Safari, so we use digital zoom everywhere for a consistent, working result.)
let videoTrack = null;
let zoom = 1;
const MAX_ZOOM = 8;
// Offscreen canvas used to crop+upscale the centre of the frame.
const detCanvas = document.createElement('canvas');
const detCtx = detCanvas.getContext('2d', { willReadFrequently: true });

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

function setupZoom(stream) {
  videoTrack = stream.getVideoTracks()[0] || null;
  const slider = document.getElementById('zoomSlider');
  slider.min = 1;
  slider.max = MAX_ZOOM;
  slider.step = 0.1;
  zoom = 1;
  slider.value = 1;
  applyZoom(1);
  document.getElementById('zoomControl').hidden = false;
}

function applyZoom(z) {
  zoom = Math.max(1, Math.min(MAX_ZOOM, z));
  const slider = document.getElementById('zoomSlider');
  slider.value = zoom;
  document.getElementById('zoomLabel').textContent = `${zoom.toFixed(1)}×`;
  // Scale ONLY the video. The overlay canvas stays unscaled and we transform box
  // geometry in code, so labels/reticle text keep a constant size while zooming.
  video.style.transformOrigin = 'center center';
  video.style.transform = zoom > 1.001 ? `scale(${zoom})` : '';
}

// Draw the centre `factor`x crop of the frame into the offscreen canvas, so
// distant objects get bigger pixels for the detector. Returns the crop mapping.
function cropSource(factor) {
  const W = video.videoWidth;
  const H = video.videoHeight;
  const cw = W / factor;
  const ch = H / factor;
  const cx = (W - cw) / 2;
  const cy = (H - ch) / 2;
  detCanvas.width = W;
  detCanvas.height = H;
  detCtx.drawImage(video, cx, cy, cw, ch, 0, 0, W, H);
  return { cx, cy, scale: factor };
}

function mapFrom(crop, b) {
  return [
    crop.cx + b[0] / crop.scale,
    crop.cy + b[1] / crop.scale,
    b[2] / crop.scale,
    b[3] / crop.scale
  ];
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

// Non-max suppression: keep the highest-scoring box among overlapping same-class
// detections so each object is represented once (no duplicate/competing tracks).
function nms(dets, thr = 0.45) {
  const out = [];
  for (const d of [...dets].sort((p, q) => q.score - p.score)) {
    if (!out.some((o) => o.class === d.class && iou(o.bbox, d.bbox) > thr)) {
      out.push(d);
    }
  }
  return out;
}

// Run detection — full frame plus, when far-scan is on (and not user-zoomed), a
// 2x centre crop — and merge the results in ONE frame so distant ships are found
// without creating a second flickering track for the same object.
async function detectMerged() {
  const W = video.videoWidth;
  if (!W) return [];
  const opts = { minScore: settings.confidence, maxObjects: 30 };
  let dets;
  if (zoom > 1.001) {
    const c = cropSource(zoom);
    dets = (await detect(detCanvas, opts)).map((d) => ({
      ...d,
      bbox: mapFrom(c, d.bbox)
    }));
  } else {
    dets = await detect(video, opts);
    if (settings.farScan) {
      const c = cropSource(2);
      const cd = (await detect(detCanvas, opts)).map((d) => ({
        ...d,
        bbox: mapFrom(c, d.bbox)
      }));
      dets = dets.concat(cd);
    }
  }
  return nms(dets.filter((d) => sceneAllows(d.class, settings.scene)));
}

// Convert a screen point to video-intrinsic coordinates, inverting the
// object-fit:cover layout and the CSS zoom transform (both centred).
function screenToVideo(clientX, clientY) {
  const rect = document.getElementById('stage').getBoundingClientRect();
  const W = video.videoWidth || rect.width;
  const H = video.videoHeight || rect.height;
  const cover = Math.max(rect.width / W, rect.height / H);
  const cxE = rect.left + rect.width / 2;
  const cyE = rect.top + rect.height / 2;
  return {
    x: W / 2 + (clientX - cxE) / (cover * zoom),
    y: H / 2 + (clientY - cyE) / (cover * zoom)
  };
}

// Find the smallest confirmed track whose box contains a video-space point.
let lastActive = [];
function dismissAt(clientX, clientY) {
  const p = screenToVideo(clientX, clientY);
  let hit = null;
  let hitArea = Infinity;
  for (const t of lastActive) {
    const [x, y, w, h] = t.bbox;
    if (p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h && w * h < hitArea) {
      hit = t;
      hitArea = w * h;
    }
  }
  if (hit) {
    tracker.remove(hit.id);
    setStatus('✕ Removed', 'flash');
    setTimeout(() => running && setStatus(''), 800);
    return true;
  }
  return false;
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

    const detections = await detectMerged();
    const active = tracker.update(detections);
    lastActive = active; // for tap-to-dismiss hit testing

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

    draw(ctx, active, idents, zoom);
    handleCounts(active, idents);

    renderCounters(tracker.liveCounts(), tracker.totals, {
      live: liveVesselCounts(active),
      totals: vesselTotals
    });
    renderIdCards(idents);
    renderRadar(idents);

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

// Draw the heads-up radar of nearby ships/planes, or hide it when off.
function renderRadar(idents) {
  const show = settings.radar && (settings.ais || settings.adsb) && geo.hasFix;
  radarCanvas.hidden = !show;
  if (!show) return;
  const matchedKeys = new Set();
  for (const id of idents.values()) matchedKeys.add(id.mmsi || id.hex);
  drawRadar(radarCtx, {
    geo,
    vessels: settings.ais ? ais.active() : [],
    aircraft: settings.adsb ? adsb.active() : [],
    fovDeg: settings.fovDeg,
    matchedKeys
  });
}

// Composite the current frame + overlay into a downsized JPEG and log it.
function captureSnapshot() {
  if (!video.videoWidth) return;
  const targetW = 480;
  const ratio = video.videoHeight / video.videoWidth;
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = Math.round(targetW * ratio);
  const octx = out.getContext('2d');
  if (zoom > 1.001) {
    // Replicate the zoomed view: draw the centre crop the user actually sees.
    const W = video.videoWidth;
    const H = video.videoHeight;
    const cw = W / zoom;
    const ch = H / zoom;
    octx.drawImage(video, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, out.width, out.height);
  } else {
    octx.drawImage(video, 0, 0, out.width, out.height);
  }
  octx.drawImage(canvas, 0, 0, out.width, out.height); // reticles already in zoomed positions
  let img;
  try {
    img = out.toDataURL('image/jpeg', 0.55);
  } catch {
    return; // tainted canvas (shouldn't happen with same-origin camera)
  }
  addSnapshot({ img, lat: geo.lat ?? undefined, lon: geo.lon ?? undefined });
  flashSnap();
  setStatus('📸 Snapshot saved', 'flash');
  setTimeout(() => running && setStatus(''), 1000);
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

    setStatus(
      settings.engine === 'yolo'
        ? 'Loading YOLOv8 model (first run caches ~13 MB)…'
        : 'Loading detector…'
    );
    const res = await loadDetector({
      engine: settings.engine,
      yoloUrl: settings.yoloUrl,
      customModelUrl: settings.customModelUrl || undefined,
      highAccuracy: settings.highAccuracy
    });
    if (res.fellBack) {
      setStatus('⚠️ YOLOv8 unavailable — using COCO-SSD', 'error');
      setTimeout(() => running && setStatus(''), 2500);
    }

    // Best-effort sensors for the identification fusion.
    if (settings.fusion || settings.ais || settings.adsb) {
      setStatus('Enabling GPS & compass…');
      await startGeo();
    }

    running = true;
    btn.textContent = '⏸ Pause';
    btn.disabled = false;
    setStatus('Pinch to zoom · tap a wrong box to remove it', 'flash');
    setTimeout(() => running && setStatus(''), 3500);
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
    setStatus(
      settings.engine === 'yolo' ? 'Loading YOLOv8 model…' : 'Switching detection model…'
    );
    const res = await loadDetector({
      engine: settings.engine,
      yoloUrl: settings.yoloUrl,
      customModelUrl: settings.customModelUrl || undefined,
      highAccuracy: settings.highAccuracy
    });
    tracker.reset();
    setStatus(res.fellBack ? '⚠️ YOLOv8 unavailable — using COCO-SSD' : '', res.fellBack ? 'error' : '');
    if (res.fellBack) setTimeout(() => running && setStatus(''), 2500);
  } catch (e) {
    setStatus(`⚠️ ${e.message || e}`, 'error');
  }
}

// --- Zoom + tap input wiring --------------------------------------------
function zoomStep() {
  return 0.5;
}

function touchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function setupGestures() {
  const stage = document.getElementById('stage');
  let startDist = 0;
  let startZoom = 1;
  let pinching = false;
  let tap = null; // {x, y, t} candidate single-finger tap

  // iOS Safari pinch: gesture* events carry a cumulative `scale`.
  stage.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    startZoom = zoom;
    pinching = true;
  });
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    applyZoom(startZoom * e.scale);
  });
  stage.addEventListener('gestureend', (e) => {
    e.preventDefault();
    pinching = false;
  });

  // Touch pinch (Android / non-Safari) + single-tap to dismiss a box.
  stage.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        startDist = touchDist(e.touches);
        startZoom = zoom;
        pinching = true;
        tap = null;
      } else if (e.touches.length === 1) {
        // Ignore taps that start on overlay UI (zoom control, chips, cards).
        if (e.target.closest('.zoomctl, #counters, #idcards, #radar, .scenebar, button')) {
          tap = null;
          return;
        }
        const t = e.touches[0];
        tap = { x: t.clientX, y: t.clientY, t: Date.now() };
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
      } else if (tap && e.touches.length === 1) {
        const t = e.touches[0];
        if (Math.hypot(t.clientX - tap.x, t.clientY - tap.y) > 14) tap = null;
      }
    },
    { passive: false }
  );
  stage.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length < 2) startDist = 0;
      // A quick, stationary single-finger tap dismisses the box under it.
      if (tap && !pinching && Date.now() - tap.t < 400) {
        dismissAt(tap.x, tap.y);
      }
      if (e.touches.length === 0) pinching = false;
      tap = null;
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
    if (['engine', 'highAccuracy', 'customModel'].includes(changed) && running) {
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
  setupGestures();
  buildSceneBar();
  wireViewer();
  renderCounters({}, {});
  renderLog();

  document.getElementById('startBtn').addEventListener('click', toggleStart);
  document.getElementById('flipBtn').addEventListener('click', flipCamera);
  document.getElementById('snapBtn').addEventListener('click', captureSnapshot);
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
