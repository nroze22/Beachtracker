// A lightweight SORT-style multi-object tracker.
//
// Detectors fire every frame, so naively counting detections double-counts the
// same gull dozens of times. Instead we keep persistent "tracks": each detected
// object gets a stable ID that survives across frames via IoU matching, plus a
// constant-velocity guess so a box that briefly drops out is re-acquired rather
// than counted again. A track is only tallied once — the first time it is
// "confirmed" (seen on enough consecutive frames) — giving honest unique counts.

let nextId = 1;

function iou(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const union = aw * ah + bw * bh - inter;
  return inter / union;
}

function center(b) {
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

export class Tracker {
  /**
   * @param {object} opts
   * @param {number} opts.iouThreshold  min IoU to match a detection to a track
   * @param {number} opts.maxAge        frames a track survives unmatched before deletion
   * @param {number} opts.minHits       consecutive hits before a track is confirmed & counted
   */
  constructor({ iouThreshold = 0.2, maxAge = 45, minHits = 2 } = {}) {
    this.iouThreshold = iouThreshold;
    this.maxAge = maxAge;
    this.minHits = minHits;
    /** @type {Map<number, Track>} */
    this.tracks = new Map();
    // Cumulative unique counts per class (only ever increases).
    this.totals = {};
  }

  /**
   * @param {Array<{class:string,score:number,bbox:number[]}>} detections
   * @returns {Array<Track>} active confirmed tracks (for drawing)
   */
  update(detections) {
    // No velocity prediction: a coasting box stays exactly where it was last
    // seen. Predicting motion made distant/near-static objects jump around;
    // holding still reads as calm and is more accurate for slow scenes.
    for (const t of this.tracks.values()) {
      t.timeSinceUpdate += 1;
      t.age += 1;
    }

    // Greedy IoU matching (sufficient for the handful of objects on a shoreline).
    const trackList = [...this.tracks.values()];
    const used = new Set();
    const pairs = [];
    for (const det of detections) {
      let best = null;
      let bestIou = this.iouThreshold;
      for (const t of trackList) {
        if (used.has(t.id) || t.class !== det.class) continue;
        const v = iou(det.bbox, t.bbox);
        if (v >= bestIou) {
          bestIou = v;
          best = t;
        }
      }
      if (best) {
        used.add(best.id);
        pairs.push([best, det]);
      } else {
        // Unmatched detection -> new tentative track.
        const id = nextId++;
        this.tracks.set(id, new Track(id, det));
      }
    }

    // Apply matches: ease the stored box toward the new detection (EMA) so the
    // track target itself is smooth, not just the rendered box.
    for (const [t, det] of pairs) {
      const a = 0.5;
      t.bbox = [
        t.bbox[0] + (det.bbox[0] - t.bbox[0]) * a,
        t.bbox[1] + (det.bbox[1] - t.bbox[1]) * a,
        t.bbox[2] + (det.bbox[2] - t.bbox[2]) * a,
        t.bbox[3] + (det.bbox[3] - t.bbox[3]) * a
      ];
      t.score = det.score;
      t.hits += 1;
      t.timeSinceUpdate = 0;
      this._maybeConfirm(t);
    }

    // Retire stale tracks.
    for (const [id, t] of this.tracks) {
      if (t.timeSinceUpdate > this.maxAge) this.tracks.delete(id);
    }

    // Keep drawing every confirmed track until it's actually retired, so the
    // highlight persists the whole time the object is on screen rather than
    // flashing for a frame and disappearing.
    return [...this.tracks.values()].filter((t) => t.confirmed);
  }

  _maybeConfirm(t) {
    if (!t.confirmed && t.hits >= this.minHits) {
      t.confirmed = true;
      this.totals[t.class] = (this.totals[t.class] || 0) + 1;
      t.justCounted = true; // consumed by the UI for a one-shot event
    }
  }

  /** Currently-visible confirmed count per class. */
  liveCounts() {
    const counts = {};
    for (const t of this.tracks.values()) {
      if (t.confirmed) {
        counts[t.class] = (counts[t.class] || 0) + 1;
      }
    }
    return counts;
  }

  reset() {
    this.tracks.clear();
    this.totals = {};
  }

  /** Remove a single track (e.g. user tapped a false-positive box to dismiss it). */
  remove(id) {
    this.tracks.delete(id);
  }
}

export class Track {
  constructor(id, det) {
    this.id = id;
    this.class = det.class;
    this.bbox = det.bbox;
    this.score = det.score;
    this.vx = 0;
    this.vy = 0;
    this.hits = 1;
    this.age = 1;
    this.timeSinceUpdate = 0;
    this.confirmed = false;
    this.justCounted = false;
    this.ident = null; // attached AIS/ADS-B identity, if matched
  }
}
