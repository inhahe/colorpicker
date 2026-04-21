/**
 * ui-picker.js  --  Main UI module for the color picker web app
 *
 * ES module. Provides all interactive picker/slider/swatch/gradient UI classes.
 * All color math is delegated to ColorEngine; all state flows through AppState.
 */

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';
import { PickerGLRenderer, SliderGLRenderer } from './gl-renderer.js';

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Linearly interpolate between a and b. */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Clamp v to [lo, hi]. */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Map a value from [inLo, inHi] to [outLo, outHi]. */
function mapRange(v, inLo, inHi, outLo, outHi) {
  return outLo + ((v - inLo) / (inHi - inLo)) * (outHi - outLo);
}

/** Get mouse/touch position relative to a canvas element. */
function canvasPos(canvas, evt) {
  const rect = canvas.getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
  return {
    x: clamp(clientX - rect.left, 0, rect.width),
    y: clamp(clientY - rect.top, 0, rect.height),
  };
}

/** Create a DOM element with optional className and text. */
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------------------
//  1. Picker2D — The 2D gradient picker
// ---------------------------------------------------------------------------

export class Picker2D {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {HTMLCanvasElement} for WebGL (overlay or same) */
  #glCanvas;
  /** @type {HTMLElement} */
  #crosshair;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;
  /** @type {CanvasRenderingContext2D|null} */
  #ctx = null;
  /** @type {PickerGLRenderer|null} */
  #glRenderer = null;

  // Render cache (CPU fallback only)
  #cachedImageData = null;
  #cacheKey = '';
  #rafId = 0;
  #dragging = false;

  // Unsubscribe handles
  #unsubs = [];

  constructor(canvas, crosshairEl, state, engine) {
    this.#canvas = canvas;
    this.#crosshair = crosshairEl;
    this.#state = state;
    this.#engine = engine;

    // Try WebGL first for GPU-accelerated rendering
    this.#glRenderer = new PickerGLRenderer();
    if (this.#glRenderer.init(canvas)) {
      // WebGL active — the canvas context is now WebGL, not 2D
      this.#glCanvas = canvas;
      console.log('[Picker2D] Using WebGL renderer');
    } else {
      // Fallback to CPU rendering via 2D context
      this.#glRenderer = null;
      this.#ctx = canvas.getContext('2d');
      console.log('[Picker2D] WebGL unavailable, using CPU fallback');
    }

    // Watch the panel body for size changes (not the canvas — it doesn't resize itself)
    const ro = new ResizeObserver(() => this.#syncCanvasSize());
    // Observe the picker area's parent (the panel body that the layout system controls)
    const pickerArea = document.getElementById('picker-area');
    const panelBody = pickerArea?.parentElement;
    if (panelBody) ro.observe(panelBody);
    // Defer first sync to let the layout settle
    requestAnimationFrame(() => this.#syncCanvasSize());

    // Mouse interaction
    this.#canvas.addEventListener('mousedown', (e) => this.#onPointerDown(e));
    this.#canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.#onPointerDown(e);
    }, { passive: false });

    // Subscribe to state changes
    this.#unsubs.push(
      state.subscribe('picker', () => this.#scheduleRender()),
      state.subscribe('currentColor', () => this.#onColorChange()),
    );

    this.#scheduleRender();
  }

  #syncCanvasSize() {
    const rightCol = document.getElementById('picker-right-col');
    const pickerArea = document.getElementById('picker-area');
    const container = this.#canvas.parentElement;
    if (!rightCol || !container || !pickerArea) return;

    // Use the picker-area's parent (the panel body) as the source of truth
    // for available space — it's sized by the layout, not by our content.
    const panelBody = pickerArea.parentElement;
    if (!panelBody) return;

    // Available width = panel body width minus Y slider (24px) minus gaps/padding
    const availW = panelBody.clientWidth - 24 - 16;
    // Available height = panel body height minus controls bar, X slider, gaps
    const controlsH = document.getElementById('picker-controls')?.offsetHeight || 30;
    const reservedH = controlsH + 24 + 12; // controls + X slider + gaps
    const availH = panelBody.clientHeight - reservedH;

    const size = Math.max(50, Math.min(availW, availH));

    // Size the canvas container
    container.style.width = size + 'px';
    container.style.height = size + 'px';

    // Size the Y slider to match canvas height
    const ySlider = document.getElementById('picker-y-slider');
    if (ySlider) ySlider.style.height = size + 'px';

    // Size the X slider and excluded slider to match canvas width
    const xSlider = document.getElementById('picker-x-slider');
    if (xSlider) xSlider.style.width = size + 'px';


    // Sync canvas internal resolution
    if (this.#canvas.width !== size || this.#canvas.height !== size) {
      this.#canvas.width = size;
      this.#canvas.height = size;
      this.#cacheKey = '';
      this.#scheduleRender();
    }
  }

  // -- Public ---------------------------------------------------------------

  render() {
    this.#renderInternal();
  }

  updateCrosshair() {
    this.#positionCrosshair();
  }

  // -- Private: rendering ---------------------------------------------------

