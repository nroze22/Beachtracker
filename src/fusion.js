// Fuse on-screen detections with live AIS/ADS-B targets.
//
// The trick: a phone with GPS + compass knows where it is and which way it
// points. A boat detected at horizontal position fracX in the frame sits at
// world bearing ≈ heading + (fracX − 0.5) × FOV. Every AIS vessel has a known
// position, so we can compute its bearing from us and match the box whose
// bearing lines up best. Same idea for planes via ADS-B. The result: the actual
// ship name / flight number painted onto the thing you're looking at.

import { bearingTo, distanceKm, angleDiff } from './geo.js';

/**
 * @param {Array} tracks         confirmed tracks from the Tracker
 * @param {number} frameWidth    overlay width in px
 * @param {object} opts
 * @param {Array} opts.vessels   AIS vessels [{lat,lon,name,...}]
 * @param {Array} opts.aircraft  ADS-B aircraft [{lat,lon,flight,...}]
 * @param {object} opts.geo      shared geo state (lat/lon/heading)
 * @param {number} opts.fovDeg   camera horizontal field of view
 * @returns {Map<number, object>} trackId -> identity payload
 */
export function fuse(tracks, frameWidth, { vessels, aircraft, geo, fovDeg }) {
  const out = new Map();
  if (!geo.hasFix || !geo.hasHeading) return out;

  // Precompute bearings/distances from us to every target.
  const prep = (list, kind) =>
    list
      .filter((o) => o.lat != null && o.lon != null)
      .map((o) => ({
        kind,
        ref: o,
        bearing: (bearingTo(geo.lat, geo.lon, o.lat, o.lon) + 360) % 360,
        dist: distanceKm(geo.lat, geo.lon, o.lat, o.lon)
      }));

  const targetsByClass = {
    boat: prep(vessels, 'boat'),
    airplane: prep(aircraft, 'airplane')
  };

  const claimed = new Set();

  // Match closer detections first so foreground objects win their target.
  const ordered = [...tracks].sort((a, b) => b.bbox[3] - a.bbox[3]);

  for (const t of ordered) {
    const pool = targetsByClass[t.class];
    if (!pool || !pool.length) continue;

    const cx = t.bbox[0] + t.bbox[2] / 2;
    const fracX = cx / frameWidth - 0.5; // -0.5 (left) .. +0.5 (right)
    const detBearing = (geo.heading + fracX * fovDeg + 360) % 360;

    // Tolerance widens a bit for distant/small targets where pixels are coarse.
    const tol = Math.min(18, 8 + fovDeg * 0.12);

    let best = null;
    let bestScore = Infinity;
    for (const cand of pool) {
      const key = cand.ref.mmsi || cand.ref.hex;
      if (claimed.has(key)) continue;
      const da = Math.abs(angleDiff(detBearing, cand.bearing));
      if (da > tol) continue;
      // Prefer good bearing alignment, lightly favouring nearer targets.
      const score = da + cand.dist * 0.15;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (best) {
      const key = best.ref.mmsi || best.ref.hex;
      claimed.add(key);
      out.set(t.id, { ...best.ref, kind: best.kind, _dist: best.dist, _bearing: best.bearing });
    }
  }

  return out;
}
