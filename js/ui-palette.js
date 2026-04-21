// ---------------------------------------------------------------------------
//  ui-palette.js  --  256-color palette editor module
//
//  ES module. Provides PaletteEditor: create, visualize, manipulate, and
//  export classic 256-color palettes with Catmull-Rom spline interpolation
//  in CIE L*a*b* space for perceptual uniformity.
// ---------------------------------------------------------------------------

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const PALETTE_SIZE = 256;
const PALETTE_BYTES = PALETTE_SIZE * 3;
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 60;
const STRIP_HEIGHT = 48;       // color strip occupies top 48px
const MARKER_ZONE = 12;        // bottom 12px for control point markers
const MARKER_HALF = 5;         // half-width of triangle markers
const MARKER_HEIGHT = 8;       // height of triangle markers
const STRIPE_WIDTH = CANVAS_WIDTH / PALETTE_SIZE; // ~3.125 px per entry

const PRESET_NAMES = ['Rainbow', 'Grayscale', 'Heat', 'Cool', 'Random'];

// ---------------------------------------------------------------------------
//  Catmull-Rom scalar interpolation
// ---------------------------------------------------------------------------

function catmullRom(p0, p1, p2, p3, t) {
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

// ---------------------------------------------------------------------------
//  Download helper
// ---------------------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
//  Clamp helpers
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampByte(v) {
  return clamp(Math.round(v), 0, 255);
}

// ---------------------------------------------------------------------------
//  Median Cut quantization
//
//  Given an array of [r,g,b] pixels, partitions RGB space into `targetCount`
//  boxes by repeatedly splitting the box with the largest range along its
//  longest color axis at the median.  Each box's average becomes one palette
//  entry.  Classic algorithm (Heckbert, 1982).
// ---------------------------------------------------------------------------

function medianCut(pixels, targetCount) {
  if (pixels.length === 0) return [];
  if (pixels.length <= targetCount) {
    // Fewer unique-ish pixels than palette slots — return them directly
    return pixels.map(p => [p[0], p[1], p[2]]);
  }

  // A "box" is a subset of pixels with tracked min/max per channel
  function makeBox(pxs) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (let i = 0; i < pxs.length; i++) {
      const p = pxs[i];
      if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
      if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
      if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
    }
    return { pixels: pxs, rMin, rMax, gMin, gMax, bMin, bMax };
  }

  // Find the channel with the largest range in a box
  function longestAxis(box) {
    const rRange = box.rMax - box.rMin;
    const gRange = box.gMax - box.gMin;
    const bRange = box.bMax - box.bMin;
    if (rRange >= gRange && rRange >= bRange) return 0;
    if (gRange >= rRange && gRange >= bRange) return 1;
    return 2;
  }

  // Volume of a box (used to pick which box to split)
  function boxVolume(box) {
    return (box.rMax - box.rMin + 1) *
           (box.gMax - box.gMin + 1) *
           (box.bMax - box.bMin + 1);
  }

  // Split a box at the median of its longest axis
  function splitBox(box) {
    const axis = longestAxis(box);
    const pxs = box.pixels;

    // Sort pixels along the chosen axis
    pxs.sort((a, b) => a[axis] - b[axis]);

    const mid = pxs.length >> 1;
    return [
      makeBox(pxs.slice(0, mid)),
      makeBox(pxs.slice(mid)),
    ];
  }

  // Average color of all pixels in a box
  function boxAverage(box) {
    const pxs = box.pixels;
    let rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < pxs.length; i++) {
      rSum += pxs[i][0];
      gSum += pxs[i][1];
      bSum += pxs[i][2];
    }
    const n = pxs.length;
    return [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)];
  }

  // Start with one box containing all pixels
  let boxes = [makeBox(pixels)];

  // Iteratively split until we have enough boxes
  while (boxes.length < targetCount) {
    // Pick the box to split: the one with the largest (volume × count) product.
    // This balances splitting large color ranges AND populous regions.
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.pixels.length < 2) continue; // can't split a single pixel
      const score = boxVolume(b) * b.pixels.length;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestScore <= 0) break; // all remaining boxes are single pixels

    const [a, b] = splitBox(boxes[bestIdx]);
    boxes.splice(bestIdx, 1, a, b);
  }

  // Each box becomes one palette color
  return boxes.map(boxAverage);
}

// ---------------------------------------------------------------------------
//  Sort key for palette ordering: hue-based with lightness tiebreaker
// ---------------------------------------------------------------------------

function rgbToSortKey(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;

  // Very desaturated colors (grays) sort separately at the end by lightness
  if (s < 0.08) return 400 + l * 100;

  // Chromatic colors: sort by hue, then lightness
  return h + l * 0.001;
}

// ---------------------------------------------------------------------------
//  PaletteEditor
// ---------------------------------------------------------------------------

export class PaletteEditor {
  /**
   * @param {object} elements  DOM element references
   * @param {AppState} state   Application state store
   * @param {ColorEngine} engine  Color conversion engine
   */
  constructor(elements, state, engine) {
    this.el = elements;
    this.state = state;
    this.engine = engine;

    // Internal state
    this.palette = new Uint8Array(PALETTE_BYTES);
    this.controlPoints = [];
    this.rotation = 0;
    this.savedPalettes = [];
    this._presetIndex = 0;

    // Interaction state
    this._dragIndex = -1;       // index into controlPoints being dragged
    this._dirty = true;
    this._rafId = null;

    // Indexed image preview state
    // _imageIndices stores the palette index (0-255) for each pixel of the loaded image.
    // On every render, the image is recolored from the current (rotated) palette.
    this._imageIndices = null;   // Uint8Array(w*h) of palette indices, or null
    this._imageWidth = 0;
    this._imageHeight = 0;
    this._imageCanvas = document.getElementById('palette-image-canvas');
    this._imageContainer = document.getElementById('palette-image-container');
    this._imageCtx = this._imageCanvas?.getContext('2d') || null;

    // Canvas setup
    this._ctx = this.el.canvas.getContext('2d');
    this.el.canvas.width = CANVAS_WIDTH;
    this.el.canvas.height = CANVAS_HEIGHT;

    // Restore saved palettes from state
    const saved = this.state.get('paletteEditor.savedPalettes');
    if (Array.isArray(saved)) {
      this.savedPalettes = saved.map(entry => ({
        name: entry.name,
        palette: entry.palette instanceof Uint8Array
          ? new Uint8Array(entry.palette)
          : new Uint8Array(entry.palette || PALETTE_BYTES),
        controlPoints: Array.isArray(entry.controlPoints)
          ? entry.controlPoints.map(cp => ({ index: cp.index, color: [...cp.color] }))
          : [],
      }));
    }

    // Initialize to rainbow
    this._applyPreset('Rainbow');

    // Bind event listeners
    this._bindEvents();

    // Start render loop
    this._scheduleRender();

    // Subscribe to panel visibility
    this.state.subscribe('paletteEditor.open', (open) => {
      if (this.el.panel) {
        this.el.panel.style.display = open ? '' : 'none';
      }
      if (open) this._markDirty();
    });
  }

  // -----------------------------------------------------------------------
  //  Event binding
  // -----------------------------------------------------------------------

  _bindEvents() {
    // Canvas mouse interactions
    this.el.canvas.addEventListener('mousedown', (e) => this._onCanvasMouseDown(e));
    this.el.canvas.addEventListener('contextmenu', (e) => this._onCanvasContextMenu(e));
    // Hover cursor
    this.el.canvas.addEventListener('mousemove', (e) => {
      if (this._dragIndex >= 0) return; // during drag, document handles it
      const idx = this._xToIndex(e);
      const cpIdx = this._findControlPoint(idx);
      this.el.canvas.style.cursor = cpIdx >= 0 ? 'grab' : 'pointer';
    });

    // Buttons
    if (this.el.btnNew) {
      this.el.btnNew.addEventListener('click', () => this._onNewPalette());
    }
    if (this.el.btnFromImage) {
      this.el.btnFromImage.addEventListener('click', () => this._onFromImage());
    }
    if (this.el.btnSave) {
      this.el.btnSave.addEventListener('click', () => this._onSavePalette());
    }
    if (this.el.btnLoad) {
      this.el.btnLoad.addEventListener('click', () => this._onLoadPalette());
    }
    if (this.el.btnExport) {
      this.el.btnExport.addEventListener('click', () => this._onExportPalette());
    }


    // Rotation slider
    if (this.el.rotationSlider) {
      this.el.rotationSlider.min = '0';
      this.el.rotationSlider.max = '255';
      this.el.rotationSlider.value = '0';
      this.el.rotationSlider.addEventListener('input', (e) => {
        this.rotation = parseInt(e.target.value, 10) || 0;
        this._markDirty();
      });
    }

    // Adjustment buttons (look up by ID since they may not be in the elements obj)
    const $ = id => document.getElementById(id);

    $('btn-palette-load-preview')?.addEventListener('click', () => this._onLoadPreviewImage());
    $('btn-close-preview-image')?.addEventListener('click', () => {
      this._imageIndices = null;
      this._imageWidth = 0;
      this._imageHeight = 0;
      if (this._imageContainer) this._imageContainer.classList.remove('has-image');
    });

    $('btn-palette-hue-minus')?.addEventListener('click', () => this.shiftHue(-30));
    $('btn-palette-random')?.addEventListener('click', () => this._onRandomPalette());
    $('btn-palette-hue-plus')?.addEventListener('click', () => this.shiftHue(30));
    $('btn-palette-sat-up')?.addEventListener('click', () => this.adjustSaturation(15));
    $('btn-palette-sat-down')?.addEventListener('click', () => this.adjustSaturation(-15));
    $('btn-palette-brighter')?.addEventListener('click', () => this.adjustBrightness(10));
    $('btn-palette-darker')?.addEventListener('click', () => this.adjustBrightness(-10));
    $('btn-palette-reverse')?.addEventListener('click', () => this.reverse());
    $('btn-palette-smooth')?.addEventListener('click', () => this.smooth(1));
    $('btn-palette-from-saved')?.addEventListener('click', () => this._onFromSavedColors());
    $('btn-palette-blend')?.addEventListener('click', () => this._onBlendPalettes());
    $('btn-palette-mix')?.addEventListener('click', () => this._onChannelMix());

    // Draw-on-picker shape mode
    const shapeSelect = $('palette-shape-mode');
    shapeSelect?.addEventListener('change', () => {
      const mode = shapeSelect.value;
      shapeSelect.value = shapeSelect.options[0].value; // reset visual
      this._toggleShapeDrawOnPicker(mode);
    });
    $('btn-palette-curves')?.addEventListener('click', () => this._onCurvesDialog());

    // Palette selection for cut/copy/paste
    this._selectionStart = -1;
    this._selectionEnd = -1;
    this._selecting = false;

    const selBtn = $('btn-palette-select');
    const cutBtn = $('btn-palette-cut');
    const copyBtn = $('btn-palette-copy');
    const pasteBtn = $('btn-palette-paste');

    selBtn?.addEventListener('click', () => {
      this._selecting = !this._selecting;
      if (this._selecting) {
        selBtn.style.background = '#4a90d9';
        selBtn.textContent = 'Selecting...';
        this.el.canvas.style.cursor = 'text';
      } else {
        selBtn.style.background = '';
        selBtn.textContent = 'Select';
        this.el.canvas.style.cursor = '';
        this._selectionStart = -1;
        this._selectionEnd = -1;
        this._markDirty();
      }
    });

    cutBtn?.addEventListener('click', () => {
      if (this._selectionStart >= 0 && this._selectionEnd >= 0) {
        this.cutSection(this._selectionStart, this._selectionEnd);
        pasteBtn.disabled = false;
      }
    });
    copyBtn?.addEventListener('click', () => {
      if (this._selectionStart >= 0 && this._selectionEnd >= 0) {
        this.copySection(this._selectionStart, this._selectionEnd);
        pasteBtn.disabled = false;
      }
    });
    pasteBtn?.addEventListener('click', () => {
      if (this._clipboardSection && this._selectionStart >= 0 && this._selectionEnd >= 0) {
        this.pasteSection(this._selectionStart, this._selectionEnd);
      }
    });

    // Spline mode selector
    const splineSelect = $('palette-spline-mode');
    if (splineSelect) {
      splineSelect.addEventListener('change', () => {
        this.setSplineMode(splineSelect.value);
      });
    }

    // Animation speed slider
    const animSlider = $('palette-animate-speed');
    if (animSlider) {
      this._animSpeed = 0;
      this._animTimer = null;
      animSlider.addEventListener('input', (e) => {
        this._animSpeed = parseInt(e.target.value, 10) || 0;
        this._updateAnimation();
      });
    }
  }