  #scheduleRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#renderInternal();
    });
  }

  #renderInternal() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    if (this.#glRenderer?.isReady) {
      // GPU path: single draw call renders the entire gradient
      this.#glRenderer.render(picker, space);
    } else {
      // CPU fallback
      const w = this.#canvas.width;
      const h = this.#canvas.height;
      const cacheKey = `${picker.spaceId}|${picker.xAxis}|${picker.yAxis}|${picker.excluded}|${picker.excludedValue}|${picker.reversed.x}|${picker.reversed.y}|${w}|${h}`;
      if (cacheKey !== this.#cacheKey) {
        this.#cacheKey = cacheKey;
        this.#cachedImageData = this.#buildGradientCPU(picker, space, w, h);
      }
      this.#ctx.putImageData(this.#cachedImageData, 0, 0);
    }

    this.#positionCrosshair();
  }

  /** CPU fallback: per-pixel color conversion (slow but always works) */
  #buildGradientCPU(picker, space, w, h) {
    const imageData = this.#ctx.createImageData(w, h);
    const data = imageData.data;
    const { xAxis, yAxis, excluded, excludedValue, reversed } = picker;

    const xRange = space.components[xAxis].range;
    const yRange = space.components[yAxis].range;

    for (let py = 0; py < h; py++) {
      const tY = py / (h - 1);
      const yVal = reversed.y
        ? lerp(yRange[0], yRange[1], tY)
        : lerp(yRange[1], yRange[0], tY);

      for (let px = 0; px < w; px++) {
        const tX = px / (w - 1);
        const xVal = reversed.x
          ? lerp(xRange[1], xRange[0], tX)
          : lerp(xRange[0], xRange[1], tX);

        const values = [0, 0, 0];
        values[xAxis] = xVal;
        values[yAxis] = yVal;
        values[excluded] = excludedValue;

        // toSRGB already does gamma-then-clamp (smooth gamut boundary)
        const [r, g, b] = this.#engine.toSRGB(values, picker.spaceId);
        const idx = (py * w + px) * 4;
        data[idx] = r; data[idx+1] = g; data[idx+2] = b; data[idx+3] = 255;
      }
    }
    return imageData;
  }

  // -- Private: crosshair ---------------------------------------------------

  #positionCrosshair() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    const color = this.#state.get('currentColor');
    const values = this.#engine.convert(color.xyz, 'xyz', picker.spaceId);

    const xComp = space.components[picker.xAxis];
    const yComp = space.components[picker.yAxis];

    // Use CSS dimensions for positioning (crosshair is in CSS space)
    const cw = this.#canvas.clientWidth || this.#canvas.width;
    const ch = this.#canvas.clientHeight || this.#canvas.height;

    // Map component value to normalized 0-1 position
    let tX = (values[picker.xAxis] - xComp.range[0]) / (xComp.range[1] - xComp.range[0]);
    if (picker.reversed.x) tX = 1 - tX;

    let tY = (values[picker.yAxis] - yComp.range[0]) / (yComp.range[1] - yComp.range[0]);
    // Default: top = max, bottom = min
    if (!picker.reversed.y) tY = 1 - tY;

    const px = clamp(tX * cw, 0, cw);
    const py = clamp(tY * ch, 0, ch);

    this.#crosshair.style.left = `${px}px`;
    this.#crosshair.style.top = `${py}px`;
  }

  // -- Private: mouse interaction -------------------------------------------

  #onPointerDown(evt) {
    this.#dragging = true;
    this.#pickFromPointer(evt);

    const onMove = (e) => {
      if (!this.#dragging) return;
      e.preventDefault();
      this.#pickFromPointer(e);
    };
    const onUp = () => {
      this.#dragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  #pickFromPointer(evt) {
    const { x, y } = canvasPos(this.#canvas, evt);
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    // Use CSS dimensions since canvasPos returns CSS-space coordinates
    const rect = this.#canvas.getBoundingClientRect();
    const w = rect.width || this.#canvas.width;
    const h = rect.height || this.#canvas.height;

    const tX = x / w;
    const tY = y / h;

    const xComp = space.components[picker.xAxis];
    const yComp = space.components[picker.yAxis];

    const xVal = picker.reversed.x
      ? lerp(xComp.range[1], xComp.range[0], tX)
      : lerp(xComp.range[0], xComp.range[1], tX);

    const yVal = picker.reversed.y
      ? lerp(yComp.range[0], yComp.range[1], tY)
      : lerp(yComp.range[1], yComp.range[0], tY);

    const values = [0, 0, 0];
    values[picker.xAxis] = xVal;
    values[picker.yAxis] = yVal;
    values[picker.excluded] = picker.excludedValue;

    const xyz = this.#engine.convert(values, picker.spaceId, 'xyz');

    this.#state.set('currentColor', {
      xyz,
      sourceSpace: picker.spaceId,
      sourceValues: values,
    });
  }

  #onColorChange() {
    // When the color changes from an external source (hex input, eyedropper,
    // collection click, etc.), sync the excluded value so the 2D picker
    // shows a slice that contains the current color.
    // When the change came from the 2D picker itself or from ColorSliders
    // (which handles picker reconfiguration), the excluded value already
    // matches, so the tolerance check avoids a feedback loop.
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (space) {
      const color = this.#state.get('currentColor');
      const values = color.sourceSpace === picker.spaceId
        ? color.sourceValues
        : this.#engine.convert(color.xyz, 'xyz', picker.spaceId);
      const newExcluded = values[picker.excluded];
      if (Math.abs(newExcluded - picker.excludedValue) > 0.01) {
        this.#state.set('picker.excludedValue', newExcluded);
        return; // picker subscription will re-render and reposition crosshair
      }
    }
    this.#positionCrosshair();
  }
}

// ---------------------------------------------------------------------------
//  2. AxisSliders — X and Y axis gradient sliders along the picker edges
// ---------------------------------------------------------------------------

export class AxisSliders {
  #xCanvas;
  #yCanvas;
  #state;
  #engine;
  #xCtx;
  #yCtx;
  #rafId = 0;
  #unsubs = [];

  constructor(xSliderCanvas, ySliderCanvas, state, engine) {
    this.#xCanvas = xSliderCanvas;
    this.#yCanvas = ySliderCanvas;
    this.#state = state;
    this.#engine = engine;
    this.#xCtx = xSliderCanvas.getContext('2d');
    this.#yCtx = ySliderCanvas.getContext('2d');

    // Sync canvas resolution with CSS display size
    const ro = new ResizeObserver(() => this.#syncSizes());
    ro.observe(this.#xCanvas);
    ro.observe(this.#yCanvas);
    this.#syncSizes();

    this.#unsubs.push(
      state.subscribe('picker', () => this.#scheduleRender()),
      state.subscribe('currentColor', () => this.#scheduleRender()),
    );

    this.#scheduleRender();
  }

  #syncSizes() {
    let dirty = false;
    const xw = this.#xCanvas.clientWidth || 400;
    const xh = this.#xCanvas.clientHeight || 24;
    if (this.#xCanvas.width !== xw || this.#xCanvas.height !== xh) {
      this.#xCanvas.width = xw;
      this.#xCanvas.height = xh;
      dirty = true;
    }
    const yw = this.#yCanvas.clientWidth || 24;
    const yh = this.#yCanvas.clientHeight || 300;
    if (this.#yCanvas.width !== yw || this.#yCanvas.height !== yh) {
      this.#yCanvas.width = yw;
      this.#yCanvas.height = yh;
      dirty = true;
    }
    if (dirty) this.#scheduleRender();
  }

  render() {
    this.#renderInternal();
  }

  #scheduleRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#renderInternal();
    });
  }

