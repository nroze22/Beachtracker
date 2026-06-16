// Draws tracked boxes, labels and matched identities onto the overlay canvas.

import { describe } from './classes.js';

export function sizeCanvas(canvas, video) {
  // Match the canvas backing store to the video's intrinsic resolution so our
  // detection-space coordinates line up 1:1 with what we draw.
  const w = video.videoWidth || canvas.clientWidth;
  const h = video.videoHeight || canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h };
}

export function draw(ctx, tracks, idents) {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / 640; // keep strokes/text readable at any res
  const lineW = Math.max(2, 2.4 * scale);
  const fontPx = Math.max(13, 15 * scale);
  ctx.lineWidth = lineW;
  ctx.font = `600 ${fontPx}px -apple-system, system-ui, sans-serif`;
  ctx.textBaseline = 'top';

  for (const t of tracks) {
    // Use the refined vessel subtype (fishing boat, ferry…) when known.
    const meta = t.subtype || describe(t.class);
    const [x, y, w, h] = t.bbox;
    const ident = idents.get(t.id);

    ctx.strokeStyle = meta.color;
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 4 * scale;
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Primary label: emoji + friendly name + track id.
    const pct = Math.round((t.score || 0) * 100);
    let line1 = `${meta.emoji} ${meta.label} #${t.id} · ${pct}%`;
    // Identity line (ship name / flight), if fused.
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

    drawLabel(ctx, x, y, [line1, line2].filter(Boolean), meta.color, scale, fontPx);
  }
}

function drawLabel(ctx, x, y, lines, color, scale, fontPx) {
  const padX = 6 * scale;
  const padY = 4 * scale;
  const lineH = fontPx * 1.25;
  let maxW = 0;
  for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
  const boxW = maxW + padX * 2;
  const boxH = lineH * lines.length + padY * 2;
  let ly = y - boxH;
  if (ly < 0) ly = y + 2; // flip below the box if it would clip the top

  ctx.fillStyle = 'rgba(8,18,30,0.78)';
  roundRect(ctx, x, ly, boxW, boxH, 5 * scale);
  ctx.fill();
  ctx.fillStyle = '#fff';
  // Accent bar on the left in the class colour.
  ctx.fillStyle = color;
  ctx.fillRect(x, ly, 3 * scale, boxH);

  ctx.fillStyle = '#fff';
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
