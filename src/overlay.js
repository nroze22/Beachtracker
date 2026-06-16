// Draws tracked objects as smooth, confidence-styled corner-bracket reticles
// with identity labels. Boxes are interpolated frame-to-frame so they glide
// onto the target instead of snapping.

import { describe } from './classes.js';

// Per-track render state for smoothing (id -> {x,y,w,h}).
const render = new Map();

export function sizeCanvas(canvas, video) {
  const w = video.videoWidth || canvas.clientWidth;
  const h = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function draw(ctx, tracks, idents, zoom = 1) {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width;
  const H = canvas.height;
  const scale = W / 640;
  const fontPx = Math.max(13, 15 * scale);
  ctx.font = `600 ${fontPx}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  // Map a video-space box into on-screen canvas space for the current zoom
  // (scale about centre). Text size is deliberately left untouched by zoom.
  const place = (b) => [
    W / 2 + (b.x - W / 2) * zoom,
    H / 2 + (b.y - H / 2) * zoom,
    b.w * zoom,
    b.h * zoom
  ];

  const live = new Set();

  for (const t of tracks) {
    live.add(t.id);
    const meta = t.subtype || describe(t.class);
    const ident = idents.get(t.id);

    // Smooth the drawn box toward the tracker's target box (gentle = calm).
    let r = render.get(t.id);
    if (!r) {
      r = { x: t.bbox[0], y: t.bbox[1], w: t.bbox[2], h: t.bbox[3] };
      render.set(t.id, r);
    } else {
      const k = 0.22;
      r.x = lerp(r.x, t.bbox[0], k);
      r.y = lerp(r.y, t.bbox[1], k);
      r.w = lerp(r.w, t.bbox[2], k);
      r.h = lerp(r.h, t.bbox[3], k);
    }

    const [dx, dy, dw, dh] = place(r);
    const d = { x: dx, y: dy, w: dw, h: dh };

    const score = t.score || 0;
    const alpha = Math.max(0.55, Math.min(1, score + 0.25));
    drawReticle(ctx, d, meta.color, scale, alpha);

    const pct = Math.round(score * 100);
    const line1 = `${meta.emoji} ${meta.label} · ${pct}%`;
    let line2 = null;
    if (ident) {
      if (ident.kind === 'boat') {
        const bits = [ident.name || `MMSI ${ident.mmsi}`];
        if (ident.typeName) bits.push(ident.typeName);
        if (ident.sog != null) bits.push(`${Math.round(ident.sog)} kn`);
        line2 = `🛰 ${bits.join(' · ')}`;
      } else {
        const bits = [ident.flight || ident.reg || ident.hex];
        if (ident.typeName) bits.push(ident.typeName);
        if (ident.altFt) bits.push(`${Math.round(ident.altFt / 100) * 100} ft`);
        line2 = `🛰 ${bits.join(' · ')}`;
      }
    }
    drawLabel(ctx, d.x, d.y, [line1, line2].filter(Boolean), meta.color, scale, fontPx);
  }

  // Drop render state for retired tracks.
  for (const id of [...render.keys()]) if (!live.has(id)) render.delete(id);
}

function drawReticle(ctx, r, color, scale, alpha) {
  const { x, y, w, h } = r;
  const len = Math.max(10, Math.min(w, h) * 0.22);
  const lw = Math.max(2.5, 3 * scale);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 4 * scale;

  // Four L-shaped corner brackets.
  const corners = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1]
  ];
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of corners) {
    ctx.moveTo(cx, cy + sy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * len, cy);
  }
  ctx.stroke();

  // Faint full outline for context.
  ctx.globalAlpha = alpha * 0.18;
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawLabel(ctx, x, y, lines, color, scale, fontPx) {
  const padX = 7 * scale;
  const padY = 4 * scale;
  const lineH = fontPx * 1.25;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const boxW = maxW + padX * 2 + 3 * scale;
  const boxH = lineH * lines.length + padY * 2;
  let ly = y - boxH - 2 * scale;
  if (ly < 0) ly = y + 2;

  ctx.fillStyle = 'rgba(8,18,30,0.82)';
  roundRect(ctx, x, ly, boxW, boxH, 6 * scale);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x, ly, 3.5 * scale, boxH, 2 * scale);
  ctx.fill();

  let ty = ly + padY;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = i === 0 ? '#fff' : '#bfe9ff';
    ctx.fillText(lines[i], x + padX + 3 * scale, ty);
    ty += lineH;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