  #renderInternal() {
    this.#renderXSlider();
    this.#renderYSlider();
  }

  #renderXSlider() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    const color = this.#state.get('currentColor');
    const currentValues = this.#engine.convert(color.xyz, 'xyz', picker.spaceId);

    const w = this.#xCanvas.width;
    const h = this.#xCanvas.height;
    const imageData = this.#xCtx.createImageData(w, h);
    const data = imageData.data;

    const xComp = space.components[picker.xAxis];

    for (let px = 0; px < w; px++) {
      const tX = px / (w - 1);
      const xVal = picker.reversed.x
        ? lerp(xComp.range[1], xComp.range[0], tX)
        : lerp(xComp.range[0], xComp.range[1], tX);

      const values = [...currentValues];
      values[picker.xAxis] = xVal;

      const [r, g, b] = this.#engine.toSRGB(values, picker.spaceId);
      const gamut = this.#engine.classifyColor(values, picker.spaceId);
      let cr = r, cg = g, cb = b;
      if (gamut.imaginary) { cr = Math.round(r*0.3)+40; cg = Math.round(g*0.3); cb = Math.round(b*0.3); }
      else if (!gamut.displayable) { cr = Math.round(r*0.85); cg = Math.round(g*0.85); cb = Math.round(b*0.85); }
      // Write the same color to every row in this column
      for (let py = 0; py < h; py++) {
        const idx = (py * w + px) * 4;
        data[idx] = cr; data[idx+1] = cg; data[idx+2] = cb; data[idx+3] = 255;
      }
    }
    this.#xCtx.putImageData(imageData, 0, 0);
  }

  #renderYSlider() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    const color = this.#state.get('currentColor');
    const currentValues = this.#engine.convert(color.xyz, 'xyz', picker.spaceId);

    const w = this.#yCanvas.width;
    const h = this.#yCanvas.height;
    const imageData = this.#yCtx.createImageData(w, h);
    const data = imageData.data;

    const yComp = space.components[picker.yAxis];

    for (let py = 0; py < h; py++) {
      const tY = py / (h - 1);
      const yVal = picker.reversed.y
        ? lerp(yComp.range[0], yComp.range[1], tY)
        : lerp(yComp.range[1], yComp.range[0], tY);

      const values = [...currentValues];
      values[picker.yAxis] = yVal;

      const [r, g, b] = this.#engine.toSRGB(values, picker.spaceId);
      const gamut = this.#engine.classifyColor(values, picker.spaceId);
      let cr = r, cg = g, cb = b;
      if (gamut.imaginary) { cr = Math.round(r*0.3)+40; cg = Math.round(g*0.3); cb = Math.round(b*0.3); }
      else if (!gamut.displayable) { cr = Math.round(r*0.85); cg = Math.round(g*0.85); cb = Math.round(b*0.85); }
      // Write the same color to every column in this row
      const rowStart = py * w * 4;
      for (let px = 0; px < w; px++) {
        const idx = rowStart + px * 4;
        data[idx] = cr; data[idx+1] = cg; data[idx+2] = cb; data[idx+3] = 255;
      }
    }
    this.#yCtx.putImageData(imageData, 0, 0);
  }
}

// ---------------------------------------------------------------------------
//  3. ColorSliders — Per-component sliders for active color spaces
// ---------------------------------------------------------------------------

export class ColorSliders {
  #container;
  #state;
  #engine;
  #onColorChange;
  #groups = new Map(); // spaceId -> { el, canvases[], inputs[], unsubs[] }
  #unsubs = [];
  #rafId = 0;
  #suppressUpdate = false;
  /** @type {SliderGLRenderer|null} */
  #sliderGL = null;

  constructor(containerEl, state, engine, onColorChange) {
    this.#container = containerEl;
    this.#state = state;
    this.#engine = engine;
    this.#onColorChange = onColorChange || (() => {});

    // Try GPU-accelerated slider rendering
    try {
      this.#sliderGL = new SliderGLRenderer();
      if (!this.#sliderGL.init()) this.#sliderGL = null;
    } catch { this.#sliderGL = null; }

    this.#unsubs.push(
      state.subscribe('currentColor', () => {
        if (!this.#suppressUpdate) this.#updateFromColor();
      }),
      state.subscribe('activeSpaces', () => this.render()),
    );

    this.render();
  }

  render() {
    const activeSpaces = this.#state.get('activeSpaces') || [];

    // Remove groups that are no longer active
    for (const [sid] of this.#groups) {
      if (!activeSpaces.includes(sid)) {
        this.#removeGroupDOM(sid);
      }
    }

    // Add/reorder groups
    for (const sid of activeSpaces) {
      if (!this.#groups.has(sid)) {
        this.#createGroup(sid);
      }
    }

    // Reorder DOM to match activeSpaces order
    for (const sid of activeSpaces) {
      const group = this.#groups.get(sid);
      if (group) this.#container.appendChild(group.el);
    }

    this.#updateFromColor();
    this.#scheduleGradientRender();
  }

  addSpace(spaceId) {
    const activeSpaces = this.#state.get('activeSpaces') || [];
    if (activeSpaces.includes(spaceId)) return;
    this.#state.set('activeSpaces', [...activeSpaces, spaceId]);
  }

  removeSpace(spaceId) {
    const activeSpaces = this.#state.get('activeSpaces') || [];
    this.#state.set('activeSpaces', activeSpaces.filter(s => s !== spaceId));
  }

  // -- Private: group creation ----------------------------------------------

  #createGroup(spaceId) {
    const space = this.#engine.spaces.get(spaceId);
    if (!space) return;

    const groupEl = el('div', 'slider-group');
    groupEl.dataset.spaceId = spaceId;

    // Header
    const header = el('div', 'slider-group-header');
    const title = el('span', 'slider-group-title', space.name);
    const removeBtn = el('button', 'remove-btn', '\u00D7');
    removeBtn.title = `Remove ${space.name}`;
    removeBtn.addEventListener('click', () => this.removeSpace(spaceId));
    header.appendChild(title);
    header.appendChild(removeBtn);
    groupEl.appendChild(header);

    const canvases = [];
    const inputs = [];

    for (let ci = 0; ci < space.components.length; ci++) {
      const comp = space.components[ci];
      const row = el('div', 'slider-row');

      // Label
      const label = el('span', 'slider-label', comp.name);
      row.appendChild(label);

      // Gradient canvas
      const cvs = document.createElement('canvas');
      cvs.className = 'slider-canvas';
      cvs.width = 200;
      cvs.height = 20;

      const thumbOverlay = el('div', 'slider-thumb-overlay');
      const thumb = el('div', 'slider-thumb');
      thumbOverlay.appendChild(thumb);

      const canvasWrap = el('div', 'slider-canvas-wrap');
      canvasWrap.appendChild(cvs);
      canvasWrap.appendChild(thumbOverlay);

      // Drag interaction on canvas
      this.#attachSliderDrag(canvasWrap, cvs, spaceId, ci, comp);

      row.appendChild(canvasWrap);

      // Number input
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'num-input slider-num-input';
      input.min = comp.range[0];
      input.max = comp.range[1];
      input.step = comp.step;
      input.addEventListener('change', () => {
        this.#onInputChange(spaceId, ci, parseFloat(input.value));
      });
      row.appendChild(input);

      groupEl.appendChild(row);

      // Quick value buttons — on a separate row to avoid squeezing the canvas
      const quickVals = this.#getQuickValues(comp);
      if (quickVals.length > 0) {
        const quickDiv = el('div', 'slider-quick-btns');
        for (const qv of quickVals) {
          const qBtn = el('button', 'slider-quick-btn', String(qv));
          qBtn.addEventListener('click', () => {
            this.#onInputChange(spaceId, ci, qv);
          });
          quickDiv.appendChild(qBtn);
        }
        groupEl.appendChild(quickDiv);
      }
      canvases.push({ canvas: cvs, thumb, ctx: cvs.getContext('2d') });
      inputs.push(input);
    }

    this.#container.appendChild(groupEl);
    this.#groups.set(spaceId, { el: groupEl, canvases, inputs });
  }

  #removeGroupDOM(spaceId) {
    const group = this.#groups.get(spaceId);
    if (!group) return;
    group.el.remove();
    this.#groups.delete(spaceId);
  }

