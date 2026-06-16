// DOM glue: counters, status line, identity cards, drawers, settings.

import { describe, SCENES } from './classes.js';
import {
  settings,
  saveSettings,
  sightingLog,
  clearLog,
  logToCsv,
  snapshots,
  clearSnapshots
} from './store.js';

const $ = (id) => document.getElementById(id);

export function setStatus(msg, kind = '') {
  const el = $('status');
  el.innerHTML = msg;
  el.className = `status ${kind}`;
  el.style.display = msg ? 'block' : 'none';
}

// --- Live counters ------------------------------------------------------

export function renderCounters(live, totals, vessel) {
  const el = $('counters');
  // Union of classes seen live or ever.
  const keys = new Set([...Object.keys(live), ...Object.keys(totals)]);
  // Stable, meaningful order (unlisted classes fall to the end).
  const order = [
    'boat', 'airplane', 'bird', 'seal', 'otter',
    'kite', 'surfboard', 'umbrella', 'person', 'dog'
  ];
  const rank = (k) => (order.indexOf(k) === -1 ? 99 : order.indexOf(k));
  const sorted = [...keys].sort((a, b) => rank(a) - rank(b));

  const chip = (k, now, total) => {
    const m = describe(k);
    return `<div class="chip" style="--c:${m.color}">
        <span class="chip-emoji">${m.emoji}</span>
        <span class="chip-now">${now}</span>
        <span class="chip-total">/ ${total}</span>
      </div>`;
  };

  // Identified vessel subtypes (fishing boat, ferry, cargo…) as a second group.
  const vKeys = vessel
    ? new Set([...Object.keys(vessel.live), ...Object.keys(vessel.totals)])
    : new Set();

  if (!sorted.length && !vKeys.size) {
    el.innerHTML = '<div class="chip muted">No detections yet…</div>';
    return;
  }

  let html = sorted.map((k) => chip(k, live[k] || 0, totals[k] || 0)).join('');
  if (vKeys.size) {
    html += '<div class="chip-sep" aria-hidden="true"></div>';
    html += [...vKeys]
      .map((k) => chip(k, vessel.live[k] || 0, vessel.totals[k] || 0))
      .join('');
  }
  el.innerHTML = html;
}

// --- Identity cards (matched ships/planes) ------------------------------

