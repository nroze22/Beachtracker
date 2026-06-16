// Central state: persisted settings + the running sighting log.
// Kept deliberately tiny and framework-free.

const SETTINGS_KEY = 'beachtracker.settings.v1';
const LOG_KEY = 'beachtracker.log.v1';

const DEFAULT_SETTINGS = {
  confidence: 0.35, // sensitive enough for big/distant ships; scene + NMS + tap-dismiss curb false positives
  highAccuracy: true, // use the full mobilenet_v2 base
  ais: false,
  aisKey: '',
  adsb: false,
  fusion: false,
  fovDeg: 65, // typical rear-camera horizontal FOV on an iPhone
  customModelUrl: '',
  scene: 'all', // detection scene filter: all | water | sky | beach
  farScan: true, // alternate a 2x centre-crop pass to catch distant objects
  radar: true // show the AIS/ADS-B radar minimap
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export const settings = load(SETTINGS_KEY, DEFAULT_SETTINGS);

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full / disabled — ignore */
  }
}

// --- Sighting log -------------------------------------------------------

/** @type {Array<{id:string,kind:string,label:string,t:number,lat?:number,lon?:number,meta?:object}>} */
export let sightingLog = (() => {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

function persistLog() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(sightingLog.slice(-2000)));
  } catch {
    /* ignore */
  }
}

export function addSighting(entry) {
  const item = {
    id: `${entry.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    t: Date.now(),
    ...entry
  };
  sightingLog.push(item);
  persistLog();
  return item;
}

export function updateSighting(id, patch) {
  const s = sightingLog.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  persistLog();
}

export function clearLog() {
  sightingLog.length = 0;
  persistLog();
}

// --- Snapshots (captured stills) ---------------------------------------
// Kept in their own capped store so the base log stays small.
const SNAP_KEY = 'beachtracker.snaps.v1';
const SNAP_CAP = 24;

export let snapshots = (() => {
  try {
    const raw = localStorage.getItem(SNAP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

export function addSnapshot({ img, caption, lat, lon }) {
  const item = { id: `snap-${Date.now()}`, t: Date.now(), img, caption, lat, lon };
  snapshots.push(item);
  if (snapshots.length > SNAP_CAP) snapshots = snapshots.slice(-SNAP_CAP);
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snapshots));
  } catch {
    // Storage full: drop the oldest half and retry once.
    snapshots = snapshots.slice(-Math.floor(SNAP_CAP / 2));
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(snapshots));
    } catch {
      /* give up silently */
    }
  }
  return item;
}

export function clearSnapshots() {
  snapshots = [];
  try {
    localStorage.removeItem(SNAP_KEY);
  } catch {
    /* ignore */
  }
}

export function logToCsv() {
  const rows = [['timestamp_iso', 'kind', 'label', 'lat', 'lon', 'detail']];
  for (const s of sightingLog) {
    rows.push([
      new Date(s.t).toISOString(),
      s.kind,
      s.label ?? '',
      s.lat ?? '',
      s.lon ?? '',
      s.meta ? JSON.stringify(s.meta).replace(/"/g, "'") : ''
    ]);
  }
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