  #getQuickValues(comp) {
    const [min, max] = comp.range;
    const name = comp.name.toLowerCase();

    if (name.includes('hue') || comp.id === 'h') {
      return [0, 60, 120, 180, 240, 300];
    }
    if (max === 255 && min === 0) {
      return [0, 128, 255];
    }
    if (max === 100 && min === 0) {
      return [0, 50, 100];
    }
    if (max === 360 && min === 0) {
      return [0, 90, 180, 270];
    }
    // Generic: min, mid, max
    const mid = (min + max) / 2;
    return [min, parseFloat(mid.toFixed(3)), max];
  }

  // -- Private: slider drag -------------------------------------------------

  #attachSliderDrag(wrap, canvas, spaceId, componentIndex, comp) {
    const startDrag = (evt) => {
      evt.preventDefault();
      const pick = (e) => {
        const { x } = canvasPos(canvas, e);
        const rect = canvas.getBoundingClientRect();
        const t = x / (rect.width || canvas.width);
        const val = lerp(comp.range[0], comp.range[1], t);
        this.#onInputChange(spaceId, componentIndex, val);
      };
      pick(evt);

      const onMove = (e) => { e.preventDefault(); pick(e); };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };

    wrap.addEventListener('mousedown', startDrag);
    wrap.addEventListener('touchstart', (e) => { e.preventDefault(); startDrag(e); }, { passive: false });
  }

  // -- Private: value change handler ----------------------------------------

  #onInputChange(spaceId, componentIndex, rawValue) {
    const space = this.#engine.spaces.get(spaceId);
    if (!space) return;

    const comp = space.components[componentIndex];
    const value = clamp(rawValue, comp.range[0], comp.range[1]);

    // Get current color in this space
    const color = this.#state.get('currentColor');
    let values;
    if (color.sourceSpace === spaceId) {
      values = [...color.sourceValues];
    } else {
      values = this.#engine.convert(color.xyz, 'xyz', spaceId);
    }
    values[componentIndex] = value;

    const xyz = this.#engine.convert(values, spaceId, 'xyz');

    // Reconfigure the 2D picker: the dragged component becomes the
    // excluded (depth) dimension, the other two become X and Y axes.
    const picker = this.#state.get('picker');
    const needsReconfig = picker.spaceId !== spaceId || picker.excluded !== componentIndex;
    const otherAxes = [0, 1, 2].filter(i => i !== componentIndex);

    this.#suppressUpdate = true;
    this.#state.batch({
      'currentColor.xyz': xyz,
      'currentColor.sourceSpace': spaceId,
      'currentColor.sourceValues': values,
      'picker.excludedValue': value,
      ...(needsReconfig ? {
        'picker.spaceId': spaceId,
        'picker.excluded': componentIndex,
        'picker.xAxis': otherAxes[0],
        'picker.yAxis': otherAxes[1],
        'picker.reversed': { x: false, y: false },
      } : {}),
    });
    this.#suppressUpdate = false;

    // Update UI immediately for the changed group
    this.#updateInputsForSpace(spaceId, values);
    this.#scheduleGradientRender();
  }

  // -- Private: update from external color change ---------------------------

  #updateFromColor() {
    const color = this.#state.get('currentColor');

    for (const [spaceId, group] of this.#groups) {
      let values;
      if (color.sourceSpace === spaceId) {
        values = [...color.sourceValues];
      } else {
        values = this.#engine.convert(color.xyz, 'xyz', spaceId);
      }
      this.#updateInputsForSpace(spaceId, values);
    }

    this.#scheduleGradientRender();
  }

  #updateInputsForSpace(spaceId, values) {
    const group = this.#groups.get(spaceId);
    if (!group) return;
    const space = this.#engine.spaces.get(spaceId);
    if (!space) return;

    for (let ci = 0; ci < space.components.length; ci++) {
      const comp = space.components[ci];
      const val = values[ci];

      // Update number input
      const step = comp.step;
      const decimals = step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0;
      group.inputs[ci].value = val.toFixed(decimals);

      // Update thumb position (use CSS width for positioning)
      const t = (val - comp.range[0]) / (comp.range[1] - comp.range[0]);
      const cssW = group.canvases[ci].canvas.clientWidth || group.canvases[ci].canvas.width;
      const px = clamp(t * cssW, 0, cssW);
      group.canvases[ci].thumb.style.left = `${px}px`;
    }
  }

  // -- Private: gradient rendering ------------------------------------------

  #scheduleGradientRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#renderAllGradients();
    });
  }

  #renderAllGradients() {
    const color = this.#state.get('currentColor');

    for (const [spaceId, group] of this.#groups) {
      try {
        const space = this.#engine.spaces.get(spaceId);
        if (!space) continue;

        let values;
        if (color.sourceSpace === spaceId) {
          values = [...color.sourceValues];
        } else {
          values = this.#engine.convert(color.xyz, 'xyz', spaceId);
        }

        for (let ci = 0; ci < space.components.length; ci++) {
          this.#renderSliderGradient(group.canvases[ci], space, ci, values);
        }
      } catch (err) {
        // One space failing shouldn't prevent others from rendering
        console.warn(`[Sliders] Failed to render ${spaceId}:`, err);
      }
    }
  }

  #renderSliderGradient(canvasInfo, space, componentIndex, currentValues) {
    const { canvas, ctx } = canvasInfo;
    // Sync canvas internal resolution with its CSS display size
    const cw = canvas.clientWidth || 200;
    const ch = canvas.clientHeight || 20;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const comp = space.components[componentIndex];
    const [min, max] = comp.range;

    // Try GPU path first — fall through to CPU if it fails (e.g., context lost)
    if (this.#sliderGL?.isReady) {
      try {
        const ok = this.#sliderGL.renderSliderWithRange(
          ctx, space.id, componentIndex, currentValues,
          min, max, canvas.width, canvas.height
        );
        if (ok) return;
      } catch {
        // GPU failed — fall through to CPU
      }
    }

    // CPU fallback
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) { console.warn(`[SLIDER] SKIP: zero canvas`); return; }
    const row = new Uint8ClampedArray(w * 4);

    for (let px = 0; px < w; px++) {
      const t = w > 1 ? px / (w - 1) : 0;
      const val = lerp(min, max, t);
      const values = [...currentValues];
      values[componentIndex] = val;

      let r = 0, g = 0, b = 0;
      try {
        [r, g, b] = this.#engine.toSRGB(values, space.id);
      } catch (e) {
        r = 255; g = 0; b = 255;
      }
      if (isNaN(r) || isNaN(g) || isNaN(b)) { r = 255; g = 0; b = 255; }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(px, 0, 1, h);
    }
  }
}

