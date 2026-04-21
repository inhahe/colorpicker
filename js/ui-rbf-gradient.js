/**
 * ui-rbf-gradient.js  --  RBF (Radial Basis Function) 2D gradient extrapolation
 *
 * Lets the user place arbitrary color data points on the 2D picker canvas.
 * The entire canvas surface is filled by interpolating between the placed
 * points using thin-plate spline RBF interpolation.
 *
 * Usage:
 *   import { RBFGradient } from './ui-rbf-gradient.js';
 *   const rbf = new RBFGradient(pickerCanvas, state, engine);
 */

// ---------------------------------------------------------------------------
//  RBF math helpers
// ---------------------------------------------------------------------------

/** Thin-plate spline basis function: phi(r) = r^2 * ln(r). */
function tps(r) {
  if (r < 1e-10) return 0;
  return r * r * Math.log(r);
}

/**
 * Solve Ax = b via Gaussian elimination with partial pivoting.
 * A is modified in-place. Returns the solution vector x.
 * @param {number[][]} A  N x N matrix
 * @param {number[]}   b  N-vector
 * @returns {number[]}    N-vector solution
 */
function solve(A, b) {
  const n = A.length;
  // Augmented matrix
  const aug = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find the row with the largest absolute value in this column
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    // Swap rows
    if (maxRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[maxRow];
      aug[maxRow] = tmp;
    }

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) continue; // singular or near-singular

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / pivot;
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let j = row + 1; j < n; j++) {
      sum -= aug[row][j] * x[j];
    }
    const diag = aug[row][row];
    x[row] = Math.abs(diag) < 1e-12 ? 0 : sum / diag;
  }
  return x;
}

/**
 * Compute RBF weights for a set of data points.
 * @param {{x: number, y: number, color: number[]}[]} points
 * @returns {{weightsR: number[], weightsG: number[], weightsB: number[]}}
 */
function computeWeights(points) {
  const n = points.length;
  if (n === 0) return { weightsR: [], weightsG: [], weightsB: [] };

  // Build the N x N RBF matrix
  const A = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const r = Math.sqrt(dx * dx + dy * dy);
      row.push(tps(r));
    }
    A.push(row);
  }

  // Solve for each color channel independently
  const rVals = points.map(p => p.color[0]);
  const gVals = points.map(p => p.color[1]);
  const bVals = points.map(p => p.color[2]);

  // Clone A for each solve since it's modified in-place
  const weightsR = solve(A.map(r => [...r]), rVals);
  const weightsG = solve(A.map(r => [...r]), gVals);
  const weightsB = solve(A.map(r => [...r]), bVals);

  return { weightsR, weightsG, weightsB };
}

/**
 * Evaluate the RBF at a given (x, y) position.
 * @param {number} x  Normalized 0-1
 * @param {number} y  Normalized 0-1
 * @param {{x: number, y: number}[]} points
 * @param {number[]} weightsR
 * @param {number[]} weightsG
 * @param {number[]} weightsB
 * @returns {[number, number, number]}  RGB clamped to 0-255
 */
function evaluateRBF(x, y, points, weightsR, weightsG, weightsB) {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < points.length; i++) {
    const dx = x - points[i].x;
    const dy = y - points[i].y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const phi = tps(dist);
    r += weightsR[i] * phi;
    g += weightsG[i] * phi;
    b += weightsB[i] * phi;
  }
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

// ---------------------------------------------------------------------------
//  RBFGradient class
// ---------------------------------------------------------------------------

const POINT_RADIUS = 7;
const POINT_HIT_RADIUS = 12;

export class RBFGradient {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {import('./state.js').AppState} */
  #state;
  /** @type {import('./color-engine.js').ColorEngine} */
  #engine;

  /** @type {{x: number, y: number, color: number[]}[]} */
  #points = [];

  /** @type {boolean} */
  #active = false;

  /** @type {HTMLButtonElement|null} */
  #button = null;

  // Cached RBF result
  /** @type {ImageData|null} */
  #cachedImage = null;
  /** @type {string} */
  #cacheKey = '';

  // Precomputed weights
  #weightsR = [];
  #weightsG = [];
  #weightsB = [];

  // Overlay canvas for drawing data-point dots (avoids overwriting the gradient)
  /** @type {HTMLCanvasElement} */
  #overlayCanvas = null;

  // Drag state
  #dragIndex = -1;
  #isDragging = false;

  // Bound handlers (for removal)
  #boundMouseDown = null;
  #boundMouseMove = null;
  #boundMouseUp = null;
  #boundContextMenu = null;
  #boundDragOver = null;
  #boundDrop = null;