  /** Start/stop palette rotation animation based on speed slider. */
  _updateAnimation() {
    if (this._animTimer) {
      clearInterval(this._animTimer);
      this._animTimer = null;
    }
    if (this._animSpeed > 0) {
      // Speed 1-100 maps to interval 200ms down to 10ms
      const interval = Math.max(10, 210 - this._animSpeed * 2);
      this._animTimer = setInterval(() => {
        this.rotation = (this.rotation + 1) % PALETTE_SIZE;
        if (this.el.rotationSlider) {
          this.el.rotationSlider.value = String(this.rotation);
        }
        this._markDirty();
      }, interval);
    }
  }

  // -----------------------------------------------------------------------
  //  Canvas interaction handlers
  // -----------------------------------------------------------------------

  /**
   * Map a mouse event's x position to a palette index (0-255).
   */
  _xToIndex(e) {
    const rect = this.el.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Use CSS width (rect.width), not internal canvas resolution (CANVAS_WIDTH)
    const raw = Math.floor((x / rect.width) * PALETTE_SIZE);
    return clamp(raw, 0, 255);
  }

  /**
   * Find the control point nearest to a given palette index, within a
   * tolerance. Tolerance is ~12px worth of palette indices based on CSS size.
   * Returns the array index or -1.
   */
  _findControlPoint(paletteIndex) {
    const rect = this.el.canvas.getBoundingClientRect();
    const pxPer = rect.width / PALETTE_SIZE;  // CSS pixels per palette entry
    const tolerance = Math.max(3, Math.ceil(12 / pxPer)); // ~12px grab radius
    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < this.controlPoints.length; i++) {
      const dist = Math.abs(this.controlPoints[i].index - paletteIndex);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  _onCanvasMouseDown(e) {
    if (e.button !== 0) return;

    const idx = this._xToIndex(e);

    // Selection mode: drag to select a palette range
    if (this._selecting) {
      this._selectionStart = idx;
      this._selectionEnd = idx;
      const cutBtn = document.getElementById('btn-palette-cut');
      const copyBtn = document.getElementById('btn-palette-copy');
      const onMove = (me) => {
        this._selectionEnd = this._xToIndex(me);
        this._markDirty();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (cutBtn) cutBtn.disabled = false;
        if (copyBtn) copyBtn.disabled = false;
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      this._markDirty();
      return;
    }

    // Shift+click on a control point removes it
    if (e.shiftKey) {
      const cpIdx = this._findControlPoint(idx);
      if (cpIdx !== -1 && this.controlPoints.length > 2) {
        this.controlPoints.splice(cpIdx, 1);
        this._interpolatePalette();
        this._markDirty();
      }
      return;
    }

    // Check if clicking on an existing control point to drag it
    const cpIdx = this._findControlPoint(idx);
    if (cpIdx !== -1) {
      this._dragIndex = cpIdx;
      this.el.canvas.style.cursor = 'grabbing';
      this._markDirty();

      // Use document-level listeners so drag works even when mouse leaves the canvas
      const onMove = (me) => {
        me.preventDefault();
        const newIdx = this._xToIndex(me);
        this.controlPoints[this._dragIndex].index = newIdx;
        this._interpolatePalette();
        this._markDirty();
      };
      const onUp = () => {
        this._dragIndex = -1;
        this.el.canvas.style.cursor = 'pointer';
        this._markDirty();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      return;
    }

    // Click or drag: if the user drags more than 5px, it becomes a color drag.
    // If they release without moving, it's a click (pick that color).
    const startX = e.clientX, startY = e.clientY;
    const actualIdx = (idx + this.rotation) % PALETTE_SIZE;
    const off = actualIdx * 3;
    const pr = this.palette[off], pg = this.palette[off + 1], pb = this.palette[off + 2];
    const hex = '#' + [pr, pg, pb].map(c => c.toString(16).padStart(2, '0')).join('');
    let dragging = false;
    let dragEl = null;

    const onMove = (me) => {
      const dx = me.clientX - startX, dy = me.clientY - startY;
      if (!dragging && (dx * dx + dy * dy) > 25) {
        dragging = true;
        dragEl = document.createElement('div');
        dragEl.style.cssText = `position:fixed;width:24px;height:24px;background:${hex};border:2px solid #fff;border-radius:4px;pointer-events:none;z-index:10000;`;
        document.body.appendChild(dragEl);
      }
      if (dragEl) {
        dragEl.style.left = (me.clientX - 12) + 'px';
        dragEl.style.top = (me.clientY - 12) + 'px';
      }
    };
    const onUp = (me) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragEl) dragEl.remove();
      if (dragging) {
        // Dropped somewhere — set that color as current
        try {
          const parsed = this.engine.fromHex(hex);
          const xyz = this.engine.convert(parsed.values, 'srgb', 'xyz');
          this.state.batch({
            'currentColor.xyz': xyz,
            'currentColor.sourceSpace': 'srgb',
            'currentColor.sourceValues': parsed.values,
          });
        } catch {}
        return;
      }
      // Not a drag — treat as click (pick color)
      this._pickColorAtIndex(idx);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  _onCanvasContextMenu(e) {
    e.preventDefault();

    const idx = this._xToIndex(e);

    // Add a control point at this position using the current color
    const cc = this.state.get('currentColor');
    let rgb;
    if (cc && cc.sourceSpace && cc.sourceValues) {
      rgb = this.engine.toSRGB(cc.sourceValues, cc.sourceSpace);
    } else {
      // Fallback: use the color already in the palette at that index
      const off = idx * 3;
      rgb = [this.palette[off], this.palette[off + 1], this.palette[off + 2]];
    }

    this.controlPoints.push({ index: idx, color: [rgb[0], rgb[1], rgb[2]] });
    this._interpolatePalette();
    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Color picking
  // -----------------------------------------------------------------------

  _pickColorAtIndex(displayIndex) {
    // Account for rotation
    const actualIndex = (displayIndex + this.rotation) % PALETTE_SIZE;
    const off = actualIndex * 3;
    const r = this.palette[off];
    const g = this.palette[off + 1];
    const b = this.palette[off + 2];
    const xyz = this.engine.convert([r, g, b], 'srgb', 'xyz');

    this.state.set('currentColor', {
      xyz,
      sourceSpace: 'srgb',
      sourceValues: [r, g, b],
    });
  }

  // -----------------------------------------------------------------------
  //  Preset palettes
  // -----------------------------------------------------------------------

  _onNewPalette() {
    const presetName = PRESET_NAMES[this._presetIndex % PRESET_NAMES.length];
    this._presetIndex++;
    this._applyPreset(presetName);
  }

  _applyPreset(name) {
    this.controlPoints = [];

    switch (name) {
      case 'Rainbow':
        this._makeRainbow();
        break;
      case 'Grayscale':
        this._makeGrayscale();
        break;
      case 'Heat':
        this._makeHeat();
        break;
      case 'Cool':
        this._makeCool();
        break;
      case 'Random':
        this._makeRandom();
        break;
      default:
        this._makeRainbow();
    }

    this.rotation = 0;
    if (this.el.rotationSlider) {
      this.el.rotationSlider.value = '0';
    }

    this._interpolatePalette();
    this._markDirty();
  }

  _makeRainbow() {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * 255);
      const hue = (i / count) * 360;
      const rgb = this.engine.convert([hue, 100, 100], 'hsb', 'srgb');
      this.controlPoints.push({ index: idx, color: [rgb[0], rgb[1], rgb[2]] });
    }
  }

  _makeGrayscale() {
    this.controlPoints = [
      { index: 0,   color: [0, 0, 0] },
      { index: 64,  color: [64, 64, 64] },
      { index: 128, color: [128, 128, 128] },
      { index: 192, color: [192, 192, 192] },
      { index: 255, color: [255, 255, 255] },
    ];
  }

  _makeHeat() {
    this.controlPoints = [
      { index: 0,   color: [0, 0, 0] },
      { index: 85,  color: [180, 0, 0] },
      { index: 140, color: [255, 60, 0] },
      { index: 190, color: [255, 200, 0] },
      { index: 230, color: [255, 255, 100] },
      { index: 255, color: [255, 255, 255] },
    ];
  }

  _makeCool() {
    this.controlPoints = [
      { index: 0,   color: [0, 0, 0] },
      { index: 64,  color: [0, 0, 140] },
      { index: 128, color: [0, 80, 220] },
      { index: 190, color: [0, 200, 255] },
      { index: 230, color: [140, 240, 255] },
      { index: 255, color: [255, 255, 255] },
    ];
  }

  _makeRandom() {
    const count = 6;
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * 255);
      const r = Math.floor(Math.random() * 256);
      const g = Math.floor(Math.random() * 256);
      const b = Math.floor(Math.random() * 256);
      this.controlPoints.push({ index: idx, color: [r, g, b] });
    }
  }

  // -----------------------------------------------------------------------
  //  Spline interpolation in L*a*b*
  // -----------------------------------------------------------------------

  _interpolatePalette() {
    if (this.controlPoints.length === 0) {
      this.palette.fill(0);
      return;
    }

    if (this.controlPoints.length === 1) {
      const c = this.controlPoints[0].color;
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const off = i * 3;
        this.palette[off]     = clampByte(c[0]);
        this.palette[off + 1] = clampByte(c[1]);
        this.palette[off + 2] = clampByte(c[2]);
      }
      return;
    }

    // Sort control points by index
    const sorted = [...this.controlPoints].sort((a, b) => a.index - b.index);

    // Convert control point colors to Lab
    const labPoints = sorted.map(cp => ({
      index: cp.index,
      lab: this.engine.convert([cp.color[0], cp.color[1], cp.color[2]], 'srgb', 'lab'),
    }));

