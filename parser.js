// Star Battle puzzle screenshot parser

export const DEFAULTS = {
  colorDist:   50,   // max RGB distance between adjacent cells to treat as same region
  starThresh:   6,   // % of scan area that must be dark to call it a star
  markThresh:   3,   // % of scan area that must be red to call it an X
  gridThresh:  25,   // % of peak colorful-row density required to count as grid
  scanSize:    35,   // % of cell half-width used as mark scan radius
};

export async function parsePuzzle(imageSource, gridSize, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { ctx, grid, n, cellW, cellH } = await prepareGrid(imageSource, gridSize, o);
  const { bgColors, marks } = sampleCells(ctx, grid, n, cellW, cellH, o);
  const regions = labelRegions(bgColors, ctx, grid, n, cellW, cellH, o.colorDist);
  return formatOutput(regions, marks, n);
}

export async function parsePuzzleDebug(imageSource, gridSize, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { ctx, grid, n, cellW, cellH } = await prepareGrid(imageSource, gridSize, o);
  const { bgColors, marks } = sampleCells(ctx, grid, n, cellW, cellH, o);
  const regions  = labelRegions(bgColors, ctx, grid, n, cellW, cellH, o.colorDist);
  const numRegions = regions.flat().reduce((m, v) => Math.max(m, v), 0) + 1;
  const centroids  = computeCentroids(bgColors, regions, n, numRegions);
  return { text: formatOutput(regions, marks, n), grid, cellW, cellH, n, regions, marks, bgColors, centroids };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function prepareGrid(imageSource, gridSize, o) {
  const img = await loadImage(imageSource);
  const { canvas, ctx } = toCanvas(img);
  const grid = findGridBounds(ctx, canvas.width, canvas.height, o.gridThresh / 100);
  if (!grid) throw new Error('Could not detect puzzle grid');
  const n = gridSize;
  return { ctx, grid, n, cellW: grid.w / n, cellH: grid.h / n };
}

function sampleCells(ctx, grid, n, cellW, cellH, o) {
  const bgColors = Array.from({ length: n }, () => new Array(n).fill(null));
  const marks    = Array.from({ length: n }, () => new Array(n).fill(''));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cx = grid.x + (c + 0.5) * cellW;
      const cy = grid.y + (r + 0.5) * cellH;
      bgColors[r][c] = sampleBackground(ctx, cx, cy, cellW, cellH);
      marks[r][c]    = detectMark(ctx, cx, cy, cellW, cellH,
                         o.starThresh / 100, o.markThresh / 100, o.scanSize / 100);
    }
  }
  return { bgColors, marks };
}

// ── Region labelling ──────────────────────────────────────────────────────────

// BFS flood-fill that only crosses a boundary when BOTH conditions hold:
//   1. The border between the two cells is thin (not a region boundary line)
//   2. The two cell background colors are within colorDist of each other
// This correctly separates same-colored but non-connected regions.
function labelRegions(bgColors, ctx, grid, n, cellW, cellH, colorDist) {
  const { hBorders, vBorders, thickThreshold } =
    computeBorders(ctx, grid, n, cellW, cellH);

  const isThick = (r, c, dr, dc) => {
    if (dr ===  1) return r < n-1 ? hBorders[r][c]   >= thickThreshold : true;
    if (dr === -1) return r > 0   ? hBorders[r-1][c] >= thickThreshold : true;
    if (dc ===  1) return c < n-1 ? vBorders[r][c]   >= thickThreshold : true;
    if (dc === -1) return c > 0   ? vBorders[r][c-1] >= thickThreshold : true;
    return true;
  };

  const regions = Array.from({ length: n }, () => new Array(n).fill(-1));
  let nextId = 0;

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (regions[r][c] !== -1) continue;
      const queue = [[r, c]];
      regions[r][c] = nextId;
      let qi = 0;
      while (qi < queue.length) {
        const [cr, cc] = queue[qi++];
        const color = bgColors[cr][cc];
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
          if (regions[nr][nc] !== -1) continue;
          if (!isThick(cr, cc, dr, dc) && rgbDist(color, bgColors[nr][nc]) <= colorDist) {
            regions[nr][nc] = nextId;
            queue.push([nr, nc]);
          }
        }
      }
      nextId++;
    }
  }

  return regions;
}