// ---------------------------------------------------------------------------
//  4. ColorSwatch — Current color display
// ---------------------------------------------------------------------------

export class ColorSwatch {
  #actualEl;
  #intendedEl;
  #state;
  #engine;
  #unsubs = [];

  constructor(actualEl, intendedEl, state, engine) {
    this.#actualEl = actualEl;
    this.#intendedEl = intendedEl;
    this.#state = state;
    this.#engine = engine;

    this.#unsubs.push(
      state.subscribe('currentColor', () => this.render()),
    );

    this.render();
  }

  render() {
    const color = this.#state.get('currentColor');
    const srgb = this.#engine.toSRGB(color.xyz, 'xyz');
    const hex = this.#engine.toHex(color.xyz, 'xyz');

    // The sRGB-clamped version (what the monitor actually displays)
    this.#actualEl.style.backgroundColor = hex;

    // Check if the color is exactly displayable
    const gamut = this.#engine.classifyColor(color.xyz, 'xyz');

    if (gamut.displayable) {
      // Both halves show the same color
      this.#intendedEl.style.backgroundColor = hex;
      this.#intendedEl.title = 'Color is exactly displayable';
      this.#intendedEl.classList.remove('out-of-gamut');
    } else {
      // Intended half shows the clamped approximation with a visual hint
      this.#intendedEl.style.backgroundColor = hex;
      this.#intendedEl.title = 'Color is outside sRGB gamut — shown as nearest displayable';
      this.#intendedEl.classList.add('out-of-gamut');
    }
  }
}

// ---------------------------------------------------------------------------
//  5. HexDisplay — Hex value input and copy/paste
// ---------------------------------------------------------------------------

export class HexDisplay {
  #hexInput;
  #copyBtn;
  #pasteBtn;
  #state;
  #engine;
  #unsubs = [];
  #suppressUpdate = false;

  constructor(hexInput, copyBtn, pasteBtn, state, engine) {
    this.#hexInput = hexInput;
    this.#copyBtn = copyBtn;
    this.#pasteBtn = pasteBtn;
    this.#state = state;
    this.#engine = engine;

    // Hex input change
    this.#hexInput.addEventListener('change', () => this.#onHexInput());
    this.#hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.#onHexInput();
    });

    // Copy button
    this.#copyBtn.addEventListener('click', () => this.#copyHex());

    // Paste button
    this.#pasteBtn.addEventListener('click', () => this.#pasteHex());

    // Subscribe to state
    this.#unsubs.push(
      state.subscribe('currentColor', () => {
        if (!this.#suppressUpdate) this.#updateDisplay();
      }),
    );

    this.#updateDisplay();
  }

  #updateDisplay() {
    const color = this.#state.get('currentColor');
    const hex = this.#engine.toHex(color.xyz, 'xyz');
    this.#hexInput.value = hex.toUpperCase();
  }

  #onHexInput() {
    const raw = this.#hexInput.value.trim();
    if (!this.#isValidHex(raw)) {
      // Revert to current color
      this.#updateDisplay();
      return;
    }

    try {
      const parsed = this.#engine.fromHex(raw);
      const xyz = this.#engine.convert(parsed.values, 'srgb', 'xyz');

      this.#suppressUpdate = true;
      this.#state.set('currentColor', {
        xyz,
        sourceSpace: 'srgb',
        sourceValues: parsed.values,
      });
      this.#suppressUpdate = false;

      // Update display to canonical form
      this.#updateDisplay();
    } catch {
      this.#updateDisplay();
    }
  }

  #isValidHex(str) {
    const h = str.replace(/^#/, '');
    return /^[0-9A-Fa-f]{3}$/.test(h) || /^[0-9A-Fa-f]{6}$/.test(h);
  }

  async #copyHex() {
    const color = this.#state.get('currentColor');
    const hex = this.#engine.toHex(color.xyz, 'xyz').toUpperCase();
    try {
      await navigator.clipboard.writeText(hex);
    } catch {
      // Fallback: select the input text
      this.#hexInput.select();
      document.execCommand('copy');
    }
  }

  async #pasteHex() {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (this.#isValidHex(trimmed)) {
        this.#hexInput.value = trimmed;
        this.#onHexInput();
      }
    } catch {
      // Clipboard access denied — ignore
    }
  }
}

// ---------------------------------------------------------------------------
//  6. ExcludedSlider — Slider for the excluded/fixed dimension
// ---------------------------------------------------------------------------

export class ExcludedSlider {
  #canvas;
  #labelEl;
  #valueInput;
  #state;
  #engine;
  #ctx;
  #rafId = 0;
  #unsubs = [];

