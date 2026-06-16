// Live aircraft identification via the free, key-less adsb.lol API.
//
// Planes broadcast ADS-B (position, altitude, speed, flight number, type). We
// poll a radius around the phone's GPS fix every few seconds and keep a table of
// nearby aircraft keyed by ICAO hex. Falls back silently when offline.

// Common type-code -> friendly name (small, just the usual Puget Sound suspects).
const TYPE_NAMES = {
  B738: 'Boeing 737-800',
  B739: 'Boeing 737-900',
  B38M: 'Boeing 737 MAX 8',
  B752: 'Boeing 757-200',
  B763: 'Boeing 767-300',
  B772: 'Boeing 777-200',
  B77W: 'Boeing 777-300ER',
  B788: 'Boeing 787-8',
  B789: 'Boeing 787-9',
  A319: 'Airbus A319',
  A320: 'Airbus A320',
  A321: 'Airbus A321',
  A20N: 'Airbus A320neo',
  A21N: 'Airbus A321neo',
  E75L: 'Embraer 175',
  E75S: 'Embraer 175',
  CRJ9: 'Bombardier CRJ900',
  DH8D: 'Dash 8 Q400',
  C172: 'Cessna 172',
  C208: 'Cessna Caravan',
  DHC6: 'DHC-6 Twin Otter',
  PC12: 'Pilatus PC-12',
  R44: 'Robinson R44',
  EC30: 'Eurocopter EC130'
};

export function typeName(t) {
  if (!t) return null;
  return TYPE_NAMES[t] || t;
}

export class AdsbClient {
  constructor() {
    /** @type {Map<string, object>} keyed by ICAO hex */
    this.aircraft = new Map();
    this._timer = null;
    this._center = null;
    this.lastError = null;
    this.lastOk = 0;
  }

  /** @param {{lat:number,lon:number}} center */
  start(center) {
    this._center = center;
    if (this._timer) return;
    const tick = () => this._poll();
    tick();
    this._timer = setInterval(tick, 6000);
  }

  setCenter(center) {
    this._center = center;
  }

  async _poll() {
    if (!this._center) return;
    const { lat, lon } = this._center;
    // adsb.lol: aircraft within `dist` nautical miles of a point. Key-less, CORS-enabled.
    const url = `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/40`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const now = Date.now();
      for (const ac of data.ac || []) {
        if (ac.lat == null || ac.lon == null) continue;
        const hex = ac.hex;
        this.aircraft.set(hex, {
          hex,
          flight: (ac.flight || '').trim(),
          reg: ac.r || '',
          type: ac.t || '',
          typeName: typeName(ac.t),
          lat: ac.lat,
          lon: ac.lon,
          altFt: ac.alt_baro === 'ground' ? 0 : ac.alt_baro,
          onGround: ac.alt_baro === 'ground',
          speedKt: ac.gs,
          track: ac.track,
          updated: now
        });
      }
      this.lastOk = now;
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message || 'network error';
    }
  }

  active(ttlMs = 30000) {
    const now = Date.now();
    const out = [];
    for (const a of this.aircraft.values()) {
      if (now - a.updated < ttlMs) out.push(a);
    }
    return out;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