    // For each palette index, find surrounding control points and interpolate
    for (let i = 0; i < PALETTE_SIZE; i++) {
      // Find the segment this index falls into
      let segIdx = -1;
      for (let s = 0; s < labPoints.length - 1; s++) {
        if (i >= labPoints[s].index && i <= labPoints[s + 1].index) {
          segIdx = s;
          break;
        }
      }

      let lab;

      if (segIdx === -1) {
        // Index is before the first or after the last control point
        if (i < labPoints[0].index) {
          lab = [...labPoints[0].lab];
        } else {
          lab = [...labPoints[labPoints.length - 1].lab];
        }
      } else {
        const p1 = labPoints[segIdx];
        const p2 = labPoints[segIdx + 1];

        // Compute t within the segment
        const span = p2.index - p1.index;
        const t = span > 0 ? (i - p1.index) / span : 0;

        if (this._splineMode === 'linear') {
          // Simple linear interpolation
          lab = [
            p1.lab[0] + (p2.lab[0] - p1.lab[0]) * t,
            p1.lab[1] + (p2.lab[1] - p1.lab[1]) * t,
            p1.lab[2] + (p2.lab[2] - p1.lab[2]) * t,
          ];
        } else if (this._splineMode === 'bezier') {
          // Cubic Bezier approximation: auto-generate control handles
          const p0 = segIdx > 0 ? labPoints[segIdx - 1] : p1;
          const p3 = segIdx + 2 < labPoints.length ? labPoints[segIdx + 2] : p2;
          // Compute tangent-based handles (1/3 of adjacent spans)
          const h1 = [0, 0, 0], h2 = [0, 0, 0];
          for (let c = 0; c < 3; c++) {
            h1[c] = p1.lab[c] + (p2.lab[c] - p0.lab[c]) / 6;
            h2[c] = p2.lab[c] - (p3.lab[c] - p1.lab[c]) / 6;
          }
          const u = 1 - t;
          lab = [
            u*u*u * p1.lab[0] + 3*u*u*t * h1[0] + 3*u*t*t * h2[0] + t*t*t * p2.lab[0],
            u*u*u * p1.lab[1] + 3*u*u*t * h1[1] + 3*u*t*t * h2[1] + t*t*t * p2.lab[1],
            u*u*u * p1.lab[2] + 3*u*u*t * h1[2] + 3*u*t*t * h2[2] + t*t*t * p2.lab[2],
          ];
        } else {
          // Catmull-Rom (default): phantom endpoints for first/last segments
          const p0 = segIdx > 0
            ? labPoints[segIdx - 1]
            : { index: p1.index - (p2.index - p1.index), lab: p1.lab };
          const p3 = segIdx + 2 < labPoints.length
            ? labPoints[segIdx + 2]
            : { index: p2.index + (p2.index - p1.index), lab: p2.lab };
          lab = [
            catmullRom(p0.lab[0], p1.lab[0], p2.lab[0], p3.lab[0], t),
            catmullRom(p0.lab[1], p1.lab[1], p2.lab[1], p3.lab[1], t),
            catmullRom(p0.lab[2], p1.lab[2], p2.lab[2], p3.lab[2], t),
          ];
        }
      }

      // Convert back to sRGB
      const rgb = this.engine.convert(lab, 'lab', 'srgb');
      const off = i * 3;
      this.palette[off]     = clampByte(rgb[0]);
      this.palette[off + 1] = clampByte(rgb[1]);
      this.palette[off + 2] = clampByte(rgb[2]);
    }
  }

  // -----------------------------------------------------------------------
  //  Canvas rendering
  // -----------------------------------------------------------------------

  _markDirty() {
    this._dirty = true;
    if (this._rafId === null) {
      this._scheduleRender();
    }
  }

  _scheduleRender() {
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (this._dirty) {
        this._dirty = false;
        this._render();
      }
    });
  }

  _render() {
    const ctx = this._ctx;
    const w = CANVAS_WIDTH;
    const h = CANVAS_HEIGHT;

    ctx.clearRect(0, 0, w, h);

    // Draw the color strip
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const actualIdx = (i + this.rotation) % PALETTE_SIZE;
      const off = actualIdx * 3;
      const r = this.palette[off];
      const g = this.palette[off + 1];
      const b = this.palette[off + 2];

      const x = (i / PALETTE_SIZE) * w;
      const stripeW = ((i + 1) / PALETTE_SIZE) * w - x;

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, Math.ceil(stripeW), STRIP_HEIGHT);
    }

    // Draw selection highlight
    if (this._selectionStart >= 0 && this._selectionEnd >= 0) {
      const lo = Math.min(this._selectionStart, this._selectionEnd);
      const hi = Math.max(this._selectionStart, this._selectionEnd);
      const x1 = (lo / PALETTE_SIZE) * w;
      const x2 = ((hi + 1) / PALETTE_SIZE) * w;
      ctx.fillStyle = 'rgba(74, 144, 217, 0.3)';
      ctx.fillRect(x1, 0, x2 - x1, STRIP_HEIGHT);
      ctx.strokeStyle = 'rgba(74, 144, 217, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, 0, x2 - x1, STRIP_HEIGHT);
    }

    // Draw marker zone background (dark strip at bottom)
    ctx.fillStyle = 'rgba(24, 24, 24, 0.85)';
    ctx.fillRect(0, STRIP_HEIGHT, w, MARKER_ZONE);

    // Draw control point markers
    for (let i = 0; i < this.controlPoints.length; i++) {
      const cp = this.controlPoints[i];

      // Account for rotation for display position
      let displayIdx = (cp.index - this.rotation + PALETTE_SIZE) % PALETTE_SIZE;
      const cx = ((displayIdx + 0.5) / PALETTE_SIZE) * w;
      const cy = STRIP_HEIGHT + 2;

      const isDragging = (i === this._dragIndex);

      // Triangle marker pointing down
      ctx.beginPath();
      ctx.moveTo(cx - MARKER_HALF, cy);
      ctx.lineTo(cx + MARKER_HALF, cy);
      ctx.lineTo(cx, cy + MARKER_HEIGHT);
      ctx.closePath();

      // Fill
      ctx.fillStyle = isDragging ? '#ffff00' : '#ffffff';
      ctx.fill();

      // Outline
      ctx.strokeStyle = isDragging ? '#aa8800' : '#333333';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Small color dot inside the marker
      ctx.beginPath();
      ctx.arc(cx, cy + 3, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${cp.color[0]},${cp.color[1]},${cp.color[2]})`;
      ctx.fill();
    }

    // Draw rotation indicator line
    if (this.rotation > 0) {
      // The rotation offset shows where index 0 of the internal palette
      // appears in the display. Since display[i] = palette[(i + rotation) % 256],
      // internal index 0 appears at display position (256 - rotation) % 256.
      const dispPos = (PALETTE_SIZE - this.rotation) % PALETTE_SIZE;
      const rx = ((dispPos + 0.5) / PALETTE_SIZE) * w;

      // Glow
      ctx.save();
      ctx.shadowColor = 'rgba(255, 255, 255, 0.6)';
      ctx.shadowBlur = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx, 0);
      ctx.lineTo(rx, STRIP_HEIGHT);
      ctx.stroke();
      ctx.restore();
    }

    // Recolor the preview image (if one is loaded)
    this._renderPreviewImage();
  }

  // -----------------------------------------------------------------------
  //  Extract palette from image
  // -----------------------------------------------------------------------

  _onFromImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) {
        document.body.removeChild(input);
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          this._extractPaletteFromImage(img);
          document.body.removeChild(input);
        };
        img.onerror = () => {
          console.error('[palette] Failed to decode image');
          document.body.removeChild(input);
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    input.click();
  }

  _extractPaletteFromImage(img) {
    // Draw the image onto a temp canvas to read its pixels
    const maxDim = 256; // downsample large images for speed
    let sw = img.width, sh = img.height;
    if (sw > maxDim || sh > maxDim) {
      const scale = maxDim / Math.max(sw, sh);
      sw = Math.round(sw * scale);
      sh = Math.round(sh * scale);
    }
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = sw;
    tmpCanvas.height = sh;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(img, 0, 0, sw, sh);
    const imageData = tmpCtx.getImageData(0, 0, sw, sh);
    const pixels = imageData.data;

    // Collect all pixel RGB values (skip fully transparent)
    const allPixels = [];
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue; // skip transparent
      allPixels.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }

    if (allPixels.length === 0) {
      console.warn('[palette] Image has no opaque pixels');
      return;
    }

    // Median cut quantization → 256 representative colors
    const quantized = medianCut(allPixels, PALETTE_SIZE);

    // Sort the palette for a smooth strip: order by hue, then lightness
    quantized.sort((a, b) => {
      const ha = rgbToSortKey(a);
      const hb = rgbToSortKey(b);
      return ha - hb;
    });

    // Write to palette buffer
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      if (i < quantized.length) {
        this.palette[off]     = quantized[i][0];
        this.palette[off + 1] = quantized[i][1];
        this.palette[off + 2] = quantized[i][2];
      } else {
        // Pad with black if fewer than 256 colors
        this.palette[off] = this.palette[off + 1] = this.palette[off + 2] = 0;
      }
    }

    // Set control points at regular intervals from the quantized palette
    const cpCount = Math.min(16, quantized.length);
    this.controlPoints = [];
    for (let i = 0; i < cpCount; i++) {
      const idx = Math.round((i / (cpCount - 1)) * 255);
      const off = idx * 3;
      this.controlPoints.push({
        index: idx,
        color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
      });
    }

    this.rotation = 0;
    if (this.el.rotationSlider) {
      this.el.rotationSlider.value = '0';
    }

    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Save palette
  // -----------------------------------------------------------------------

  _onSavePalette() {
    const name = prompt('Palette name:', `Palette ${this.savedPalettes.length + 1}`);
    if (name === null) return; // cancelled

    const entry = {
      name: name || `Palette ${this.savedPalettes.length + 1}`,
      palette: new Uint8Array(this.palette),
      controlPoints: this.controlPoints.map(cp => ({
        index: cp.index,
        color: [...cp.color],
      })),
    };

    this.savedPalettes.push(entry);
    this._persistSavedPalettes();
  }

  _persistSavedPalettes() {
    // Convert Uint8Arrays to plain arrays for JSON serialization via state
    const serializable = this.savedPalettes.map(entry => ({
      name: entry.name,
      palette: Array.from(entry.palette),
      controlPoints: entry.controlPoints.map(cp => ({
        index: cp.index,
        color: [...cp.color],
      })),
    }));

    this.state.set('paletteEditor.savedPalettes', serializable);
  }

  // -----------------------------------------------------------------------
  //  Load palette
  // -----------------------------------------------------------------------

  _onLoadPalette() {
    if (this.savedPalettes.length === 0) {
      alert('No saved palettes.');
      return;
    }

    // Build a simple selection dialog
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.6);display:flex;align-items:center;' +
      'justify-content:center;z-index:10000;';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'background:#1e1e1e;color:#e0e0e0;border:1px solid #444;' +
      'border-radius:6px;padding:16px 20px;min-width:240px;max-width:400px;' +
      'font-family:system-ui,sans-serif;font-size:14px;';

    const title = document.createElement('div');
    title.textContent = 'Load Palette';
    title.style.cssText = 'font-weight:600;margin-bottom:12px;font-size:15px;';
    dialog.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'max-height:300px;overflow-y:auto;';

    this.savedPalettes.forEach((entry, i) => {
      const row = document.createElement('div');
      row.style.cssText =
        'padding:6px 10px;cursor:pointer;border-radius:3px;margin-bottom:2px;';
      row.textContent = entry.name;
      row.addEventListener('mouseenter', () => {
        row.style.background = '#333';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = '';
      });
      row.addEventListener('click', () => {
        this._loadPaletteEntry(entry);
        document.body.removeChild(overlay);
      });
      list.appendChild(row);
    });
    dialog.appendChild(list);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      'margin-top:12px;padding:4px 16px;background:#333;color:#e0e0e0;' +
      'border:1px solid #555;border-radius:3px;cursor:pointer;font-size:13px;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    document.body.appendChild(overlay);
  }

  _loadPaletteEntry(entry) {
    // Copy palette data
    const src = entry.palette instanceof Uint8Array
      ? entry.palette
      : new Uint8Array(entry.palette);
    this.palette.set(src);

    // Copy control points
    this.controlPoints = entry.controlPoints.map(cp => ({
      index: cp.index,
      color: [...cp.color],
    }));

    this.rotation = 0;
    if (this.el.rotationSlider) {
      this.el.rotationSlider.value = '0';
    }

    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Export palette
  // -----------------------------------------------------------------------

  _onExportPalette() {
    // Build a simple format selection dialog
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.6);display:flex;align-items:center;' +
      'justify-content:center;z-index:10000;';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'background:#1e1e1e;color:#e0e0e0;border:1px solid #444;' +
      'border-radius:6px;padding:16px 20px;min-width:200px;' +
      'font-family:system-ui,sans-serif;font-size:14px;';

    const title = document.createElement('div');
    title.textContent = 'Export Format';
    title.style.cssText = 'font-weight:600;margin-bottom:12px;font-size:15px;';
    dialog.appendChild(title);

    const formats = [
      { label: 'PNG Image (256 x 32)', value: 'png' },
      { label: 'JPEG Image (256 x 32)', value: 'jpg' },
      { label: 'BMP Image (256 x 32)', value: 'bmp' },
      { label: 'JSON', value: 'json' },
      { label: 'GPL (GIMP Palette)', value: 'gpl' },
    ];

    formats.forEach(fmt => {
      const btn = document.createElement('div');
      btn.style.cssText =
        'padding:8px 12px;cursor:pointer;border-radius:3px;margin-bottom:4px;';
      btn.textContent = fmt.label;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#333'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
      btn.addEventListener('click', () => {
        document.body.removeChild(overlay);
        this._doExport(fmt.value);
      });
      dialog.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      'margin-top:10px;padding:4px 16px;background:#333;color:#e0e0e0;' +
      'border:1px solid #555;border-radius:3px;cursor:pointer;font-size:13px;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    dialog.appendChild(cancelBtn);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });

    document.body.appendChild(overlay);
  }

  _doExport(format) {
    // Apply rotation to produce the exported palette
    const exported = new Uint8Array(PALETTE_BYTES);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const srcIdx = (i + this.rotation) % PALETTE_SIZE;
      exported[i * 3]     = this.palette[srcIdx * 3];
      exported[i * 3 + 1] = this.palette[srcIdx * 3 + 1];
      exported[i * 3 + 2] = this.palette[srcIdx * 3 + 2];
    }

    switch (format) {
      case 'png':
        this._exportPNG(exported);
        break;
      case 'jpg':
        this._exportImage(exported, 'image/jpeg', 'palette.jpg');
        break;
      case 'bmp':
        this._exportBMP(exported);
        break;
      case 'json':
        this._exportJSON(exported);
        break;
      case 'gpl':
        this._exportGPL(exported);
        break;
    }
  }

  _exportPNG(exported) {
    const pngCanvas = document.createElement('canvas');
    const pngW = 256;
    const pngH = 32;
    pngCanvas.width = pngW;
    pngCanvas.height = pngH;
    const pctx = pngCanvas.getContext('2d');

    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      pctx.fillStyle = `rgb(${exported[off]},${exported[off + 1]},${exported[off + 2]})`;
      pctx.fillRect(i, 0, 1, pngH);
    }

    pngCanvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'palette.png');
    }, 'image/png');
  }

  _exportImage(exported, mimeType, filename) {
    const cvs = document.createElement('canvas');
    cvs.width = 256; cvs.height = 32;
    const ctx = cvs.getContext('2d');
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      ctx.fillStyle = `rgb(${exported[off]},${exported[off + 1]},${exported[off + 2]})`;
      ctx.fillRect(i, 0, 1, 32);
    }
    cvs.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, mimeType, 0.95);
  }

  _exportBMP(exported) {
    // Build a 24-bit BMP file manually (no canvas needed)
    const w = 256, h = 32;
    const rowSize = Math.ceil(w * 3 / 4) * 4; // rows padded to 4-byte boundary
    const pixelDataSize = rowSize * h;
    const fileSize = 54 + pixelDataSize; // 14 (file header) + 40 (info header) + pixels
    const buf = new ArrayBuffer(fileSize);
    const view = new DataView(buf);

    // File header (14 bytes)
    view.setUint8(0, 0x42); view.setUint8(1, 0x4D); // 'BM'
    view.setUint32(2, fileSize, true);
    view.setUint32(10, 54, true); // pixel data offset

    // Info header (40 bytes)
    view.setUint32(14, 40, true); // header size
    view.setInt32(18, w, true);
    view.setInt32(22, h, true);
    view.setUint16(26, 1, true); // planes
    view.setUint16(28, 24, true); // bits per pixel
    view.setUint32(34, pixelDataSize, true);

    // Pixel data (bottom-up, BGR)
    for (let y = 0; y < h; y++) {
      const row = (h - 1 - y); // BMP is bottom-up
      for (let x = 0; x < w; x++) {
        const srcOff = x * 3;
        const dstOff = 54 + row * rowSize + x * 3;
        view.setUint8(dstOff, exported[srcOff + 2]);     // B
        view.setUint8(dstOff + 1, exported[srcOff + 1]); // G
        view.setUint8(dstOff + 2, exported[srcOff]);     // R
      }
    }

    const blob = new Blob([buf], { type: 'image/bmp' });
    downloadBlob(blob, 'palette.bmp');
  }

  _exportJSON(exported) {
    const colors = [];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      colors.push([exported[off], exported[off + 1], exported[off + 2]]);
    }
    const json = JSON.stringify({ colors }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, 'palette.json');
  }

  _exportGPL(exported) {
    let lines = ['GIMP Palette', 'Name: Exported Palette', '#'];
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      const r = exported[off];
      const g = exported[off + 1];
      const b = exported[off + 2];
      // Pad each channel to 3 chars wide for alignment
      const rs = String(r).padStart(3, ' ');
      const gs = String(g).padStart(3, ' ');
      const bs = String(b).padStart(3, ' ');
      lines.push(`${rs} ${gs} ${bs}\tIndex ${i}`);
    }
    const text = lines.join('\n') + '\n';
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, 'palette.gpl');
  }

  // -----------------------------------------------------------------------
  //  Indexed image preview — load, quantize to palette, recolor on render
  // -----------------------------------------------------------------------

  /**
   * Open a file picker to load an image for palette-cycling preview.
   * The image is quantized to the current 256-color palette: each pixel is
   * mapped to its nearest palette entry.  The index map is stored so the
   * image can be instantly recolored whenever the palette changes or rotates.
   */
  _onLoadPreviewImage() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) { document.body.removeChild(input); return; }

      const reader = new FileReader();
      reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
          this._buildIndexMap(img);
          document.body.removeChild(input);
        };
        img.onerror = () => {
          console.error('[palette] Failed to decode preview image');
          document.body.removeChild(input);
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });

    input.click();
  }

  /**
   * Convert the loaded image to an index map: for each pixel, find the
   * nearest color in the current palette and store its index.
   */
  _buildIndexMap(img) {
    // Cap dimensions to keep performance reasonable
    const maxDim = 512;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Read the image pixels
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(img, 0, 0, w, h);
    const imageData = tmpCtx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    // Build a palette lookup (unrotated) for nearest-color matching
    // For speed, use simple Euclidean distance in RGB space
    const indices = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const pr = pixels[i * 4];
      const pg = pixels[i * 4 + 1];
      const pb = pixels[i * 4 + 2];

      let bestDist = Infinity;
      let bestIdx = 0;
      for (let j = 0; j < PALETTE_SIZE; j++) {
        const off = j * 3;
        const dr = pr - this.palette[off];
        const dg = pg - this.palette[off + 1];
        const db = pb - this.palette[off + 2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = j;
          if (dist === 0) break; // exact match
        }
      }
      indices[i] = bestIdx;
    }

    this._imageIndices = indices;
    this._imageWidth = w;
    this._imageHeight = h;

    // Show the image container and size the canvas
    if (this._imageCanvas && this._imageContainer) {
      this._imageCanvas.width = w;
      this._imageCanvas.height = h;
      this._imageContainer.classList.add('has-image');
      this._imageContainer.querySelector('#palette-image-placeholder')?.remove();
    }

    this._markDirty();
  }

  /**
   * Recolor the preview image using the current (rotated) palette.
   * Called every render frame when an image is loaded.
   */
  _renderPreviewImage() {
    if (!this._imageIndices || !this._imageCtx) return;

    const w = this._imageWidth;
    const h = this._imageHeight;
    const imageData = this._imageCtx.createImageData(w, h);
    const out = imageData.data;
    const indices = this._imageIndices;
    const pal = this.palette;
    const rot = this.rotation;

    for (let i = 0; i < w * h; i++) {
      const palIdx = (indices[i] + rot) % PALETTE_SIZE;
      const off = palIdx * 3;
      const o = i * 4;
      out[o]     = pal[off];
      out[o + 1] = pal[off + 1];
      out[o + 2] = pal[off + 2];
      out[o + 3] = 255;
    }

    this._imageCtx.putImageData(imageData, 0, 0);
  }

  // -----------------------------------------------------------------------
  //  Draw on 2D picker to create a palette
  // -----------------------------------------------------------------------

  _drawModeActive = false;
  _drawPath = [];  // Array of {x, y} in picker CSS coords
  _drawCleanup = null;
  _shapeMode = null; // current shape tool: 'freehand','line','rect','ellipse','polygon'

  _toggleDrawOnPicker() {
    if (this._drawModeActive) {
      this._endDrawMode();
      return;
    }

    const pickerCanvas = document.getElementById('picker-canvas');
    if (!pickerCanvas) return;

    this._drawModeActive = true;
    this._shapeMode = 'freehand';
    this._drawPath = [];
    const sel = document.getElementById('palette-shape-mode');
    if (sel) sel.style.background = '#d94a4a';

    // Change cursor and add drawing listeners
    pickerCanvas.style.cursor = 'crosshair';
    let drawing = false;

    const getPickerColor = (x, y) => {
      // Map CSS coords to color values using the picker's current config
      const picker = this.state.get('picker');
      const space = this.engine.spaces.get(picker.spaceId);
      if (!space) return null;

      const rect = pickerCanvas.getBoundingClientRect();
      const tX = x / rect.width;
      const tY = y / rect.height;

      const xComp = space.components[picker.xAxis];
      const yComp = space.components[picker.yAxis];

      const xVal = picker.reversed?.x
        ? xComp.range[1] - tX * (xComp.range[1] - xComp.range[0])
        : xComp.range[0] + tX * (xComp.range[1] - xComp.range[0]);
      const yVal = picker.reversed?.y
        ? yComp.range[0] + tY * (yComp.range[1] - yComp.range[0])
        : yComp.range[1] - tY * (yComp.range[1] - yComp.range[0]);

      const values = [0, 0, 0];
      values[picker.xAxis] = xVal;
      values[picker.yAxis] = yVal;
      values[picker.excluded] = picker.excludedValue;

      return this.engine.toSRGB(values, picker.spaceId);
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drawing = true;
      this._drawPath = [];
      const rect = pickerCanvas.getBoundingClientRect();
      this._drawPath.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const onMove = (e) => {
      if (!drawing) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = pickerCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this._drawPath.push({ x, y });

      // Draw the path on the picker canvas using a 2D overlay
      this._drawPathOverlay();
    };

    const onUp = (e) => {
      if (!drawing) return;
      drawing = false;
      e.preventDefault();
      e.stopPropagation();

      if (this._drawPath.length < 2) return;

      // Convert the path to 256 evenly-spaced palette entries
      // First, compute cumulative arc length
      const arcLengths = [0];
      for (let i = 1; i < this._drawPath.length; i++) {
        const dx = this._drawPath[i].x - this._drawPath[i - 1].x;
        const dy = this._drawPath[i].y - this._drawPath[i - 1].y;
        arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
      }
      const totalLen = arcLengths[arcLengths.length - 1];
      if (totalLen < 1) return;

      // Sample 256 points along the path at equal arc-length intervals
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const targetLen = (i / (PALETTE_SIZE - 1)) * totalLen;

        // Find the segment containing this arc length
        let segIdx = 0;
        for (let s = 1; s < arcLengths.length; s++) {
          if (arcLengths[s] >= targetLen) { segIdx = s - 1; break; }
        }

        const segStart = arcLengths[segIdx];
        const segEnd = arcLengths[segIdx + 1] || segStart;
        const t = segEnd > segStart ? (targetLen - segStart) / (segEnd - segStart) : 0;

        const p0 = this._drawPath[segIdx];
        const p1 = this._drawPath[segIdx + 1] || p0;
        const x = p0.x + (p1.x - p0.x) * t;
        const y = p0.y + (p1.y - p0.y) * t;

        const rgb = getPickerColor(x, y) || [0, 0, 0];
        const off = i * 3;
        this.palette[off]     = rgb[0];
        this.palette[off + 1] = rgb[1];
        this.palette[off + 2] = rgb[2];
      }

      // Set control points from the sampled palette
      const cpCount = 12;
      this.controlPoints = [];
      for (let i = 0; i < cpCount; i++) {
        const idx = Math.round((i / (cpCount - 1)) * 255);
        const off = idx * 3;
        this.controlPoints.push({
          index: idx,
          color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
        });
      }

      this._markDirty();
      this._endDrawMode();
    };

    // Use capture to intercept before the picker's own handlers
    pickerCanvas.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);

    this._drawCleanup = () => {
      pickerCanvas.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      pickerCanvas.style.cursor = '';
    };
  }

  _drawPathOverlay() {
    // Draw the path on a temporary overlay canvas positioned over the picker
    let overlay = document.getElementById('picker-draw-overlay');
    const container = document.getElementById('picker-canvas-container');
    if (!overlay && container) {
      overlay = document.createElement('canvas');
      overlay.id = 'picker-draw-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:20;';
      container.appendChild(overlay);
    }
    if (!overlay) return;

    const rect = overlay.parentElement.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (this._drawPath.length < 2) return;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.moveTo(this._drawPath[0].x, this._drawPath[0].y);
    for (let i = 1; i < this._drawPath.length; i++) {
      ctx.lineTo(this._drawPath[i].x, this._drawPath[i].y);
    }
    ctx.stroke();

    // Draw start/end markers
    ctx.fillStyle = '#4ad94a';
    ctx.beginPath();
    ctx.arc(this._drawPath[0].x, this._drawPath[0].y, 4, 0, Math.PI * 2);
    ctx.fill();

    const last = this._drawPath[this._drawPath.length - 1];
    ctx.fillStyle = '#d94a4a';
    ctx.beginPath();
    ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  _endDrawMode() {
    this._drawModeActive = false;
    this._shapeMode = null;
    if (this._drawCleanup) {
      this._drawCleanup();
      this._drawCleanup = null;
    }
    const sel = document.getElementById('palette-shape-mode');
    if (sel) sel.style.background = '';
    // Remove overlay
    const overlay = document.getElementById('picker-draw-overlay');
    if (overlay) overlay.remove();
  }

  // -----------------------------------------------------------------------
  //  Shape draw-on-picker tools (line, rect, ellipse, polygon, freehand)
  // -----------------------------------------------------------------------

  _toggleShapeDrawOnPicker(mode) {
    // If already drawing, end first
    if (this._drawModeActive) {
      const wasMode = this._shapeMode;
      this._endDrawMode();
      if (wasMode === mode) return; // toggle off same mode
    }
    if (mode === 'freehand') {
      this._toggleDrawOnPicker();
      return;
    }
    const pickerCanvas = document.getElementById('picker-canvas');
    if (!pickerCanvas) return;

    this._drawModeActive = true;
    this._shapeMode = mode;
    this._drawPath = [];
    const sel = document.getElementById('palette-shape-mode');
    if (sel) sel.style.background = '#d94a4a';
    pickerCanvas.style.cursor = 'crosshair';

    const getPickerColor = (x, y) => {
      const picker = this.state.get('picker');
      const space = this.engine.spaces.get(picker.spaceId);
      if (!space) return null;
      const rect = pickerCanvas.getBoundingClientRect();
      const tX = x / rect.width, tY = y / rect.height;
      const xC = space.components[picker.xAxis], yC = space.components[picker.yAxis];
      const xVal = picker.reversed?.x
        ? xC.range[1] - tX * (xC.range[1] - xC.range[0])
        : xC.range[0] + tX * (xC.range[1] - xC.range[0]);
      const yVal = picker.reversed?.y
        ? yC.range[0] + tY * (yC.range[1] - yC.range[0])
        : yC.range[1] - tY * (yC.range[1] - yC.range[0]);
      const values = [0, 0, 0];
      values[picker.xAxis] = xVal;
      values[picker.yAxis] = yVal;
      values[picker.excluded] = picker.excludedValue;
      return this.engine.toSRGB(values, picker.spaceId);
    };

    // State for click-based shape building
    let clicks = [];  // {x,y} in CSS coords relative to picker
    let dragPt = null; // live mouse position during drag/hover

    const getPos = (e) => {
      const rect = pickerCanvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const drawPreview = () => {
      const pts = this._shapePreviewPoints(mode, clicks, dragPt);
      if (pts) {
        this._drawPath = pts;
        this._drawPathOverlay();
      }
    };

    const finishShape = () => {
      const pts = this._shapeToPath(mode, clicks);
      if (!pts || pts.length < 2) return;
      this._samplePathToPalette(pts, getPickerColor);
      this._markDirty();
      this._endDrawMode();
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const p = getPos(e);

      if (mode === 'line') {
        clicks.push(p);
        if (clicks.length >= 2) finishShape();
      } else if (mode === 'rect') {
        clicks.push(p);
        if (clicks.length >= 2) finishShape();
      } else if (mode === 'ellipse') {
        if (clicks.length === 0) {
          clicks.push(p); // center
        }
        // radius set on mouseup after drag
      } else if (mode === 'polygon') {
        clicks.push(p);
        drawPreview();
      }
    };

    const onDblClick = (e) => {
      if (mode !== 'polygon') return;
      e.preventDefault();
      e.stopPropagation();
      if (clicks.length >= 3) finishShape();
    };

    const onMove = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragPt = getPos(e);
      if (mode === 'ellipse' && clicks.length === 1 && e.buttons === 1) {
        drawPreview();
      } else if (clicks.length > 0) {
        drawPreview();
      }
    };

    const onUp = (e) => {
      if (mode === 'ellipse' && clicks.length === 1 && dragPt) {
        e.preventDefault();
        e.stopPropagation();
        const cx = clicks[0].x, cy = clicks[0].y;
        const rx = Math.abs(dragPt.x - cx), ry = Math.abs(dragPt.y - cy);
        if (rx > 2 || ry > 2) {
          clicks.push(dragPt);
          finishShape();
        }
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._endDrawMode();
      }
    };

    pickerCanvas.addEventListener('mousedown', onDown, true);
    pickerCanvas.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('keydown', onKeyDown, true);

    this._drawCleanup = () => {
      pickerCanvas.removeEventListener('mousedown', onDown, true);
      pickerCanvas.removeEventListener('dblclick', onDblClick, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('keydown', onKeyDown, true);
      pickerCanvas.style.cursor = '';
    };
  }

  /** Build preview path points for live overlay while user is defining a shape. */
  _shapePreviewPoints(mode, clicks, dragPt) {
    if (mode === 'line') {
      if (clicks.length === 1 && dragPt) return [clicks[0], dragPt];
    } else if (mode === 'rect') {
      if (clicks.length === 1 && dragPt) {
        const a = clicks[0], b = dragPt;
        return [a, {x:b.x,y:a.y}, b, {x:a.x,y:b.y}, a];
      }
    } else if (mode === 'ellipse') {
      if (clicks.length === 1 && dragPt) {
        const cx = clicks[0].x, cy = clicks[0].y;
        const rx = Math.abs(dragPt.x - cx), ry = Math.abs(dragPt.y - cy);
        if (rx < 1 && ry < 1) return null;
        const pts = [];
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
        }
        return pts;
      }
    } else if (mode === 'polygon') {
      if (clicks.length >= 1) {
        const pts = [...clicks];
        if (dragPt) pts.push(dragPt);
        if (clicks.length >= 3) pts.push(clicks[0]); // close preview
        return pts;
      }
    }
    return null;
  }

  /** Build the final path points for a completed shape. */
  _shapeToPath(mode, clicks) {
    if (mode === 'line') {
      if (clicks.length < 2) return null;
      return [clicks[0], clicks[1]];
    } else if (mode === 'rect') {
      if (clicks.length < 2) return null;
      const a = clicks[0], b = clicks[1];
      return [a, {x:b.x,y:a.y}, b, {x:a.x,y:b.y}, a];
    } else if (mode === 'ellipse') {
      if (clicks.length < 2) return null;
      const cx = clicks[0].x, cy = clicks[0].y;
      const rx = Math.abs(clicks[1].x - cx), ry = Math.abs(clicks[1].y - cy);
      const pts = [];
      const steps = 256;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
      return pts;
    } else if (mode === 'polygon') {
      if (clicks.length < 3) return null;
      return [...clicks, clicks[0]]; // close the polygon
    }
    return null;
  }

  /** Sample PALETTE_SIZE colors along a polyline path and set palette + control points. */
  _samplePathToPalette(path, getPickerColor) {
    if (path.length < 2) return;
    const arcLengths = [0];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalLen = arcLengths[arcLengths.length - 1];
    if (totalLen < 1) return;

    for (let i = 0; i < PALETTE_SIZE; i++) {
      const targetLen = (i / (PALETTE_SIZE - 1)) * totalLen;
      let segIdx = 0;
      for (let s = 1; s < arcLengths.length; s++) {
        if (arcLengths[s] >= targetLen) { segIdx = s - 1; break; }
      }
      const segStart = arcLengths[segIdx];
      const segEnd = arcLengths[segIdx + 1] || segStart;
      const t = segEnd > segStart ? (targetLen - segStart) / (segEnd - segStart) : 0;
      const p0 = path[segIdx], p1 = path[segIdx + 1] || p0;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      const rgb = getPickerColor(x, y) || [0, 0, 0];
      const off = i * 3;
      this.palette[off] = rgb[0];
      this.palette[off + 1] = rgb[1];
      this.palette[off + 2] = rgb[2];
    }
    const cpCount = 12;
    this.controlPoints = [];
    for (let i = 0; i < cpCount; i++) {
      const idx = Math.round((i / (cpCount - 1)) * 255);
      const off = idx * 3;
      this.controlPoints.push({
        index: idx,
        color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
      });
    }
  }

  // -----------------------------------------------------------------------
  //  Random palette with configurable complexity
  // -----------------------------------------------------------------------

  _onRandomPalette() {
    const countStr = prompt('Number of random control points (3-32):', '8');
    if (!countStr) return;
    const count = clamp(parseInt(countStr, 10) || 8, 3, 32);

    this.controlPoints = [];
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? 128 : Math.round((i / (count - 1)) * 255);
      this.controlPoints.push({
        index: idx,
        color: [
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
          Math.floor(Math.random() * 256),
        ],
      });
    }

    this._interpolatePalette();
    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Create palette from saved colors
  // -----------------------------------------------------------------------

  /**
   * Build a palette by using all saved colors as spline control points.
   * If 2 colors: linear gradient between them.
   * If 1 color: flat palette of that color.
   * If 3+: Catmull-Rom spline through them in Lab space.
   */
  _onFromSavedColors() {
    const saved = this.state.get('savedColors');
    if (!saved || saved.length === 0) {
      alert('No saved colors. Save some colors first (click "+ Save" in the bottom bar).');
      return;
    }

    // Convert each saved color to sRGB
    const rgbs = saved.map(c => {
      try {
        return this.engine.toSRGB(c.sourceValues, c.sourceSpace);
      } catch {
        return [128, 128, 128];
      }
    });

    // Distribute as control points evenly across 0-255
    this.controlPoints = rgbs.map((rgb, i) => ({
      index: saved.length === 1 ? 128 : Math.round((i / (rgbs.length - 1)) * 255),
      color: [rgb[0], rgb[1], rgb[2]],
    }));

    // If only one color, duplicate it at both ends
    if (this.controlPoints.length === 1) {
      this.controlPoints = [
        { index: 0, color: [...this.controlPoints[0].color] },
        { index: 255, color: [...this.controlPoints[0].color] },
      ];
    }

    this._interpolatePalette();
    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Blend between two saved palettes
  // -----------------------------------------------------------------------

  /**
   * Show a dialog to pick two saved palettes and blend between them
   * with a slider. The preview image (if loaded) updates live.
   */
  _onBlendPalettes() {
    if (this.savedPalettes.length < 2) {
      alert('Need at least 2 saved palettes to blend. Save some palettes first.');
      return;
    }

    // Build overlay dialog
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;z-index:2000;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e3a;border:1px solid #3a3a5a;border-radius:6px;' +
      'padding:16px;min-width:350px;max-width:500px;color:#e0e0f0;font-size:13px;';

    dialog.innerHTML = `
      <h3 style="margin-bottom:12px;font-size:14px;">Blend Two Palettes</h3>
      <div style="margin-bottom:8px;">
        <label style="display:block;margin-bottom:4px;color:#8888aa;font-size:11px;">Palette A:</label>
        <select id="blend-pal-a" style="width:100%;padding:4px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;">
          ${this.savedPalettes.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;margin-bottom:4px;color:#8888aa;font-size:11px;">Palette B:</label>
        <select id="blend-pal-b" style="width:100%;padding:4px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;">
          ${this.savedPalettes.map((p, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;margin-bottom:4px;color:#8888aa;font-size:11px;">
          Blend: <span id="blend-pct">50</span>%
        </label>
        <input type="range" id="blend-slider" min="0" max="100" value="50"
          style="width:100%;accent-color:#4a90d9;">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="blend-apply" style="padding:4px 16px;background:#4a90d9;color:#fff;border:none;border-radius:3px;cursor:pointer;">Apply</button>
        <button id="blend-cancel" style="padding:4px 16px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;">Cancel</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const selectA = dialog.querySelector('#blend-pal-a');
    const selectB = dialog.querySelector('#blend-pal-b');
    const slider = dialog.querySelector('#blend-slider');
    const pctLabel = dialog.querySelector('#blend-pct');

    const doBlend = () => {
      const a = this.savedPalettes[parseInt(selectA.value, 10)];
      const b = this.savedPalettes[parseInt(selectB.value, 10)];
      if (!a || !b) return;
      const t = parseInt(slider.value, 10) / 100;
      pctLabel.textContent = Math.round(t * 100);

      // Interpolate in Lab space for perceptual uniformity
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const offA = i * 3, offB = i * 3;
        const labA = this.engine.convert(
          [a.palette[offA], a.palette[offA + 1], a.palette[offA + 2]], 'srgb', 'lab');
        const labB = this.engine.convert(
          [b.palette[offB], b.palette[offB + 1], b.palette[offB + 2]], 'srgb', 'lab');

        const labMix = [
          labA[0] + (labB[0] - labA[0]) * t,
          labA[1] + (labB[1] - labA[1]) * t,
          labA[2] + (labB[2] - labA[2]) * t,
        ];
        const rgb = this.engine.convert(labMix, 'lab', 'srgb');
        const off = i * 3;
        this.palette[off]     = clampByte(rgb[0]);
        this.palette[off + 1] = clampByte(rgb[1]);
        this.palette[off + 2] = clampByte(rgb[2]);
      }
      this._markDirty();
    };

    slider.addEventListener('input', doBlend);
    selectA.addEventListener('change', doBlend);
    selectB.addEventListener('change', doBlend);

    // Apply initial blend
    doBlend();

    dialog.querySelector('#blend-apply').addEventListener('click', () => {
      // Rebuild control points from the blended palette
      const cpCount = 8;
      this.controlPoints = [];
      for (let i = 0; i < cpCount; i++) {
        const idx = Math.round((i / (cpCount - 1)) * 255);
        const off = idx * 3;
        this.controlPoints.push({
          index: idx,
          color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
        });
      }
      document.body.removeChild(overlay);
    });

    dialog.querySelector('#blend-cancel').addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
  }

  // -----------------------------------------------------------------------
  //  Channel mixing matrix
  // -----------------------------------------------------------------------

  /**
   * Show a 3×3 matrix dialog for RGB channel mixing:
   *   newR = a*R + b*G + c*B
   *   newG = d*R + e*G + f*B
   *   newB = g*R + h*G + i*B
   * Results can be clipped (clamped to 0-255) or normalized.
   */
  _onChannelMix() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;z-index:2000;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e3a;border:1px solid #3a3a5a;border-radius:6px;' +
      'padding:16px;min-width:320px;color:#e0e0f0;font-size:13px;';

    const inputStyle = 'width:50px;padding:2px 4px;background:#252545;color:#e0e0f0;' +
      'border:1px solid #3a3a5a;border-radius:3px;text-align:center;font-size:12px;';

    dialog.innerHTML = `
      <h3 style="margin-bottom:12px;font-size:14px;">Channel Mixing Matrix</h3>
      <p style="color:#8888aa;font-size:11px;margin-bottom:10px;">
        Each output channel is a weighted sum of the input channels (0-100%).
      </p>
      <table style="border-collapse:collapse;margin-bottom:12px;">
        <tr>
          <td style="padding:4px;color:#8888aa;font-size:11px;"></td>
          <td style="padding:4px;color:#ff6666;font-size:11px;text-align:center;">R in</td>
          <td style="padding:4px;color:#66ff66;font-size:11px;text-align:center;">G in</td>
          <td style="padding:4px;color:#6666ff;font-size:11px;text-align:center;">B in</td>
        </tr>
        <tr>
          <td style="padding:4px;color:#ff6666;font-size:11px;">R out</td>
          <td style="padding:3px;"><input id="mix-rr" type="number" value="100" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-rg" type="number" value="0" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-rb" type="number" value="0" style="${inputStyle}"></td>
        </tr>
        <tr>
          <td style="padding:4px;color:#66ff66;font-size:11px;">G out</td>
          <td style="padding:3px;"><input id="mix-gr" type="number" value="0" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-gg" type="number" value="100" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-gb" type="number" value="0" style="${inputStyle}"></td>
        </tr>
        <tr>
          <td style="padding:4px;color:#6666ff;font-size:11px;">B out</td>
          <td style="padding:3px;"><input id="mix-br" type="number" value="0" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-bg" type="number" value="0" style="${inputStyle}"></td>
          <td style="padding:3px;"><input id="mix-bb" type="number" value="100" style="${inputStyle}"></td>
        </tr>
      </table>
      <div style="margin-bottom:12px;">
        <label style="font-size:11px;color:#8888aa;">
          <input type="radio" name="mix-mode" value="clip" checked style="accent-color:#4a90d9;"> Clip (clamp 0-255)
        </label>
        <label style="font-size:11px;color:#8888aa;margin-left:12px;">
          <input type="radio" name="mix-mode" value="normalize" style="accent-color:#4a90d9;"> Normalize
        </label>
      </div>
      <div style="margin-bottom:8px;">
        <span style="font-size:11px;color:#8888aa;">Presets: </span>
        <button class="mix-preset" data-preset="identity" style="font-size:10px;padding:2px 6px;cursor:pointer;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;">Identity</button>
        <button class="mix-preset" data-preset="grayscale" style="font-size:10px;padding:2px 6px;cursor:pointer;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;">Grayscale</button>
        <button class="mix-preset" data-preset="sepia" style="font-size:10px;padding:2px 6px;cursor:pointer;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;">Sepia</button>
        <button class="mix-preset" data-preset="swap-rb" style="font-size:10px;padding:2px 6px;cursor:pointer;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;">Swap R/B</button>
        <button class="mix-preset" data-preset="invert" style="font-size:10px;padding:2px 6px;cursor:pointer;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;">Invert</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="mix-preview" style="padding:4px 12px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;">Preview</button>
        <button id="mix-apply" style="padding:4px 16px;background:#4a90d9;color:#fff;border:none;border-radius:3px;cursor:pointer;">Apply</button>
        <button id="mix-cancel" style="padding:4px 16px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;cursor:pointer;">Cancel</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Preset data
    const presets = {
      identity:  [[100,0,0],[0,100,0],[0,0,100]],
      grayscale: [[30,59,11],[30,59,11],[30,59,11]],
      sepia:     [[39,77,19],[35,69,17],[27,53,13]],
      'swap-rb': [[0,0,100],[0,100,0],[100,0,0]],
      invert:    [[-100,0,0],[0,-100,0],[0,0,-100]],  // special: handled below
    };

    const getInputs = () => [
      [parseFloat(dialog.querySelector('#mix-rr').value) || 0,
       parseFloat(dialog.querySelector('#mix-rg').value) || 0,
       parseFloat(dialog.querySelector('#mix-rb').value) || 0],
      [parseFloat(dialog.querySelector('#mix-gr').value) || 0,
       parseFloat(dialog.querySelector('#mix-gg').value) || 0,
       parseFloat(dialog.querySelector('#mix-gb').value) || 0],
      [parseFloat(dialog.querySelector('#mix-br').value) || 0,
       parseFloat(dialog.querySelector('#mix-bg').value) || 0,
       parseFloat(dialog.querySelector('#mix-bb').value) || 0],
    ];

    const setInputs = (m) => {
      const ids = [['mix-rr','mix-rg','mix-rb'],['mix-gr','mix-gg','mix-gb'],['mix-br','mix-bg','mix-bb']];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          dialog.querySelector('#' + ids[r][c]).value = m[r][c];
    };

    // Preset buttons
    dialog.querySelectorAll('.mix-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = presets[btn.dataset.preset];
        if (p) setInputs(p);
      });
    });

    // Save original palette for preview/cancel
    const originalPalette = new Uint8Array(this.palette);

    const applyMix = () => {
      const matrix = getInputs();
      const normalize = dialog.querySelector('input[name="mix-mode"][value="normalize"]').checked;

      for (let i = 0; i < PALETTE_SIZE; i++) {
        const off = i * 3;
        const r = originalPalette[off];
        const g = originalPalette[off + 1];
        const b = originalPalette[off + 2];

        let nr = (matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b) / 100;
        let ng = (matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b) / 100;
        let nb = (matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b) / 100;

        // Handle "invert" preset: add 255 to negative results
        if (nr < 0) nr += 255;
        if (ng < 0) ng += 255;
        if (nb < 0) nb += 255;

        if (normalize) {
          const maxVal = Math.max(Math.abs(nr), Math.abs(ng), Math.abs(nb), 1);
          if (maxVal > 255) {
            const scale = 255 / maxVal;
            nr *= scale; ng *= scale; nb *= scale;
          }
        }

        this.palette[off]     = clampByte(nr);
        this.palette[off + 1] = clampByte(ng);
        this.palette[off + 2] = clampByte(nb);
      }
      this._markDirty();
    };

    dialog.querySelector('#mix-preview').addEventListener('click', applyMix);

    dialog.querySelector('#mix-apply').addEventListener('click', () => {
      applyMix();
      // Rebuild control points
      const cpCount = 8;
      this.controlPoints = [];
      for (let i = 0; i < cpCount; i++) {
        const idx = Math.round((i / (cpCount - 1)) * 255);
        const off = idx * 3;
        this.controlPoints.push({
          index: idx,
          color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
        });
      }
      document.body.removeChild(overlay);
    });

    dialog.querySelector('#mix-cancel').addEventListener('click', () => {
      // Restore original palette
      this.palette.set(originalPalette);
      this._markDirty();
      document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.palette.set(originalPalette);
        this._markDirty();
        document.body.removeChild(overlay);
      }
    });
  }

  // -----------------------------------------------------------------------
  //  Curves dialog  --  draw R/G/B (or H/S/B) curves to define a palette
  // -----------------------------------------------------------------------

  _onCurvesDialog() {
    const CW = 256, CH = 200;
    const originalPalette = new Uint8Array(this.palette);

    // Per-channel control points (identity curves)
    const curves = {
      r: [{x: 0, y: 0}, {x: 255, y: 255}],
      g: [{x: 0, y: 0}, {x: 255, y: 255}],
      b: [{x: 0, y: 0}, {x: 255, y: 255}],
    };
    let activeChannel = 'r';
    let colorSpace = 'rgb';

    // -- Overlay & dialog (same pattern as blend/mix) -----------------------

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;z-index:2000;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1e1e3a;border:1px solid #3a3a5a;border-radius:6px;' +
      'padding:16px;min-width:300px;color:#e0e0f0;font-size:13px;';

    const radioStyle = 'accent-color:#4a90d9;margin-right:2px;';
    const lblStyle = 'font-size:11px;color:#8888aa;margin-right:10px;cursor:pointer;';
    const btnBase = 'padding:4px 12px;border-radius:3px;cursor:pointer;font-size:12px;';

    dialog.innerHTML = `
      <h3 style="margin-bottom:10px;font-size:14px;">Curves</h3>
      <canvas id="curves-cv" width="${CW}" height="${CH}"
        style="background:#1a1a2e;border:1px solid #3a3a5a;display:block;margin-bottom:8px;cursor:crosshair;"></canvas>
      <div style="margin-bottom:6px;">
        <label style="${lblStyle}"><input type="radio" name="curves-ch" value="r" checked style="${radioStyle}">R</label>
        <label style="${lblStyle}"><input type="radio" name="curves-ch" value="g" style="${radioStyle}">G</label>
        <label style="${lblStyle}"><input type="radio" name="curves-ch" value="b" style="${radioStyle}">B</label>
        <label style="${lblStyle}"><input type="radio" name="curves-ch" value="all" style="${radioStyle}">All</label>
        <span style="margin-left:12px;font-size:11px;color:#8888aa;">Space:</span>
        <select id="curves-space" style="padding:2px 4px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:3px;font-size:11px;margin-left:4px;">
          <option value="rgb">RGB</option>
          <option value="hsb">HSB</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="curves-reset" style="${btnBase}background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;">Reset</button>
        <button id="curves-apply" style="${btnBase}background:#4a90d9;color:#fff;border:none;">Apply</button>
        <button id="curves-cancel" style="${btnBase}background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;">Cancel</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const cv  = dialog.querySelector('#curves-cv');
    const ctx = cv.getContext('2d');

    // -- Channel colors -----------------------------------------------------

    const channelColors = () => colorSpace === 'rgb'
      ? { r: '#ff4444', g: '#44ff44', b: '#4444ff' }
      : { r: '#ff44ff', g: '#44ffff', b: '#ffff44' };  // H=magenta S=cyan B=yellow

    const channelLabels = () => colorSpace === 'rgb'
      ? { r: 'R', g: 'G', b: 'B' }
      : { r: 'H', g: 'S', b: 'B' };

    // -- Catmull-Rom curve evaluation ---------------------------------------

    function evalCurve(pts, x) {
      if (pts.length === 0) return x;
      const sorted = pts.slice().sort((a, b) => a.x - b.x);
      if (x <= sorted[0].x) return sorted[0].y;
      if (x >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

      // find segment
      let idx = 0;
      for (let i = 0; i < sorted.length - 1; i++) {
        if (x >= sorted[i].x && x <= sorted[i + 1].x) { idx = i; break; }
      }
      const p1 = sorted[idx], p2 = sorted[idx + 1];
      const p0 = sorted[idx - 1] || { x: p1.x - (p2.x - p1.x), y: p1.y };
      const p3 = sorted[idx + 2] || { x: p2.x + (p2.x - p1.x), y: p2.y };

      const t = (p2.x - p1.x) > 0 ? (x - p1.x) / (p2.x - p1.x) : 0;
      return clamp(Math.round(catmullRom(p0.y, p1.y, p2.y, p3.y, t)), 0, 255);
    }

    // -- Canvas drawing -----------------------------------------------------

    const drawCanvas = () => {
      ctx.clearRect(0, 0, CW, CH);
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, CW, CH);

      // Grid (4x4 = lines at 25%, 50%, 75%)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let frac of [0.25, 0.5, 0.75]) {
        const gx = Math.round(frac * CW);
        const gy = Math.round(frac * CH);
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, CH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CW, gy); ctx.stroke();
      }

      // Identity diagonal
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.moveTo(0, CH); ctx.lineTo(CW, 0); ctx.stroke();

      // Draw each channel curve
      const colors = channelColors();
      const keys = ['r', 'g', 'b'];
      // Draw inactive curves first, active last
      const order = keys.filter(k => k !== activeChannel);
      if (activeChannel !== 'all') order.push(activeChannel);
      else order.push(...keys.filter(k => !order.includes(k)));

      for (const key of order) {
        const isActive = key === activeChannel || activeChannel === 'all';
        ctx.strokeStyle = isActive ? colors[key] : colors[key] + '80';
        ctx.lineWidth = isActive ? 2.5 : 1;
        ctx.beginPath();
        for (let px = 0; px < CW; px++) {
          const val = evalCurve(curves[key], px);
          const cy = CH - (val / 255) * CH;
          if (px === 0) ctx.moveTo(px, cy); else ctx.lineTo(px, cy);
        }
        ctx.stroke();

        // Control points for active channel(s)
        if (isActive) {
          for (const pt of curves[key]) {
            const sx = pt.x;
            const sy = CH - (pt.y / 255) * CH;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = colors[key];
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    };

    drawCanvas();

    // -- Interaction: drag, add, remove points ------------------------------

    let dragging = null;   // { channel, index }
    const HIT_RADIUS = 10;

    const canvasPos = (e) => {
      const r = cv.getBoundingClientRect();
      return {
        x: clamp(Math.round((e.clientX - r.left) / r.width * CW), 0, 255),
        y: clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 255), 0, 255),
      };
    };

    const findNearestPoint = (mx, my) => {
      const targets = activeChannel === 'all' ? ['r', 'g', 'b'] : [activeChannel];
      let best = null, bestDist = HIT_RADIUS + 1;
      for (const ch of targets) {
        for (let i = 0; i < curves[ch].length; i++) {
          const pt = curves[ch][i];
          const dx = pt.x - mx;
          const dy = (pt.y - my) * (CW / CH);
          const d = Math.hypot(dx, dy);
          if (d < bestDist) { bestDist = d; best = { channel: ch, index: i }; }
        }
      }
      return best;
    };

    cv.addEventListener('mousedown', (e) => {
      const pos = canvasPos(e);

      if (e.button === 2) {
        // Right-click: remove nearest point (keep at least 2)
        e.preventDefault();
        const hit = findNearestPoint(pos.x, pos.y);
        if (hit && curves[hit.channel].length > 2) {
          curves[hit.channel].splice(hit.index, 1);
          drawCanvas();
        }
        return;
      }

      // Left-click: try to grab existing point, else add new
      const hit = findNearestPoint(pos.x, pos.y);
      if (hit) {
        dragging = hit;
      } else {
        const targets = activeChannel === 'all' ? ['r', 'g', 'b'] : [activeChannel];
        for (const ch of targets) {
          curves[ch].push({ x: pos.x, y: pos.y });
          curves[ch].sort((a, b) => a.x - b.x);
        }
        // Set dragging to the newly added point in the first target channel
        const ch0 = targets[0];
        const ni = curves[ch0].findIndex(p => p.x === pos.x && p.y === pos.y);
        dragging = { channel: ch0, index: ni };
        drawCanvas();
      }
    });

    cv.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const pos = canvasPos(e);
      const pt = curves[dragging.channel][dragging.index];
      if (pt) {
        pt.x = pos.x;
        pt.y = pos.y;
        // If "All" mode, move matching point in other channels too
        if (activeChannel === 'all') {
          for (const ch of ['r', 'g', 'b']) {
            if (ch === dragging.channel) continue;
            const mp = curves[ch][dragging.index];
            if (mp) { mp.x = pos.x; mp.y = pos.y; }
          }
        }
      }
      drawCanvas();
    });

    cv.addEventListener('mouseup', () => { dragging = null; });
    cv.addEventListener('mouseleave', () => { dragging = null; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());

    // -- Channel radio buttons ----------------------------------------------

    dialog.querySelectorAll('input[name="curves-ch"]').forEach(radio => {
      radio.addEventListener('change', () => {
        activeChannel = radio.value;
        drawCanvas();
      });
    });

    // -- Space dropdown -----------------------------------------------------

    dialog.querySelector('#curves-space').addEventListener('change', (e) => {
      colorSpace = e.target.value;
      // Reset curves when switching space
      for (const ch of ['r', 'g', 'b']) {
        curves[ch] = [{x: 0, y: 0}, {x: 255, y: 255}];
      }
      drawCanvas();
    });

    // -- Reset --------------------------------------------------------------

    dialog.querySelector('#curves-reset').addEventListener('click', () => {
      for (const ch of ['r', 'g', 'b']) {
        curves[ch] = [{x: 0, y: 0}, {x: 255, y: 255}];
      }
      drawCanvas();
    });

    // -- Apply --------------------------------------------------------------

    dialog.querySelector('#curves-apply').addEventListener('click', () => {
      if (colorSpace === 'rgb') {
        for (let i = 0; i < PALETTE_SIZE; i++) {
          const off = i * 3;
          this.palette[off]     = clampByte(evalCurve(curves.r, i));
          this.palette[off + 1] = clampByte(evalCurve(curves.g, i));
          this.palette[off + 2] = clampByte(evalCurve(curves.b, i));
        }
      } else {
        // HSB mode: curves.r=H, curves.g=S, curves.b=B
        for (let i = 0; i < PALETTE_SIZE; i++) {
          const h = evalCurve(curves.r, i) / 255 * 360;
          const s = evalCurve(curves.g, i) / 255 * 100;
          const bv = evalCurve(curves.b, i) / 255 * 100;
          const rgb = this.engine.convert([h, s, bv], 'hsb', 'srgb');
          const off = i * 3;
          this.palette[off]     = clampByte(rgb[0]);
          this.palette[off + 1] = clampByte(rgb[1]);
          this.palette[off + 2] = clampByte(rgb[2]);
        }
      }
      // Rebuild control points
      const cpCount = 8;
      this.controlPoints = [];
      for (let i = 0; i < cpCount; i++) {
        const idx = Math.round((i / (cpCount - 1)) * 255);
        const off = idx * 3;
        this.controlPoints.push({
          index: idx,
          color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
        });
      }
      this._markDirty();
      document.body.removeChild(overlay);
    });

    // -- Cancel -------------------------------------------------------------

    dialog.querySelector('#curves-cancel').addEventListener('click', () => {
      this.palette.set(originalPalette);
      this._markDirty();
      document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.palette.set(originalPalette);
        this._markDirty();
        document.body.removeChild(overlay);
      }
    });
  }

  // -----------------------------------------------------------------------
  //  Palette adjustment helpers
  // -----------------------------------------------------------------------

  /**
   * Shift the hue of every palette entry by a given number of degrees.
   * Operates in HSB space.
   * @param {number} degrees  Hue shift in degrees (can be negative)
   */
  shiftHue(degrees) {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      const r = this.palette[off];
      const g = this.palette[off + 1];
      const b = this.palette[off + 2];

      const hsb = this.engine.convert([r, g, b], 'srgb', 'hsb');
      hsb[0] = ((hsb[0] + degrees) % 360 + 360) % 360;
      const rgb = this.engine.convert(hsb, 'hsb', 'srgb');

      this.palette[off]     = clampByte(rgb[0]);
      this.palette[off + 1] = clampByte(rgb[1]);
      this.palette[off + 2] = clampByte(rgb[2]);
    }

    // Also shift control point colors
    for (const cp of this.controlPoints) {
      const hsb = this.engine.convert(cp.color, 'srgb', 'hsb');
      hsb[0] = ((hsb[0] + degrees) % 360 + 360) % 360;
      const rgb = this.engine.convert(hsb, 'hsb', 'srgb');
      cp.color = [clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2])];
    }

    this._markDirty();
  }

  /**
   * Adjust brightness of every palette entry.
   * @param {number} amount  Brightness adjustment (-100 to +100)
   */
  /**
   * Adjust saturation of every palette entry.
   * @param {number} amount  Saturation change (-100 to +100)
   */
  adjustSaturation(amount) {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      const r = this.palette[off];
      const g = this.palette[off + 1];
      const b = this.palette[off + 2];

      const hsb = this.engine.convert([r, g, b], 'srgb', 'hsb');
      hsb[1] = clamp(hsb[1] + amount, 0, 100);
      const rgb = this.engine.convert(hsb, 'hsb', 'srgb');

      this.palette[off]     = clampByte(rgb[0]);
      this.palette[off + 1] = clampByte(rgb[1]);
      this.palette[off + 2] = clampByte(rgb[2]);
    }

    for (const cp of this.controlPoints) {
      const hsb = this.engine.convert(cp.color, 'srgb', 'hsb');
      hsb[1] = clamp(hsb[1] + amount, 0, 100);
      const rgb = this.engine.convert(hsb, 'hsb', 'srgb');
      cp.color = [clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2])];
    }

    this._markDirty();
  }

  adjustBrightness(amount) {
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const off = i * 3;
      const r = this.palette[off];
      const g = this.palette[off + 1];
      const b = this.palette[off + 2];

      const lab = this.engine.convert([r, g, b], 'srgb', 'lab');
      lab[0] = clamp(lab[0] + amount, 0, 100);
      const rgb = this.engine.convert(lab, 'lab', 'srgb');

      this.palette[off]     = clampByte(rgb[0]);
      this.palette[off + 1] = clampByte(rgb[1]);
      this.palette[off + 2] = clampByte(rgb[2]);
    }

    // Adjust control point colors too
    for (const cp of this.controlPoints) {
      const lab = this.engine.convert(cp.color, 'srgb', 'lab');
      lab[0] = clamp(lab[0] + amount, 0, 100);
      const rgb = this.engine.convert(lab, 'lab', 'srgb');
      cp.color = [clampByte(rgb[0]), clampByte(rgb[1]), clampByte(rgb[2])];
    }

    this._markDirty();
  }

  /**
   * Reverse the order of the entire palette.
   */
  reverse() {
    // Reverse the palette array in-place (swap triplets)
    for (let i = 0; i < PALETTE_SIZE / 2; i++) {
      const j = PALETTE_SIZE - 1 - i;
      const offI = i * 3;
      const offJ = j * 3;
      for (let c = 0; c < 3; c++) {
        const tmp = this.palette[offI + c];
        this.palette[offI + c] = this.palette[offJ + c];
        this.palette[offJ + c] = tmp;
      }
    }

    // Reverse control point indices
    for (const cp of this.controlPoints) {
      cp.index = 255 - cp.index;
    }

    this._markDirty();
  }

  /**
   * Smooth the palette by averaging neighboring colors.
   * @param {number} passes  Number of smoothing passes (default 1)
   */
  smooth(passes = 1) {
    const tmp = new Uint8Array(PALETTE_BYTES);

    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        const prev = Math.max(0, i - 1);
        const next = Math.min(PALETTE_SIZE - 1, i + 1);
        const offP = prev * 3;
        const offC = i * 3;
        const offN = next * 3;

        for (let c = 0; c < 3; c++) {
          tmp[offC + c] = clampByte(
            (this.palette[offP + c] + this.palette[offC + c] * 2 + this.palette[offN + c]) / 4
          );
        }
      }
      this.palette.set(tmp);
    }

    // Update control point colors to match their palette positions
    for (const cp of this.controlPoints) {
      const off = cp.index * 3;
      cp.color = [this.palette[off], this.palette[off + 1], this.palette[off + 2]];
    }

    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Public accessors
  // -----------------------------------------------------------------------

  /**
   * Get the RGB color at a given palette index, accounting for rotation.
   * @param {number} index  Palette index 0-255
   * @returns {[number, number, number]}  RGB values
   */
  getColor(index) {
    const actual = (index + this.rotation) % PALETTE_SIZE;
    const off = actual * 3;
    return [this.palette[off], this.palette[off + 1], this.palette[off + 2]];
  }

  /**
   * Get the full rotated palette as an array of [r,g,b] arrays.
   * @returns {Array<[number, number, number]>}
   */
  getRotatedPalette() {
    const result = new Array(PALETTE_SIZE);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      result[i] = this.getColor(i);
    }
    return result;
  }

  /**
   * Set the palette from an external array of 256 RGB triplets.
   * @param {Array<[number,number,number]>} colors  256 RGB colors
   */
  setPalette(colors) {
    for (let i = 0; i < PALETTE_SIZE && i < colors.length; i++) {
      const off = i * 3;
      this.palette[off]     = clampByte(colors[i][0]);
      this.palette[off + 1] = clampByte(colors[i][1]);
      this.palette[off + 2] = clampByte(colors[i][2]);
    }

    // Rebuild control points at regular intervals
    const cpCount = 8;
    this.controlPoints = [];
    for (let i = 0; i < cpCount; i++) {
      const idx = Math.round((i / (cpCount - 1)) * 255);
      const off = idx * 3;
      this.controlPoints.push({
        index: idx,
        color: [this.palette[off], this.palette[off + 1], this.palette[off + 2]],
      });
    }

    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Cut / Copy / Paste palette sections
  // -----------------------------------------------------------------------

  /** Internal clipboard for palette sections */
  _clipboardSection = null;

  /**
   * Copy a range of palette entries to the internal clipboard.
   * @param {number} startIdx  First palette index (0-255)
   * @param {number} endIdx    Last palette index (inclusive)
   */
  copySection(startIdx, endIdx) {
    const lo = Math.max(0, Math.min(startIdx, endIdx));
    const hi = Math.min(255, Math.max(startIdx, endIdx));
    const len = hi - lo + 1;
    const section = new Uint8Array(len * 3);
    section.set(this.palette.subarray(lo * 3, (hi + 1) * 3));
    this._clipboardSection = { data: section, length: len };
  }

  /**
   * Cut a range — copies it to clipboard then fills the range with black.
   */
  cutSection(startIdx, endIdx) {
    this.copySection(startIdx, endIdx);
    const lo = Math.max(0, Math.min(startIdx, endIdx));
    const hi = Math.min(255, Math.max(startIdx, endIdx));
    this.palette.fill(0, lo * 3, (hi + 1) * 3);
    this._markDirty();
  }

  /**
   * Paste the clipboard section at a given index, stretching or compressing
   * to fit the destination range.
   * @param {number} destStart  Destination start index
   * @param {number} destEnd    Destination end index (inclusive). If different
   *                            length than the clipboard, the section is resampled.
   */
  pasteSection(destStart, destEnd) {
    if (!this._clipboardSection) return;
    const src = this._clipboardSection;
    const lo = Math.max(0, Math.min(destStart, destEnd));
    const hi = Math.min(255, Math.max(destStart, destEnd));
    const destLen = hi - lo + 1;

    for (let i = 0; i < destLen; i++) {
      // Resample: map destination index to source index
      const srcFrac = (i / (destLen - 1 || 1)) * (src.length - 1);
      const srcIdx = Math.round(srcFrac);
      const sOff = Math.min(srcIdx, src.length - 1) * 3;
      const dOff = (lo + i) * 3;
      this.palette[dOff]     = src.data[sOff];
      this.palette[dOff + 1] = src.data[sOff + 1];
      this.palette[dOff + 2] = src.data[sOff + 2];
    }
    this._markDirty();
  }

  // -----------------------------------------------------------------------
  //  Different spline interpolation modes
  // -----------------------------------------------------------------------

  /** Current interpolation mode: 'catmull-rom' | 'linear' | 'bezier' */
  _splineMode = 'catmull-rom';

  /**
   * Set the spline interpolation mode and reinterpolate.
   * @param {'catmull-rom' | 'linear' | 'bezier'} mode
   */
  setSplineMode(mode) {
    if (['catmull-rom', 'linear', 'bezier'].includes(mode)) {
      this._splineMode = mode;
      this._interpolatePalette();
      this._markDirty();
    }
  }

  /**
   * Clean up resources (cancel animation frame, remove listeners).
   */
  dispose() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._animTimer) {
      clearInterval(this._animTimer);
      this._animTimer = null;
    }
  }
}