  constructor(canvas, labelEl, valueInput, state, engine) {
    this.#canvas = canvas;
    this.#labelEl = labelEl;
    this.#valueInput = valueInput;
    this.#state = state;
    this.#engine = engine;
    this.#ctx = canvas.getContext('2d');

    // Sync canvas internal resolution with CSS
    const ro = new ResizeObserver(() => this.#syncSize());
    ro.observe(this.#canvas);
    this.#syncSize();

    // Drag interaction on canvas
    this.#attachDrag();

    // Number input
    this.#valueInput.addEventListener('change', () => {
      const picker = this.#state.get('picker');
      const space = this.#engine.spaces.get(picker.spaceId);
      if (!space) return;
      const comp = space.components[picker.excluded];
      const val = clamp(parseFloat(this.#valueInput.value) || 0, comp.range[0], comp.range[1]);
      this.#state.set('picker.excludedValue', val);
    });

    this.#unsubs.push(
      state.subscribe('picker', () => this.#scheduleRender()),
      state.subscribe('currentColor', () => this.#scheduleRender()),
    );

    this.#scheduleRender();
  }

  #syncSize() {
    const w = this.#canvas.clientWidth || 400;
    const h = this.#canvas.clientHeight || 24;
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
      this.#scheduleRender();
    }
  }

  render() {
    this.#renderInternal();
  }

  #scheduleRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#renderInternal();
    });
  }

  #renderInternal() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    const comp = space.components[picker.excluded];

    // Update label and input
    this.#labelEl.textContent = comp.name;
    this.#valueInput.min = comp.range[0];
    this.#valueInput.max = comp.range[1];
    this.#valueInput.step = comp.step;

    const step = comp.step;
    const decimals = step < 1 ? Math.max(1, -Math.floor(Math.log10(step))) : 0;
    this.#valueInput.value = picker.excludedValue.toFixed(decimals);

    // Render gradient
    const color = this.#state.get('currentColor');
    const currentValues = this.#engine.convert(color.xyz, 'xyz', picker.spaceId);

    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const imageData = this.#ctx.createImageData(w, h);
    const data = imageData.data;

    const [min, max] = comp.range;

    for (let px = 0; px < w; px++) {
      const t = px / (w - 1);
      const val = lerp(min, max, t);

      const values = [...currentValues];
      values[picker.excluded] = val;

      const [r, g, b] = this.#engine.toSRGB(values, picker.spaceId);
      const gamut = this.#engine.classifyColor(values, picker.spaceId);

      for (let py = 0; py < h; py++) {
        const idx = (py * w + px) * 4;
        if (gamut.imaginary) {
          data[idx]     = Math.min(255, Math.round(r * 0.4) + 80);
          data[idx + 1] = Math.round(g * 0.3);
          data[idx + 2] = Math.round(b * 0.3);
        } else if (!gamut.displayable) {
          data[idx]     = Math.round(r * 0.85);
          data[idx + 1] = Math.round(g * 0.85);
          data[idx + 2] = Math.round(b * 0.85);
        } else {
          data[idx]     = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
        }
        data[idx + 3] = 255;
      }
    }

    this.#ctx.putImageData(imageData, 0, 0);

    // Draw a position marker for the current excluded value
    const t = (picker.excludedValue - min) / (max - min);
    const markerX = Math.round(clamp(t, 0, 1) * (w - 1));
    this.#ctx.strokeStyle = 'white';
    this.#ctx.lineWidth = 2;
    this.#ctx.beginPath();
    this.#ctx.moveTo(markerX, 0);
    this.#ctx.lineTo(markerX, h);
    this.#ctx.stroke();
    this.#ctx.strokeStyle = 'black';
    this.#ctx.lineWidth = 1;
    this.#ctx.beginPath();
    this.#ctx.moveTo(markerX - 1, 0);
    this.#ctx.lineTo(markerX - 1, h);
    this.#ctx.moveTo(markerX + 1, 0);
    this.#ctx.lineTo(markerX + 1, h);
    this.#ctx.stroke();
  }

  #attachDrag() {
    const startDrag = (evt) => {
      evt.preventDefault();
      const pick = (e) => {
        const { x } = canvasPos(this.#canvas, e);
        const picker = this.#state.get('picker');
        const space = this.#engine.spaces.get(picker.spaceId);
        if (!space) return;
        const comp = space.components[picker.excluded];
        const rect = this.#canvas.getBoundingClientRect();
        const t = x / (rect.width || this.#canvas.width);
        const val = lerp(comp.range[0], comp.range[1], t);
        this.#state.set('picker.excludedValue', clamp(val, comp.range[0], comp.range[1]));
      };
      pick(evt);

      const onMove = (e) => { e.preventDefault(); pick(e); };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };

    this.#canvas.addEventListener('mousedown', startDrag);
    this.#canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDrag(e); }, { passive: false });
  }
}

// ---------------------------------------------------------------------------
//  7. PickerControls — Axis control buttons and dropdowns
// ---------------------------------------------------------------------------

export class PickerControls {
  #elements;
  #state;
  #engine;
  #unsubs = [];

  constructor(elements, state, engine) {
    this.#elements = elements;
    this.#state = state;
    this.#engine = engine;

    const {
      spaceSelect,
      xSelect,
      ySelect,
      excludedSelect,
      swapBtn,
      reverseXBtn,
      reverseYBtn,
      rotateBtn,
    } = elements;

    // Populate space select
    this.#populateSpaceSelect();

    // Space change
    spaceSelect.addEventListener('change', () => {
      const spaceId = spaceSelect.value;
      const space = this.#engine.spaces.get(spaceId);
      if (!space) return;

      this.#state.set('picker', {
        spaceId,
        xAxis: 1,
        yAxis: 2,
        excluded: 0,
        excludedValue: space.components[0].defaultValue,
        reversed: { x: false, y: false },
      });
    });

    // X/Y/Excluded axis selects
    xSelect.addEventListener('change', () => {
      this.#updateAxes('x', parseInt(xSelect.value, 10));
    });
    ySelect.addEventListener('change', () => {
      this.#updateAxes('y', parseInt(ySelect.value, 10));
    });
    excludedSelect.addEventListener('change', () => {
      this.#updateAxes('excluded', parseInt(excludedSelect.value, 10));
    });

    // Swap button
    swapBtn.addEventListener('click', () => {
      const picker = this.#state.get('picker');
      this.#state.batch({
        'picker.xAxis': picker.yAxis,
        'picker.yAxis': picker.xAxis,
      });
    });

    // Reverse X
    reverseXBtn.addEventListener('click', () => {
      const picker = this.#state.get('picker');
      this.#state.set('picker.reversed', {
        x: !picker.reversed.x,
        y: picker.reversed.y,
      });
    });

    // Reverse Y
    reverseYBtn.addEventListener('click', () => {
      const picker = this.#state.get('picker');
      this.#state.set('picker.reversed', {
        x: picker.reversed.x,
        y: !picker.reversed.y,
      });
    });

    // Rotate
    rotateBtn.addEventListener('click', () => {
      const picker = this.#state.get('picker');
      // Cycle: (x,y,excluded) -> (y,excluded,x) -> (excluded,x,y)
      const newX = picker.yAxis;
      const newY = picker.excluded;
      const newExcluded = picker.xAxis;

      const space = this.#engine.spaces.get(picker.spaceId);
      const newExcludedVal = space
        ? space.components[newExcluded].defaultValue
        : 0;

      this.#state.set('picker', {
        ...picker,
        xAxis: newX,
        yAxis: newY,
        excluded: newExcluded,
        excludedValue: newExcludedVal,
      });
    });

    // Subscribe for updates
    this.#unsubs.push(
      state.subscribe('picker', () => this.#updateSelects()),
    );

    this.#updateSelects();
  }

  #populateSpaceSelect() {
    const select = this.#elements.spaceSelect;
    select.innerHTML = '';
    for (const [id, space] of this.#engine.spaces) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = space.name;
      select.appendChild(opt);
    }
  }

  #updateSelects() {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    this.#elements.spaceSelect.value = picker.spaceId;

    // Populate axis selects with component names
    for (const [selectEl, currentVal] of [
      [this.#elements.xSelect, picker.xAxis],
      [this.#elements.ySelect, picker.yAxis],
      [this.#elements.excludedSelect, picker.excluded],
    ]) {
      selectEl.innerHTML = '';
      for (let i = 0; i < space.components.length; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = space.components[i].name;
        selectEl.appendChild(opt);
      }
      selectEl.value = currentVal;
    }
  }

  #updateAxes(changedAxis, newIndex) {
    const picker = this.#state.get('picker');
    let { xAxis, yAxis, excluded, excludedValue } = picker;
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return;

    const indices = [xAxis, yAxis, excluded];
    const roles = { x: 0, y: 1, excluded: 2 };
    const changedRole = roles[changedAxis];

    // If the new index is already used by another role, swap them
    const oldIndex = indices[changedRole];
    for (let r = 0; r < 3; r++) {
      if (r !== changedRole && indices[r] === newIndex) {
        indices[r] = oldIndex;
        break;
      }
    }
    indices[changedRole] = newIndex;

    const newPicker = {
      ...picker,
      xAxis: indices[0],
      yAxis: indices[1],
      excluded: indices[2],
    };

    // If the excluded axis changed, reset its value to the component's default
    if (newPicker.excluded !== excluded) {
      newPicker.excludedValue = space.components[newPicker.excluded].defaultValue;
    }

    this.#state.set('picker', newPicker);
  }
}