export function renderIdCards(idents) {
  const el = $('idcards');
  const items = [...idents.values()];
  if (!items.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = items
    .slice(0, 4)
    .map((d) => {
      if (d.kind === 'boat') {
        return card('🚢', d.name || `MMSI ${d.mmsi}`, [
          d.typeName,
          d.destination ? `→ ${d.destination}` : null,
          d.sog != null ? `${Math.round(d.sog)} kn` : null,
          d._dist != null ? `${d._dist.toFixed(1)} km` : null
        ]);
      }
      return card('✈️', d.flight || d.reg || d.hex, [
        d.typeName,
        d.altFt ? `${Math.round(d.altFt / 100) * 100} ft` : null,
        d.speedKt ? `${Math.round(d.speedKt)} kt` : null,
        d._dist != null ? `${d._dist.toFixed(1)} km` : null
      ]);
    })
    .join('');
}

function card(emoji, title, bits) {
  const sub = bits.filter(Boolean).join(' · ');
  return `<div class="idcard">
    <div class="idcard-emoji">${emoji}</div>
    <div class="idcard-body">
      <div class="idcard-title">${escapeHtml(title)}</div>
      <div class="idcard-sub">${escapeHtml(sub)}</div>
    </div>
  </div>`;
}

// --- Scene selector -----------------------------------------------------

export function buildSceneBar() {
  const bar = $('sceneBar');
  bar.innerHTML = Object.entries(SCENES)
    .map(
      ([key, s]) =>
        `<button class="scenechip${key === settings.scene ? ' active' : ''}" data-scene="${key}">${s.emoji} ${s.label}</button>`
    )
    .join('');
  bar.querySelectorAll('.scenechip').forEach((b) =>
    b.addEventListener('click', () => {
      settings.scene = b.dataset.scene;
      saveSettings();
      bar.querySelectorAll('.scenechip').forEach((x) =>
        x.classList.toggle('active', x.dataset.scene === settings.scene)
      );
    })
  );
}

// --- Snapshot viewer + flash -------------------------------------------

export function wireViewer() {
  const v = $('viewer');
  $('viewerClose').addEventListener('click', () => (v.hidden = true));
  v.addEventListener('click', (e) => {
    if (e.target === v) v.hidden = true;
  });
}

export function openViewer(src) {
  $('viewerImg').src = src;
  $('viewerSave').href = src;
  $('viewer').hidden = false;
}

export function flashSnap() {
  const el = document.createElement('div');
  el.className = 'snap-flash';
  document.getElementById('stage').appendChild(el);
  setTimeout(() => el.remove(), 320);
}

function renderSnapGallery() {
  const g = $('snapGallery');
  if (!g) return;
  if (!snapshots.length) {
    g.innerHTML = '';
    g.hidden = true;
    return;
  }
  g.hidden = false;
  g.innerHTML = snapshots
    .slice()
    .reverse()
    .map(
      (s) =>
        `<img class="snapthumb" src="${s.img}" data-id="${s.id}" alt="snapshot" />`
    )
    .join('');
  g.querySelectorAll('.snapthumb').forEach((img) =>
    img.addEventListener('click', () => openViewer(img.src))
  );
}

// --- Sighting log drawer ------------------------------------------------

export function renderLog() {
  const list = $('logList');
  const stats = $('logStats');
  renderSnapGallery();

  const byKind = {};
  for (const s of sightingLog) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
  stats.innerHTML =
    Object.entries(byKind)
      .map(([k, n]) => {
        const m = describe(k);
        return `<span class="logstat">${m.emoji} ${n}</span>`;
      })
      .join('') || '<span class="muted">No sightings logged yet.</span>';

  list.innerHTML = sightingLog
    .slice()
    .reverse()
    .slice(0, 300)
    .map((s) => {
      const m = describe(s.kind);
      const time = new Date(s.t).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const detail = s.meta ? buildDetail(s) : '';
      const loc =
        s.lat != null ? `📍 ${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}` : '';
      return `<div class="logrow">
        <span class="logrow-emoji">${m.emoji}</span>
        <span class="logrow-main">
          <b>${escapeHtml(s.label || m.label)}</b>
          ${detail ? `<span class="logrow-detail">${escapeHtml(detail)}</span>` : ''}
        </span>
        <span class="logrow-meta">${time}${loc ? `<br>${loc}` : ''}</span>
      </div>`;
    })
    .join('');
}

function buildDetail(s) {
  const m = s.meta;
  if (s.kind === 'boat' || s.kind.startsWith('vessel_')) {
    return [m.typeName, m.destination ? `→ ${m.destination}` : null]
      .filter(Boolean)
      .join(' · ');
  }
  if (s.kind === 'airplane') {
    return [m.typeName, m.flight].filter(Boolean).join(' · ');
  }
  return '';
}

// --- Drawers ------------------------------------------------------------

export function openDrawer(id) {
  $(id).classList.add('open');
}
export function closeDrawer(id) {
  $(id).classList.remove('open');
}

// --- Settings panel wiring ---------------------------------------------

export function initSettingsUI(onChange) {
  const conf = $('confSlider');
  const confVal = $('confVal');
  const engineT = $('engineToggle');
  const acc = $('accToggle');
  const farScan = $('farScanToggle');
  const radar = $('radarToggle');
  const fov = $('fovSlider');
  const fovVal = $('fovVal');
  const ais = $('aisToggle');
  const aisKey = $('aisKey');
  const adsb = $('adsbToggle');
  const fusion = $('fusionToggle');
  const custom = $('customModel');

  conf.value = settings.confidence;
  confVal.textContent = settings.confidence.toFixed(2);
  engineT.checked = settings.engine === 'yolo';
  acc.checked = settings.highAccuracy;
  farScan.checked = settings.farScan;
  radar.checked = settings.radar;
  fov.value = settings.fovDeg;
  fovVal.textContent = `${settings.fovDeg}°`;
  ais.checked = settings.ais;
  aisKey.value = settings.aisKey;
  adsb.checked = settings.adsb;
  fusion.checked = settings.fusion;
  custom.value = settings.customModelUrl;

  const commit = (changed) => {
    saveSettings();
    onChange?.(changed);
  };

  conf.addEventListener('input', () => {
    settings.confidence = parseFloat(conf.value);
    confVal.textContent = settings.confidence.toFixed(2);
    commit('confidence');
  });
  engineT.addEventListener('change', () => {
    settings.engine = engineT.checked ? 'yolo' : 'coco';
    commit('engine');
  });
  acc.addEventListener('change', () => {
    settings.highAccuracy = acc.checked;
    commit('highAccuracy');
  });
  farScan.addEventListener('change', () => {
    settings.farScan = farScan.checked;
    commit('farScan');
  });
  radar.addEventListener('change', () => {
    settings.radar = radar.checked;
    commit('radar');
  });
  fov.addEventListener('input', () => {
    settings.fovDeg = parseInt(fov.value, 10);
    fovVal.textContent = `${settings.fovDeg}°`;
    commit('fov');
  });
  ais.addEventListener('change', () => {
    settings.ais = ais.checked;
    commit('ais');
  });
  aisKey.addEventListener('change', () => {
    settings.aisKey = aisKey.value.trim();
    commit('aisKey');
  });
  adsb.addEventListener('change', () => {
    settings.adsb = adsb.checked;
    commit('adsb');
  });
  fusion.addEventListener('change', () => {
    settings.fusion = fusion.checked;
    commit('fusion');
  });
  custom.addEventListener('change', () => {
    settings.customModelUrl = custom.value.trim();
    commit('customModel');
  });
}

export function wireDrawerButtons() {
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => closeDrawer(b.dataset.close))
  );
  $('exportBtn').addEventListener('click', () => {
    const csv = logToCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beachtracker-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('clearLogBtn').addEventListener('click', () => {
    if (confirm('Clear the entire sighting log and snapshots?')) {
      clearLog();
      clearSnapshots();
      renderLog();
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
