// Live ship identification via AISStream.io.
//
// Ships broadcast AIS messages (name, type, course, speed, destination). AISStream
// relays them over a WebSocket. You subscribe with a free API key and a bounding
// box; we keep a rolling table of nearby vessels keyed by MMSI. This is the
// "internet bonus" layer — if offline, it simply stays empty.

const SHIP_TYPE = {
  30: 'Fishing',
  31: 'Towing',
  32: 'Towing (long)',
  35: 'Military',
  36: 'Sailing',
  37: 'Pleasure craft',
  40: 'High-speed craft',
  50: 'Pilot vessel',
  51: 'Search & rescue',
  52: 'Tug',
  55: 'Law enforcement',
  60: 'Passenger',
  61: 'Passenger',
  69: 'Passenger',
  70: 'Cargo',
  71: 'Cargo',
  79: 'Cargo',
  80: 'Tanker',
  89: 'Tanker'
};

function shipTypeName(t) {
  if (t == null) return null;
  if (SHIP_TYPE[t]) return SHIP_TYPE[t];
  if (t >= 60 && t <= 69) return 'Passenger';
  if (t >= 70 && t <= 79) return 'Cargo';
  if (t >= 80 && t <= 89) return 'Tanker';
  if (t >= 40 && t <= 49) return 'High-speed craft';
  return 'Vessel';
}

export class AisClient {
  constructor() {
    /** @type {Map<string, object>} keyed by MMSI */
    this.vessels = new Map();
    this.ws = null;
    this.connected = false;
    this._reconnectTimer = null;
    this._key = '';
    this._box = null;
  }

  /** @param {{lat:number,lon:number}} center  half-size box ~0.35° (~25-40km). */
  start(apiKey, center) {
    this._key = apiKey;
    const pad = 0.35;
    this._box = [
      [center.lat - pad, center.lon - pad],
      [center.lat + pad, center.lon + pad]
    ];
    this._connect();
  }

  _connect() {
    if (!this._key) return;
    this.stop(true);
    let ws;
    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    } catch {
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      ws.send(
        JSON.stringify({
          APIKey: this._key,
          BoundingBoxes: [this._box],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        })
      );
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      const md = msg.MetaData || {};
      const mmsi = String(md.MMSI || md.MMSI_String || '');
      if (!mmsi) return;
      const v = this.vessels.get(mmsi) || { mmsi };
      v.name = (md.ShipName || v.name || '').trim();
      v.lat = md.latitude ?? v.lat;
      v.lon = md.longitude ?? v.lon;
      v.updated = Date.now();

      if (msg.MessageType === 'PositionReport') {
        const pr = msg.Message?.PositionReport || {};
        v.sog = pr.Sog; // speed over ground (knots)
        v.cog = pr.Cog; // course over ground (deg)
        v.heading = pr.TrueHeading;
      } else if (msg.MessageType === 'ShipStaticData') {
        const sd = msg.Message?.ShipStaticData || {};
        v.typeCode = sd.Type;
        v.typeName = shipTypeName(sd.Type);
        v.destination = (sd.Destination || '').trim();
        v.callsign = (sd.CallSign || '').trim();
      }
      this.vessels.set(mmsi, v);
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      this.connected = false;
      this._scheduleReconnect();
    };
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._key) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, 5000);
  }

  /** Vessels seen in the last `ttlMs`, with a known position. */
  active(ttlMs = 120000) {
    const now = Date.now();
    const out = [];
    for (const v of this.vessels.values()) {
      if (v.lat != null && now - v.updated < ttlMs) out.push(v);
    }
    return out;
  }

  stop(keepKey = false) {
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (!keepKey) this._key = '';
  }
}