// ---------------------------------------------------------------------------
//  8. Eyedropper — Desktop color sampler
// ---------------------------------------------------------------------------

export class Eyedropper {
  #button;
  #state;
  #engine;

  constructor(buttonEl, state, engine) {
    this.#button = buttonEl;
    this.#state = state;
    this.#engine = engine;

    if (!('EyeDropper' in window)) {
      this.#button.disabled = true;
      this.#button.title = 'Not supported in this browser';
      return;
    }

    this.#button.addEventListener('click', () => this.pick());
  }

  async pick() {
    if (!('EyeDropper' in window)) return;

    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();

      // result.sRGBHex is like "#rrggbb"
      const parsed = this.#engine.fromHex(result.sRGBHex);
      const xyz = this.#engine.convert(parsed.values, 'srgb', 'xyz');

      this.#state.set('currentColor', {
        xyz,
        sourceSpace: 'srgb',
        sourceValues: parsed.values,
      });
    } catch {
      // User cancelled or API error — ignore
    }
  }
}

// ---------------------------------------------------------------------------
//  9. GradientUI — Two-color gradient and three-color triangle
// ---------------------------------------------------------------------------

export class GradientUI {
  #elements;
  #state;
  #engine;
  #unsubs = [];
  #rafId = 0;

  // Cached colors for gradient endpoints
  #color1 = null; // {xyz, sourceSpace, sourceValues}
  #color2 = null;
  #triColors = [null, null, null];

  constructor(elements, state, engine) {
    this.#elements = elements;
    this.#state = state;
    this.#engine = engine;

    const {
      color1Swatch,
      color2Swatch,
      gradientBar,
      triCanvas,
      triSwatches, // [swatch1, swatch2, swatch3]
    } = elements;

    // Two-color gradient: click swatches to set from current color
    color1Swatch.addEventListener('click', () => {
      const color = this.#state.get('currentColor');
      this.#color1 = { ...color };
      this.#state.set('gradient.color1', color);
      this.#scheduleRender();
    });

    color2Swatch.addEventListener('click', () => {
      const color = this.#state.get('currentColor');
      this.#color2 = { ...color };
      this.#state.set('gradient.color2', color);
      this.#scheduleRender();
    });

    // Click on gradient bar to pick an intermediate color
    gradientBar.addEventListener('click', (evt) => {
      if (!this.#color1 || !this.#color2) return;
      const { x } = canvasPos(gradientBar, evt);
      const t = x / gradientBar.width;
      this.#pickGradientColor(t);
    });

    // Three-color triangle: click swatches
    for (let i = 0; i < 3; i++) {
      triSwatches[i].addEventListener('click', () => {
        const color = this.#state.get('currentColor');
        this.#triColors[i] = { ...color };
        const triState = this.#state.get('triangleGradient');
        const newColors = [...(triState.colors || [null, null, null])];
        newColors[i] = color;
        this.#state.set('triangleGradient.colors', newColors);
        this.#scheduleRender();
      });
    }

    // Click on triangle canvas to pick a color
    triCanvas.addEventListener('click', (evt) => {
      if (!this.#triColors[0] || !this.#triColors[1] || !this.#triColors[2]) return;
      const { x, y } = canvasPos(triCanvas, evt);
      this.#pickTriangleColor(x, y, triCanvas.width, triCanvas.height);
    });

    // Subscribe to state
    this.#unsubs.push(
      state.subscribe('gradient', () => this.#onGradientStateChange()),
      state.subscribe('triangleGradient', () => this.#onTriangleStateChange()),
    );

    // Initialize from state
    this.#onGradientStateChange();
    this.#onTriangleStateChange();
  }

  renderGradientBar() {
    this.#renderBar();
  }

  renderTriangle() {
    this.#renderTri();
  }

  // -- Private: scheduling --------------------------------------------------

  #scheduleRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#renderBar();
      this.#renderTri();
      this.#updateSwatches();
    });
  }

  // -- Private: state sync --------------------------------------------------

