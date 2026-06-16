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
import { describe, MANUAL_TAGS } from './classes.js';
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

const tracker = new Tracker({ iouThreshold: 0.25, maxAge: 14, minHits: 3 });
const ais = new AisClient();
const adsb = new AdsbClient();

let running = false;
let facing = 'environment';
let lastIdents = new Map();
let lastDataSync = 0;

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
}

function stopCamera() {
  const s = video.srcObject;
  if (s) s.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
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

    const detections = await detect(video, {
      minScore: settings.confidence,
      maxObjects: 30
    });

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
      }
    }
    lastIdents = idents;

    draw(ctx, active, idents);
    handleCounts(active, idents);

    renderCounters(tracker.liveCounts(), tracker.totals);
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
        updateSighting(t._sightingId, {
          label: `${describe(t.class).label} — ${label}`,
          meta: id
        });
      }
    }
  }
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
    await loadDetector({ customModelUrl: settings.customModelUrl || undefined });

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
  });
  wireDrawerButtons();
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
