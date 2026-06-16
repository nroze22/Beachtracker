// Heads-up radar minimap: plots nearby AIS ships and ADS-B aircraft around the
// user by true bearing and distance, rotated so the top of the radar is the
// direction the phone is pointing. The target currently matched to an on-screen
// detection is highlighted, tying the camera view to the wider world.

import { bearingTo, distanceKm } from './geo.js';

const RANGE_KM = 30; // outer ring distance

export function drawRadar(ctx, { geo, vessels, aircraft, fovDeg, matchedKeys }) {
  const { canvas } = ctx;
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) / 2 - 6;
  ctx.clearRect(0, 0, W, H);

  // Backdrop
  ctx.fillStyle = 'rgba(6,16,26,0.72)';
  ctx.beginPath();
  ctx.arc(cx, cy, R + 5, 0, Math.PI * 2);
  ctx.fill();

  // Range rings
  ctx.strokeStyle = 'rgba(76,201,240,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (R * i) / 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Cross-hairs
  ctx.beginPath();
  ctx.moveTo(cx, cy - R);
  ctx.lineTo(cx, cy + R);
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.stroke();

  if (!geo.hasFix) {
    label(ctx, cx, cy, 'no GPS');
    return;
  }

  const headUp = geo.hasHeading;
  const heading = headUp ? geo.heading : 0;

  // Camera FOV wedge (points up when heads-up).
  if (headUp && fovDeg) {
    const half = ((fovDeg / 2) * Math.PI) / 180;
    ctx.fillStyle = 'rgba(76,201,240,0.16)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.fill();
  }

  // North marker
  const northAngle = (-heading * Math.PI) / 180 - Math.PI / 2;
  ctx.fillStyle = '#ff6b6b';
  const nx = cx + Math.cos(northAngle) * (R - 2);
  const ny = cy + Math.sin(northAngle) * (R - 2);
  ctx.beginPath();
  ctx.arc(nx, ny, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ff6b6b';
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx + Math.cos(northAngle) * (R - 12), cy + Math.sin(northAngle) * (R - 12));

  const plot = (o, draw) => {
    if (o.lat == null || o.lon == null) return;
    const dist = distanceKm(geo.lat, geo.lon, o.lat, o.lon);
    if (dist > RANGE_KM) return;
    const brg = (bearingTo(geo.lat, geo.lon, o.lat, o.lon) + 360) % 360;
    const rel = ((brg - heading + 540) % 360) - 180; // -180..180, 0 = straight ahead
    const a = (rel * Math.PI) / 180 - Math.PI / 2;
    const rr = (dist / RANGE_KM) * R;
    draw(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  };

  const isMatched = (key) => matchedKeys && matchedKeys.has(key);

  // Ships
  for (const v of vessels) {
    plot(v, (x, y) => {
      const on = isMatched(v.mmsi);
      ctx.fillStyle = on ? '#ffd166' : '#4cc9f0';
      ctx.beginPath();
      ctx.arc(x, y, on ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (on) ring(ctx, x, y);
    });
  }

  // Aircraft (little triangles)
  for (const a of aircraft) {
    plot(a, (x, y) => {
      const on = isMatched(a.hex);
      ctx.fillStyle = on ? '#ffd166' : '#f72585';
      triangle(ctx, x, y, on ? 5 : 3.4);
      if (on) ring(ctx, x, y);
    });
  }

  // Center (you)
  ctx.fillStyle = '#eaf6ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, x, y) {
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
}

function triangle(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x - s, y + s);
  ctx.lineTo(x + s, y + s);
  ctx.closePath();
  ctx.fill();
}

function label(ctx, cx, cy, text) {
  ctx.fillStyle = 'rgba(159,182,201,0.9)';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}