  #onGradientStateChange() {
    const grad = this.#state.get('gradient');
    if (grad.color1) this.#color1 = grad.color1;
    if (grad.color2) this.#color2 = grad.color2;
    this.#scheduleRender();
  }

  #onTriangleStateChange() {
    const tri = this.#state.get('triangleGradient');
    if (tri.colors) {
      for (let i = 0; i < 3; i++) {
        if (tri.colors[i]) this.#triColors[i] = tri.colors[i];
      }
    }
    this.#scheduleRender();
  }

  // -- Private: swatch updates ----------------------------------------------

  #updateSwatches() {
    const { color1Swatch, color2Swatch, triSwatches } = this.#elements;

    if (this.#color1) {
      color1Swatch.style.backgroundColor = this.#engine.toHex(this.#color1.xyz, 'xyz');
    }
    if (this.#color2) {
      color2Swatch.style.backgroundColor = this.#engine.toHex(this.#color2.xyz, 'xyz');
    }

    for (let i = 0; i < 3; i++) {
      if (this.#triColors[i]) {
        triSwatches[i].style.backgroundColor = this.#engine.toHex(this.#triColors[i].xyz, 'xyz');
      }
    }
  }

  // -- Private: two-color gradient bar --------------------------------------

  #renderBar() {
    if (!this.#color1 || !this.#color2) return;

    const canvas = this.#elements.gradientBar;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Interpolate in L*a*b* for perceptual uniformity
    const lab1 = this.#engine.convert(this.#color1.xyz, 'xyz', 'lab');
    const lab2 = this.#engine.convert(this.#color2.xyz, 'xyz', 'lab');

    for (let px = 0; px < w; px++) {
      const t = px / (w - 1);
      const labMix = [
        lerp(lab1[0], lab2[0], t),
        lerp(lab1[1], lab2[1], t),
        lerp(lab1[2], lab2[2], t),
      ];

      const [r, g, b] = this.#engine.toSRGB(labMix, 'lab');

      for (let py = 0; py < h; py++) {
        const idx = (py * w + px) * 4;
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  #pickGradientColor(t) {
    t = clamp(t, 0, 1);
    const lab1 = this.#engine.convert(this.#color1.xyz, 'xyz', 'lab');
    const lab2 = this.#engine.convert(this.#color2.xyz, 'xyz', 'lab');

    const labMix = [
      lerp(lab1[0], lab2[0], t),
      lerp(lab1[1], lab2[1], t),
      lerp(lab1[2], lab2[2], t),
    ];

    const xyz = this.#engine.convert(labMix, 'lab', 'xyz');
    this.#state.set('currentColor', {
      xyz,
      sourceSpace: 'lab',
      sourceValues: labMix,
    });
  }

  // -- Private: three-color triangle ----------------------------------------

  #renderTri() {
    const c0 = this.#triColors[0];
    const c1 = this.#triColors[1];
    const c2 = this.#triColors[2];
    if (!c0 || !c1 || !c2) return;

    const canvas = this.#elements.triCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Define triangle vertices in canvas coordinates
    // Equilateral triangle centered in canvas
    const cx = w / 2;
    const cy = h / 2;
    const triSize = Math.min(w, h) * 0.45;

    const v0 = { x: cx, y: cy - triSize }; // top
    const v1 = { x: cx - triSize * Math.cos(Math.PI / 6), y: cy + triSize * Math.sin(Math.PI / 6) }; // bottom-left
    const v2 = { x: cx + triSize * Math.cos(Math.PI / 6), y: cy + triSize * Math.sin(Math.PI / 6) }; // bottom-right

    // L*a*b* values for barycentric interpolation
    const lab0 = this.#engine.convert(c0.xyz, 'xyz', 'lab');
    const lab1 = this.#engine.convert(c1.xyz, 'xyz', 'lab');
    const lab2 = this.#engine.convert(c2.xyz, 'xyz', 'lab');

    // Precompute denominator for barycentric coords
    const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        // Compute barycentric coordinates
        const w0 = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / denom;
        const w1 = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / denom;
        const w2 = 1 - w0 - w1;

        const idx = (py * w + px) * 4;

        // Outside the triangle
        if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) {
          data[idx]     = 32;
          data[idx + 1] = 32;
          data[idx + 2] = 32;
          data[idx + 3] = 255;
          continue;
        }

        // Clamp barycentric coords for pixels just outside edges
        const bw0 = Math.max(0, w0);
        const bw1 = Math.max(0, w1);
        const bw2 = Math.max(0, w2);
        const bSum = bw0 + bw1 + bw2;
        const nw0 = bw0 / bSum;
        const nw1 = bw1 / bSum;
        const nw2 = bw2 / bSum;

        const labMix = [
          lab0[0] * nw0 + lab1[0] * nw1 + lab2[0] * nw2,
          lab0[1] * nw0 + lab1[1] * nw1 + lab2[1] * nw2,
          lab0[2] * nw0 + lab1[2] * nw1 + lab2[2] * nw2,
        ];

        const [r, g, b] = this.#engine.toSRGB(labMix, 'lab');

        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw triangle outline
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(v0.x, v0.y);
    ctx.lineTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
    ctx.closePath();
    ctx.stroke();
  }

  #pickTriangleColor(px, py, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const triSize = Math.min(w, h) * 0.45;

    const v0 = { x: cx, y: cy - triSize };
    const v1 = { x: cx - triSize * Math.cos(Math.PI / 6), y: cy + triSize * Math.sin(Math.PI / 6) };
    const v2 = { x: cx + triSize * Math.cos(Math.PI / 6), y: cy + triSize * Math.sin(Math.PI / 6) };

    const denom = (v1.y - v2.y) * (v0.x - v2.x) + (v2.x - v1.x) * (v0.y - v2.y);
    let w0 = ((v1.y - v2.y) * (px - v2.x) + (v2.x - v1.x) * (py - v2.y)) / denom;
    let w1 = ((v2.y - v0.y) * (px - v2.x) + (v0.x - v2.x) * (py - v2.y)) / denom;
    let w2 = 1 - w0 - w1;

    // Clamp to triangle
    w0 = Math.max(0, w0);
    w1 = Math.max(0, w1);
    w2 = Math.max(0, w2);
    const bSum = w0 + w1 + w2;
    if (bSum < 0.001) return;
    w0 /= bSum;
    w1 /= bSum;
    w2 /= bSum;

    const lab0 = this.#engine.convert(this.#triColors[0].xyz, 'xyz', 'lab');
    const lab1 = this.#engine.convert(this.#triColors[1].xyz, 'xyz', 'lab');
    const lab2 = this.#engine.convert(this.#triColors[2].xyz, 'xyz', 'lab');

    const labMix = [
      lab0[0] * w0 + lab1[0] * w1 + lab2[0] * w2,
      lab0[1] * w0 + lab1[1] * w1 + lab2[1] * w2,
      lab0[2] * w0 + lab1[2] * w1 + lab2[2] * w2,
    ];

    const xyz = this.#engine.convert(labMix, 'lab', 'xyz');
    this.#state.set('currentColor', {
      xyz,
      sourceSpace: 'lab',
      sourceValues: labMix,
    });
  }
}
