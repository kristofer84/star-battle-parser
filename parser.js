// Star Battle puzzle screenshot parser
// Returns a formatted string representing the puzzle grid

export async function parsePuzzle(imageSource, gridSize) {
  const img = await loadImage(imageSource);
  const { canvas, ctx } = toCanvas(img);
  const grid = findGridBounds(ctx, canvas.width, canvas.height);
  if (!grid) throw new Error('Could not detect puzzle grid');

  const n = gridSize;
  const cellW = grid.w / n;
  const cellH = grid.h / n;

  const regionColors = [];
  const colorMap = new Map(); // colorKey -> regionId
  let nextId = 0;

  const regions = Array.from({ length: n }, () => new Array(n).fill(0));
  const marks = Array.from({ length: n }, () => new Array(n).fill(''));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = grid.x + (c + 0.5) * cellW;
      const cy = grid.y + (r + 0.5) * cellH;

      const bg = sampleBackground(ctx, cx, cy, cellW * 0.25);
      const key = quantizeColor(bg);

      if (!colorMap.has(key)) {
        colorMap.set(key, nextId++);
        regionColors.push(bg);
      }
      regions[r][c] = colorMap.get(key);

      marks[r][c] = detectMark(ctx, cx, cy, cellW, cellH);
    }
  }

  return formatOutput(regions, marks, n);
}

function loadImage(src) {
  return new Promise((res, rej) => {
    if (src instanceof HTMLImageElement) return res(src);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

function toCanvas(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

function findGridBounds(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;

  const isDark = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = (y * w + x) * 4;
    return data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80;
  };

  // Find bounding box of dark pixels
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isDark(x, y)) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }

  if (x1 <= x0 || y1 <= y0) return null;

  // Inset slightly to skip the outer border itself
  const pad = Math.round(Math.min((x1 - x0), (y1 - y0)) * 0.015) + 2;
  return { x: x0 + pad, y: y0 + pad, w: (x1 - x0) - pad * 2, h: (y1 - y0) - pad * 2 };
}

// Sample background color from a small center patch, avoiding cell marks
function sampleBackground(ctx, cx, cy, radius) {
  const r = Math.max(2, Math.round(radius));
  const px = ctx.getImageData(Math.round(cx - r), Math.round(cy - r), r * 2, r * 2).data;

  // Collect non-dark, non-red pixels (skip marks)
  const samples = [];
  for (let i = 0; i < px.length; i += 4) {
    const [R, G, B] = [px[i], px[i + 1], px[i + 2]];
    const isDark = R < 60 && G < 60 && B < 60;
    const isRedMark = R > 150 && G < 100 && B < 100;
    if (!isDark && !isRedMark) samples.push([R, G, B]);
  }

  if (samples.length === 0) {
    // fallback: single center pixel
    const p = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
    return [p[0], p[1], p[2]];
  }

  const avg = samples.reduce(([ar, ag, ab], [r, g, b]) => [ar + r, ag + g, ab + b], [0, 0, 0]);
  return avg.map(v => Math.round(v / samples.length));
}

// Quantize RGB to a string key for color grouping (tolerance ~20 per channel)
function quantizeColor([r, g, b]) {
  const q = 28;
  return `${Math.round(r / q) * q},${Math.round(g / q) * q},${Math.round(b / q) * q}`;
}

// Detect what mark is in a cell: '' | 'x' | 's'
function detectMark(ctx, cx, cy, cellW, cellH) {
  const r = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.3));
  const px = ctx.getImageData(Math.round(cx - r), Math.round(cy - r), r * 2, r * 2).data;

  let redCount = 0;
  let darkCount = 0;

  for (let i = 0; i < px.length; i += 4) {
    const [R, G, B] = [px[i], px[i + 1], px[i + 2]];
    // Red X mark
    if (R > 150 && G < 110 && B < 110) redCount++;
    // Dark star glyph (black on colored background)
    if (R < 80 && G < 80 && B < 80) darkCount++;
  }

  const total = (r * 2) * (r * 2);
  if (darkCount / total > 0.08) return 's';
  if (redCount / total > 0.04) return 'x';
  return '';
}

function formatOutput(regions, marks, n) {
  const rows = [];
  for (let r = 0; r < n; r++) {
    const cols = [];
    for (let c = 0; c < n; c++) {
      cols.push(`${regions[r][c]}${marks[r][c]}`);
    }
    rows.push(cols.join(' '));
  }
  return rows.join('\n');
}