// Read the full grid region once, then measure the max consecutive dark-pixel
// run perpendicular to each inter-cell boundary.
// hBorders[r][c] = thickness of border between row r and r+1 at column c
// vBorders[r][c] = thickness of border between col c and c+1 at row r
function computeBorders(ctx, grid, n, cellW, cellH) {
  const gw   = Math.ceil(grid.w);
  const gh   = Math.ceil(grid.h);
  const data = ctx.getImageData(Math.round(grid.x), Math.round(grid.y), gw, gh).data;

  const isDark = (gx, gy) => {
    const ix = Math.round(gx), iy = Math.round(gy);
    if (ix < 0 || iy < 0 || ix >= gw || iy >= gh) return false;
    const i = (iy * gw + ix) * 4;
    return data[i] < 80 && data[i+1] < 80 && data[i+2] < 80;
  };

  const HALF = 8; // scan ±8px perpendicular to each boundary

  // Scan perpendicular to a boundary and return the max dark-pixel run length.
  // isVerticalBoundary=true  → boundary is a vertical line  → scan horizontally
  // isVerticalBoundary=false → boundary is a horizontal line → scan vertically
  const thickness = (bx, by, isVerticalBoundary) => {
    const x0 = Math.round(bx), y0 = Math.round(by);
    let maxRun = 0, run = 0;
    for (let d = -HALF; d < HALF; d++) {
      const dark = isVerticalBoundary ? isDark(x0 + d, y0) : isDark(x0, y0 + d);
      if (dark) { run++; if (run > maxRun) maxRun = run; } else run = 0;
    }
    return maxRun;
  };

  const hBorders = Array.from({ length: n - 1 }, (_, r) =>
    Array.from({ length: n }, (_, c) =>
      thickness((c + 0.5) * cellW, (r + 1) * cellH, false) // horizontal line → scan vertically
    )
  );

  const vBorders = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n - 1 }, (_, c) =>
      thickness((c + 1) * cellW, (r + 0.5) * cellH, true) // vertical line → scan horizontally
    )
  );

  // Adaptive threshold: the majority of borders are thin (within-region);
  // the median is therefore a thin border. Region borders are noticeably thicker.
  const all = [...hBorders.flat(), ...vBorders.flat()].sort((a, b) => a - b);
  const median = all[Math.floor(all.length / 2)] || 1;
  const thickThreshold = Math.max(3, Math.round(median * 1.8));

  return { hBorders, vBorders, thickThreshold };
}

function computeCentroids(bgColors, regions, n, numRegions) {
  const sums = Array.from({ length: numRegions }, () => [0, 0, 0, 0]);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = regions[r][c];
      const [R, G, B] = bgColors[r][c];
      sums[id][0] += R; sums[id][1] += G; sums[id][2] += B; sums[id][3]++;
    }
  }
  return sums.map(([r, g, b, cnt]) => cnt > 0 ? [r/cnt, g/cnt, b/cnt] : [128, 128, 128]);
}

// ── Image / canvas helpers ────────────────────────────────────────────────────

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
  canvas.width  = img.naturalWidth  || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx };
}

function findGridBounds(ctx, w, h, threshFraction) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const isColorful = (x, y) => {
    const i = (y * w + x) * 4;
    const R = data[i], G = data[i+1], B = data[i+2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
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
  const rowThresh = rowMax * threshFraction;
  const colThresh = colMax * threshFraction;
  let y0 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    if (rowCounts[y] >= rowThresh) { if (y0 < 0) y0 = y; y1 = y; }
  }
  let x0 = -1, x1 = -1;
  for (let x = 0; x < w; x++) {
    if (colCounts[x] >= colThresh) { if (x0 < 0) x0 = x; x1 = x; }
  }
  if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;
  const pad = Math.round(Math.min(x1 - x0, y1 - y0) * 0.012) + 1;
  return { x: x0 + pad, y: y0 + pad, w: (x1 - x0) - pad * 2, h: (y1 - y0) - pad * 2 };
}

function sampleBackground(ctx, cx, cy, cellW, cellH) {
  const pts = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = Math.round(cx + dx * cellW * 0.28);
      const y = Math.round(cy + dy * cellH * 0.28);
      const p = ctx.getImageData(x, y, 1, 1).data;
      const [R, G, B] = [p[0], p[1], p[2]];
      const isDark = R < 70 && G < 70 && B < 70;
      const isRed  = R > 140 && G < 120 && B < 120 && R > G + 40;
      if (!isDark && !isRed) pts.push([R, G, B]);
    }
  }
  if (pts.length === 0) {
    const p = ctx.getImageData(Math.round(cx), Math.round(cy), 1, 1).data;
    return [p[0], p[1], p[2]];
  }
  pts.sort((a, b) => (a[0]+a[1]+a[2]) - (b[0]+b[1]+b[2]));
  return pts[Math.floor(pts.length / 2)];
}

function detectMark(ctx, cx, cy, cellW, cellH, starThresh, markThresh, scanFrac) {
  const r  = Math.max(3, Math.round(Math.min(cellW, cellH) * scanFrac));
  const px = ctx.getImageData(Math.round(cx - r), Math.round(cy - r), r*2, r*2).data;
  const total = (r*2) * (r*2);
  let redCount = 0, darkCount = 0;
  for (let i = 0; i < px.length; i += 4) {
    const [R, G, B] = [px[i], px[i+1], px[i+2]];
    if (R < 80 && G < 80 && B < 80) darkCount++;
    if (R > 140 && G < 120 && B < 120 && R > G + 40) redCount++;
  }
  if (darkCount / total > starThresh) return 's';
  if (redCount  / total > markThresh) return 'x';
  return '';
}

function rgbDist([r1,g1,b1],[r2,g2,b2]) {
  return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
}

function formatOutput(regions, marks, n) {
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => `${regions[r][c]}${marks[r][c]}`).join(' ')
  ).join('\n');
}