  constructor(pickerCanvas, state, engine) {
    this.#canvas = pickerCanvas;
    this.#state = state;
    this.#engine = engine;

    // Create the toggle button and insert it into picker controls
    this.#createButton();

    // Create the overlay canvas for data-point markers
    this.#createOverlay();

    // Bind event handlers
    this.#boundMouseDown = (e) => this.#onMouseDown(e);
    this.#boundMouseMove = (e) => this.#onMouseMove(e);
    this.#boundMouseUp = (e) => this.#onMouseUp(e);
    this.#boundContextMenu = (e) => this.#onContextMenu(e);
    this.#boundDragOver = (e) => this.#onDragOver(e);
    this.#boundDrop = (e) => this.#onDrop(e);
  }

  // ---- Public API ----------------------------------------------------------

  /** Whether RBF mode is currently active. */
  get active() {
    return this.#active;
  }

  // Three modes: 'off' | 'edit' | 'use'
  // edit = place/move/remove points (overlay intercepts clicks)
  // use = gradient visible, clicks pick colors from it (overlay visible but click passes through to color picking)
  // off = gradient hidden, normal picker
  #mode = 'off';

  /** Cycle through modes: off → edit → use → off */
  toggle() {
    if (this.#mode === 'off') {
      this.#setMode('edit');
    } else if (this.#mode === 'edit') {
      this.#setMode('use');
    } else {
      this.#setMode('off');
    }
  }

  #setMode(mode) {
    this.#mode = mode;
    this.#active = mode === 'edit';

    const target = this.#overlayCanvas;

