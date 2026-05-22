// Star Battle puzzle screenshot parser

export async function parsePuzzle(imageSource, gridSize) {
  const img = await loadImage(imageSource);
  const { canvas, ctx } = toCanvas(img);
  const grid = findGridBounds(ctx, canvas.width, canvas.height);
  if (!grid) throw new Error('Could not detect puzzle grid');

  const n = gridSize;
  const cellW = grid.w / n;
  const cellH = grid.h / n;

  const centroids = [];
  const regions = Array.from({ length: n }, () => new Array(n).fill(0));
  const marks = Array.from({ length: n }, () => new Array(n).fill(''));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = grid.x + (c + 0.5) * cellW;
      const cy = grid.y + (r + 0.5) * cellH;
      const bg = sampleBackground(ctx, cx, cy, cellW, cellH);
      regions[r][c] = matchOrCreateRegion(bg, centroids, 50);
      marks[r][c] = detectMark(ctx, cx, cy, cellW, cellH);
    }
  }

  return formatOutput(regions, marks, n);
}

// Also export grid + cell data for debug overlay
export async function parsePuzzleDebug(imageSource, gridSize) {
  const img = await loadImage(imageSource);
  const { canvas, ctx } = toCanvas(img);
  const grid = findGridBounds(ctx, canvas.width, canvas.height);
  if (!grid) throw new Error('Could not detect puzzle grid');

  const n = gridSize;
  const cellW = grid.w / n;
  const cellH = grid.h / n;

  const centroids = [];
  const regions = Array.from({ length: n }, () => new Array(n).fill(0));
  const marks = Array.from({ length: n }, () => new Array(n).fill(''));
  const bgColors = Array.from({ length: n }, () => new Array(n).fill(null));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = grid.x + (c + 0.5) * cellW;
      const cy = grid.y + (r + 0.5) * cellH;
      const bg = sampleBackground(ctx, cx, cy, cellW, cellH);
      regions[r][c] = matchOrCreateRegion(bg, centroids, 50);
      marks[r][c] = detectMark(ctx, cx, cy, cellW, cellH);
      bgColors[r][c] = bg;
    }
  }

  return {
    text: formatOutput(regions, marks, n),
    grid, cellW, cellH, n,
    regions, marks, bgColors, centroids
  };
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

// Find the puzzle grid using per-row/column colorfulness profiles.
// Uses OUTER EXTENT (first + last above threshold) rather than longest run,
// so thick region borders inside the grid don't split the detection in two.
// Uses saturation-based colorfulness rather than brightness so dark borders
// and a dark phone background are both cleanly excluded.
function findGridBounds(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;

  // A pixel is "colorful" if it has a distinct hue and is reasonably bright.
  // Dark borders (R,G,B all <70) and grayscale phone-UI elements fail this test;
  // the pastel/primary cell colors pass it.
  const isColorful = (x, y) => {
    const i = (y * w + x) * 4;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const mx = Math.max(R, G, B);
    const mn = Math.min(R, G, B);
    return mx > 100 && (mx - mn) > 40;
  };

  let rowMax = 0;
  const rowCounts = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let cnt = 0;
    for (let x = 0; x < w; x += 2) if (isColorful(x, y)) cnt++;
    rowCounts[y] = cnt;
    if (cnt > rowMax) rowMax = cnt;
  }

  let colMax = 0;
  const colCounts = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let cnt = 0;
    for (let y = 0; y < h; y += 2) if (isColorful(x, y)) cnt++;
    colCounts[x] = cnt;
    if (cnt > colMax) colMax = cnt;
  }

  if (rowMax === 0 || colMax === 0) return null;

  // Use FIRST and LAST row/col above 25% of peak — this spans the full grid
  // including rows that dip low due to thick region borders inside the grid.
  const rowThresh = rowMax * 0.25;
  const colThresh = colMax * 0.25;

  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    if (rowCounts[y] >= rowThresh) { if (y0 < 0) y0 = y; y1 = y; }
  }
  let x0 = -1, x1 = -1;
  for (let x = 0; x < w; x++) {
    if (colCounts[x] >= colThresh) { if (x0 < 0) x0 = x; x1 = x; }
  }

  if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;

  // Small inset to skip the outer frame/border pixels
  const pad = Math.round(Math.min(x1 - x0, y1 - y0) * 0.012) + 1;
  return { x: x0 + pad, y: y0 + pad, w: (x1 - x0) - pad * 2, h: (y1 - y0) - pad * 2 };
}

// Sample the cell background color.
// Samples a 3×3 grid of points spread across the cell interior,
// filters out dark border pixels and red X-mark pixels, returns median.
function sampleBackground(ctx, cx, cy, cellW, cellH) {
  const inset = Math.min(cellW, cellH) * 0.22;
  const pts = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(cx + dx * (cellW * 0.28));
      const y = Math.round(cy + dy * (cellH * 0.28));
      const p = ctx.getImageData(x, y, 1, 1).data;
      const [R, G, B] = [p[0], p[1], p[2]];
      const isDark = R < 70 && G < 70 && B < 70;
      const isRed = R > 140 && G < 120 && B < 120 && R > G + 40;
      if (!isDark && !isRed) pts.push([R, G, B]);
    }
  }
  if (pts.length === 0) {
    const p = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
    return [p[0], p[1], p[2]];
  }
  // Return median by brightness
  pts.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  return pts[Math.floor(pts.length / 2)];
}

// Nearest-centroid region assignment with dynamic centroid creation
function matchOrCreateRegion(color, centroids, threshold) {
  let bestDist = Infinity, bestId = -1;
  for (let i = 0; i < centroids.length; i++) {
    const d = rgbDist(color, centroids[i]);
    if (d < bestDist) { bestDist = d; bestId = i; }
  }
  if (bestDist < threshold) {
    // Update centroid with exponential moving average (weight 0.15 for new sample)
    const c = centroids[bestId];
    centroids[bestId] = [
      c[0] * 0.85 + color[0] * 0.15,
      c[1] * 0.85 + color[1] * 0.15,
      c[2] * 0.85 + color[2] * 0.15,
    ];
    return bestId;
  }
  centroids.push([color[0], color[1], color[2]]);
  return centroids.length - 1;
}

function rgbDist([r1, g1, b1], [r2, g2, b2]) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

// Detect what mark is in a cell: '' | 'x' | 's'
// Scans a region equal to 35% of cell size around the center.
// Stars are large dark glyphs; X marks are red.
function detectMark(ctx, cx, cy, cellW, cellH) {
  const r = Math.max(3, Math.round(Math.min(cellW, cellH) * 0.35));
  const sx = Math.round(cx - r), sy = Math.round(cy - r);
  const side = r * 2;
  const px = ctx.getImageData(sx, sy, side, side).data;

  let redCount = 0, darkCount = 0;
  const total = side * side;

  for (let i = 0; i < px.length; i += 4) {
    const [R, G, B] = [px[i], px[i + 1], px[i + 2]];
    if (R < 80 && G < 80 && B < 80) darkCount++;
    if (R > 140 && G < 120 && B < 120 && R > G + 40) redCount++;
  }

  // Stars are solid black shapes — larger dark area than X marks
  if (darkCount / total > 0.06) return 's';
  if (redCount / total > 0.03) return 'x';
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