    if (mode === 'edit') {
      // Edit mode: button blue, overlay intercepts clicks for adding/moving points
      if (this.#button) {
        this.#button.style.background = '#2a6cb8';
        this.#button.style.color = '#fff';
        this.#button.style.borderColor = '#4a90d9';
        this.#button.textContent = 'RBF: Edit';
      }
      target.addEventListener('mousedown', this.#boundMouseDown);
      target.addEventListener('contextmenu', this.#boundContextMenu);
      target.addEventListener('dragover', this.#boundDragOver);
      target.addEventListener('drop', this.#boundDrop);
      target.style.display = 'block';
      target.style.pointerEvents = 'auto';
      this.#renderGradient();
      this.#renderOverlay();

    } else if (mode === 'use') {
      // Use mode: button green, gradient visible, clicks pass through to pick colors
      if (this.#button) {
        this.#button.style.background = '#2a8c3a';
        this.#button.style.color = '#fff';
        this.#button.style.borderColor = '#4ad94a';
        this.#button.textContent = 'RBF: On';
      }
      target.removeEventListener('mousedown', this.#boundMouseDown);
      target.removeEventListener('contextmenu', this.#boundContextMenu);
      target.removeEventListener('dragover', this.#boundDragOver);
      target.removeEventListener('drop', this.#boundDrop);
      document.removeEventListener('mousemove', this.#boundMouseMove);
      document.removeEventListener('mouseup', this.#boundMouseUp);
      // Keep overlay visible but let clicks pass through to the picker canvas
      target.style.display = 'block';
      target.style.pointerEvents = 'none';
      // Re-render gradient without point markers
      this.#renderGradient();
      // Clear any point markers from the overlay
      const octx = target.getContext('2d');
      if (octx) octx.clearRect(0, 0, target.width, target.height);
      this.#renderGradient();

    } else {
      // Off: hide everything, restore normal picker
      if (this.#button) {
        this.#button.style.background = '';
        this.#button.style.color = '';
        this.#button.style.borderColor = '';
        this.#button.textContent = 'RBF';
      }
      target.removeEventListener('mousedown', this.#boundMouseDown);
      target.removeEventListener('contextmenu', this.#boundContextMenu);
      target.removeEventListener('dragover', this.#boundDragOver);
      target.removeEventListener('drop', this.#boundDrop);
      document.removeEventListener('mousemove', this.#boundMouseMove);
      document.removeEventListener('mouseup', this.#boundMouseUp);
      target.style.display = 'none';
      target.style.pointerEvents = 'auto';
      const picker = this.#state.get('picker');
      this.#state.set('picker', { ...picker });
    }
  }

  /** @deprecated — use toggle() */
  activate() { this.#setMode('edit'); }
  deactivate() { this.#setMode('off'); }

  // ---- UI setup ------------------------------------------------------------

  #createButton() {
    const btn = document.createElement('button');
    btn.id = 'btn-rbf-gradient';
    btn.className = 'small-btn';
    btn.title = 'Place color points to create a 2D gradient via RBF interpolation';
    btn.textContent = 'RBF';
    btn.addEventListener('click', () => this.toggle());

    // Insert into picker controls, after the axis buttons row
    const pickerControls = document.getElementById('picker-controls');
    if (pickerControls) {
      // Insert after the separator that follows the axis buttons
      const separators = pickerControls.querySelectorAll('.palette-separator');
      if (separators.length > 0) {
        // Insert before the first separator
        pickerControls.insertBefore(btn, separators[0]);
      } else {
        pickerControls.appendChild(btn);
      }
    }

    this.#button = btn;
  }

  #createOverlay() {
    const container = this.#canvas.parentElement;
    if (!container) return;

    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;cursor:crosshair;z-index:2;';
    container.appendChild(overlay);

    // Sync size with picker canvas via ResizeObserver
    const syncSize = () => {
      const w = this.#canvas.width;
      const h = this.#canvas.height;
      if (overlay.width !== w || overlay.height !== h) {
        overlay.width = w;
        overlay.height = h;
        if (this.#active) {
          this.#invalidateCache();
          this.#renderGradient();
          this.#renderOverlay();
        }
      }
    };
    const ro = new ResizeObserver(syncSize);
    ro.observe(this.#canvas);
    syncSize();

    this.#overlayCanvas = overlay;
  }

  // ---- Mouse interaction ---------------------------------------------------

  #canvasPos(e) {
    const rect = this.#overlayCanvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(e.clientY - rect.top, rect.height)),
    };
  }

  #normalizePos(px, py) {
    const rect = this.#overlayCanvas.getBoundingClientRect();
    return {
      x: px / (rect.width || 1),
      y: py / (rect.height || 1),
    };
  }

  #findPointAt(px, py) {
    const rect = this.#overlayCanvas.getBoundingClientRect();
    const nx = px / (rect.width || 1);
    const ny = py / (rect.height || 1);
    // Scale threshold to normalized space
    const threshold = POINT_HIT_RADIUS / Math.max(rect.width, rect.height, 1);

    for (let i = this.#points.length - 1; i >= 0; i--) {
      const p = this.#points[i];
      const dx = nx - p.x;
      const dy = ny - p.y;
      if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
        return i;
      }
    }
    return -1;
  }

  #onMouseDown(e) {
    if (e.button === 2) return; // right-click handled by contextmenu
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const { x: px, y: py } = this.#canvasPos(e);
    const hitIndex = this.#findPointAt(px, py);

    if (hitIndex >= 0) {
      // Start dragging an existing point
      this.#dragIndex = hitIndex;
      this.#isDragging = false; // becomes true on first move
      this.#overlayCanvas.style.cursor = 'grabbing';
    } else {
      // Add a new point — capture the current color
      const color = this.#state.get('currentColor');
      const srgb = this.#engine.toSRGB(color.sourceValues, color.sourceSpace);
      const norm = this.#normalizePos(px, py);

      this.#points.push({
        x: norm.x,
        y: norm.y,
        color: [srgb[0], srgb[1], srgb[2]],
      });

      this.#invalidateCache();
      this.#recompute();
      this.#renderGradient();
      this.#renderOverlay();
    }

    // Attach move/up to document for dragging
    document.addEventListener('mousemove', this.#boundMouseMove);
    document.addEventListener('mouseup', this.#boundMouseUp);
  }

  #onMouseMove(e) {
    if (this.#dragIndex < 0) return;
    e.preventDefault();
    this.#isDragging = true;

    const { x: px, y: py } = this.#canvasPos(e);
    const norm = this.#normalizePos(px, py);

    this.#points[this.#dragIndex].x = norm.x;
    this.#points[this.#dragIndex].y = norm.y;

    this.#invalidateCache();
    this.#recompute();
    this.#renderGradient();
    this.#renderOverlay();
  }

  #onMouseUp(e) {
    document.removeEventListener('mousemove', this.#boundMouseMove);
    document.removeEventListener('mouseup', this.#boundMouseUp);

    if (this.#dragIndex >= 0 && !this.#isDragging) {
      // Click on existing point without dragging -- pick its color as current
      const p = this.#points[this.#dragIndex];
      const parsed = this.#engine.fromHex(
        '#' + p.color.map(c => c.toString(16).padStart(2, '0')).join('')
      );
      const xyz = this.#engine.convert(parsed.values, 'srgb', 'xyz');
      this.#state.set('currentColor', {
        xyz,
        sourceSpace: 'srgb',
        sourceValues: parsed.values,
      });
    }

    this.#dragIndex = -1;
    this.#isDragging = false;
    this.#overlayCanvas.style.cursor = 'crosshair';
  }

  #onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();

    const { x: px, y: py } = this.#canvasPos(e);
    const hitIndex = this.#findPointAt(px, py);

    if (hitIndex >= 0) {
      this.#points.splice(hitIndex, 1);
      this.#invalidateCache();
      this.#recompute();
      this.#renderGradient();
      this.#renderOverlay();
    }
  }

  // ---- Drag-and-drop (drop colors onto the canvas) -------------------------

  #onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  #onDrop(e) {
    e.preventDefault();
    const hex = e.dataTransfer.getData('text/plain');
    if (!hex || !/^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) return;

    try {
      const parsed = this.#engine.fromHex(hex.trim());
      const { x: px, y: py } = this.#canvasPos(e);
      const norm = this.#normalizePos(px, py);

      this.#points.push({
        x: norm.x,
        y: norm.y,
        color: [parsed.values[0], parsed.values[1], parsed.values[2]],
      });

      this.#invalidateCache();
      this.#recompute();
      this.#renderGradient();
      this.#renderOverlay();
    } catch {
      // Invalid hex -- ignore
    }
  }

  // ---- RBF computation and rendering ---------------------------------------

  #invalidateCache() {
    this.#cacheKey = '';
    this.#cachedImage = null;
  }

  #recompute() {
    if (this.#points.length < 1) {
      this.#weightsR = [];
      this.#weightsG = [];
      this.#weightsB = [];
      return;
    }

    const { weightsR, weightsG, weightsB } = computeWeights(this.#points);
    this.#weightsR = weightsR;
    this.#weightsG = weightsG;
    this.#weightsB = weightsB;
  }

  /**
   * Render the RBF gradient and data-point markers onto the overlay canvas.
   * The overlay is opaque and sits on top of the picker canvas, so we don't
   * need to touch the picker canvas (which may have a WebGL context).
   */
  #renderGradient() {
    if (!this.#active) return;

    const canvas = this.#overlayCanvas;
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) return;

    const ctx = canvas.getContext('2d');

    // If fewer than 2 points, show a neutral dark background
    if (this.#points.length < 2) {
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, w, h);

      // If there's exactly one point, show it as a uniform fill
      if (this.#points.length === 1) {
        const c = this.#points[0].color;
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(0, 0, w, h);
      }

      this.#renderPoints(ctx, w, h);
      return;
    }

    // Check cache — only for the gradient, not the point markers
    const key = this.#points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.color.join(',')}`).join('|') + `|${w}x${h}`;
    if (key === this.#cacheKey && this.#cachedImage) {
      ctx.putImageData(this.#cachedImage, 0, 0);
      this.#renderPoints(ctx, w, h);
      return;
    }

    // Render at a reduced resolution for performance, then scale up.
    const renderW = Math.min(w, 128);
    const renderH = Math.min(h, 128);

    const offscreen = document.createElement('canvas');
    offscreen.width = renderW;
    offscreen.height = renderH;
    const offCtx = offscreen.getContext('2d');
    const imageData = offCtx.createImageData(renderW, renderH);
    const data = imageData.data;

    for (let py = 0; py < renderH; py++) {
      const ny = py / (renderH - 1);
      for (let px = 0; px < renderW; px++) {
        const nx = px / (renderW - 1);
        const [r, g, b] = evaluateRBF(nx, ny, this.#points, this.#weightsR, this.#weightsG, this.#weightsB);
        const idx = (py * renderW + px) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    offCtx.putImageData(imageData, 0, 0);

    // Scale up to the overlay canvas size with smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, w, h);

    // Cache the gradient (before drawing point markers on top)
    this.#cachedImage = ctx.getImageData(0, 0, w, h);
    this.#cacheKey = key;

    // Draw data-point markers on top
    this.#renderPoints(ctx, w, h);
  }

  /** Draw the data-point marker circles. Called after the gradient is drawn. */
  #renderPoints(ctx, w, h) {
    for (let i = 0; i < this.#points.length; i++) {
      const p = this.#points[i];
      const px = p.x * w;
      const py = p.y * h;

      // Outer white border
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS + 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();

      // Inner color fill
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
      ctx.fill();

      // Dark outline for contrast
      ctx.beginPath();
      ctx.arc(px, py, POINT_RADIUS + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** Legacy name kept for call sites — just calls #renderGradient which handles everything. */
  #renderOverlay() {
    this.#renderGradient();
  }
}
