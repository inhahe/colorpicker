/**
 * ui-info.js  --  Info panel, accuracy meters, and chromaticity diagrams
 *
 * ES module.  Provides:
 *   - InfoPanel           Educational info about the selected color space
 *   - AccuracyMeters      Delta-E and per-component accuracy displays
 *   - ConeResponseChart   Mini L/M/S cone fundamental curves
 *   - ChromaticityDiagram  CIE 1931 xy chromaticity horseshoe
 */

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

// ---------------------------------------------------------------------------
//  Spectral locus data  (CIE 1931 xy, 380-700 nm, ~5 nm steps)
// ---------------------------------------------------------------------------

const SPECTRAL_LOCUS = [
  [380, 0.1741, 0.0050],
  [385, 0.1740, 0.0050],
  [390, 0.1738, 0.0049],
  [395, 0.1736, 0.0049],
  [400, 0.1733, 0.0048],
  [405, 0.1730, 0.0048],
  [410, 0.1726, 0.0048],
  [415, 0.1721, 0.0048],
  [420, 0.1714, 0.0051],
  [425, 0.1703, 0.0058],
  [430, 0.1689, 0.0069],
  [435, 0.1669, 0.0086],
  [440, 0.1644, 0.0109],
  [445, 0.1611, 0.0138],
  [450, 0.1566, 0.0177],
  [455, 0.1510, 0.0227],
  [460, 0.1440, 0.0297],
  [465, 0.1355, 0.0399],
  [470, 0.1241, 0.0578],
  [475, 0.1096, 0.0868],
  [480, 0.0913, 0.1327],
  [485, 0.0687, 0.2007],
  [490, 0.0454, 0.2950],
  [495, 0.0235, 0.4127],
  [500, 0.0082, 0.5384],
  [505, 0.0039, 0.6548],
  [510, 0.0139, 0.7502],
  [515, 0.0389, 0.8120],
  [520, 0.0743, 0.8338],
  [525, 0.1142, 0.8562],
  [530, 0.1547, 0.8689],
  [535, 0.1929, 0.8724],
  [540, 0.2296, 0.8706],
  [545, 0.2658, 0.8620],
  [550, 0.3016, 0.8495],
  [555, 0.3373, 0.8326],
  [560, 0.3731, 0.8130],
  [565, 0.4087, 0.7927],
  [570, 0.4441, 0.7693],
  [575, 0.4788, 0.7438],
  [580, 0.5125, 0.7178],
  [585, 0.5448, 0.6896],
  [590, 0.5752, 0.6607],
  [595, 0.6029, 0.6310],
  [600, 0.6270, 0.6023],
  [605, 0.6482, 0.5736],
  [610, 0.6658, 0.5431],
  [615, 0.6801, 0.5163],
  [620, 0.6915, 0.4886],
  [625, 0.7006, 0.4625],
  [630, 0.7079, 0.4359],
  [635, 0.7140, 0.4091],
  [640, 0.7190, 0.3814],
  [645, 0.7230, 0.3530],
  [650, 0.7260, 0.3240],
  [655, 0.7283, 0.2971],
  [660, 0.7300, 0.2700],
  [665, 0.7311, 0.2690],
  [670, 0.7320, 0.2680],
  [675, 0.7327, 0.2672],
  [680, 0.7334, 0.2664],
  [685, 0.7340, 0.2659],
  [690, 0.7344, 0.2656],
  [695, 0.7346, 0.2654],
  [700, 0.7347, 0.2653],
];

// ---------------------------------------------------------------------------
//  Known gamut triangles and white points (CIE xy)
// ---------------------------------------------------------------------------

const GAMUT_SRGB = {
  r: [0.64, 0.33],
  g: [0.30, 0.60],
  b: [0.15, 0.06],
};

const GAMUT_ADOBERGB = {
  r: [0.64, 0.33],
  g: [0.21, 0.71],
  b: [0.15, 0.06],
};

const WHITE_D65 = [0.3127, 0.3290];
const WHITE_D50 = [0.3457, 0.3585];

const GAMUTS_BY_SPACE = {
  srgb:     GAMUT_SRGB,
  adobergb: GAMUT_ADOBERGB,
  hsb:      GAMUT_SRGB,
  hsl:      GAMUT_SRGB,
  cmy:      GAMUT_SRGB,
};

// ---------------------------------------------------------------------------
//  Geometry helpers
// ---------------------------------------------------------------------------

/** Is point (px, py) inside the triangle defined by three vertices? */
function pointInTriangle(px, py, v0, v1, v2) {
  const d00 = (v1[0] - v0[0]) * (v1[0] - v0[0]) + (v1[1] - v0[1]) * (v1[1] - v0[1]);
  const d01 = (v1[0] - v0[0]) * (v2[0] - v0[0]) + (v1[1] - v0[1]) * (v2[1] - v0[1]);
  const d11 = (v2[0] - v0[0]) * (v2[0] - v0[0]) + (v2[1] - v0[1]) * (v2[1] - v0[1]);
  const d20 = (px - v0[0]) * (v1[0] - v0[0]) + (py - v0[1]) * (v1[1] - v0[1]);
  const d21 = (px - v0[0]) * (v2[0] - v0[0]) + (py - v0[1]) * (v2[1] - v0[1]);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return false;
  const u = (d11 * d20 - d01 * d21) / denom;
  const v = (d00 * d21 - d01 * d20) / denom;
  return u >= 0 && v >= 0 && (u + v) <= 1;
}

/** Is point (px, py) inside the spectral-locus polygon? */
function pointInLocus(px, py) {
  const poly = SPECTRAL_LOCUS.map(p => [p[1], p[2]]);
  // Close via the purple line
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Convert CIE xy + Y=0.5 to approximate sRGB [0-255]. Returns null if outside sRGB. */
function xyToSrgbApprox(cx, cy) {
  if (cy < 1e-6) return null;
  const Y = 0.4;
  const X = (cx / cy) * Y;
  const Z = ((1 - cx - cy) / cy) * Y;
  // XYZ -> linear sRGB
  const M = [
    [ 3.2404542, -1.5371385, -0.4985314],
    [-0.9692660,  1.8760108,  0.0415560],
    [ 0.0556434, -0.2040259,  1.0572252],
  ];
  const rl = M[0][0] * X + M[0][1] * Y + M[0][2] * Z;
  const gl = M[1][0] * X + M[1][1] * Y + M[1][2] * Z;
  const bl = M[2][0] * X + M[2][1] * Y + M[2][2] * Z;
  const inGamut = rl >= -0.001 && gl >= -0.001 && bl >= -0.001 &&
                  rl <= 1.001 && gl <= 1.001 && bl <= 1.001;
  // Gamma-correct
  const gamma = v => {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  };
  let r = gamma(rl) * 255;
  let g = gamma(gl) * 255;
  let b = gamma(bl) * 255;
  if (!inGamut) {
    // Desaturate: blend toward gray
    const gray = 0.35 * 255;
    r = gray + (r - gray) * 0.25;
    g = gray + (g - gray) * 0.25;
    b = gray + (b - gray) * 0.25;
  }
  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b))),
  ];
}

// ---------------------------------------------------------------------------
//  ChromaticityDiagram
// ---------------------------------------------------------------------------

export class ChromaticityDiagram {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;
  /** @type {ColorEngine} */
  #engine;
  /** Cached background ImageData (the horseshoe fill). */
  #bgCache = null;

  // Mapping: xy -> pixel coordinates
  // We map x: [0, 0.8] -> [25, 195],  y: [0, 0.9] -> [195, 5]
  #xMin = 0;    #xMax = 0.8;
  #yMin = 0;    #yMax = 0.9;
  #padL = 25;   #padR = 5;
  #padT = 5;    #padB = 5;

  /**
   * @param {HTMLCanvasElement} canvasEl
   * @param {ColorEngine} engine
   */
  constructor(canvasEl, engine) {
    this.#canvas = canvasEl;
    this.#ctx = canvasEl.getContext('2d');
    this.#engine = engine;
    this.#canvas.width = 200;
    this.#canvas.height = 200;
  }

  /** Map CIE x to pixel x. */
  #toPixelX(x) {
    const w = this.#canvas.width - this.#padL - this.#padR;
    return this.#padL + ((x - this.#xMin) / (this.#xMax - this.#xMin)) * w;
  }

  /** Map CIE y to pixel y (inverted -- higher y is higher on screen). */
  #toPixelY(y) {
    const h = this.#canvas.height - this.#padT - this.#padB;
    return this.#padT + h - ((y - this.#yMin) / (this.#yMax - this.#yMin)) * h;
  }

  /** Map pixel x back to CIE x. */
  #fromPixelX(px) {
    const w = this.#canvas.width - this.#padL - this.#padR;
    return this.#xMin + ((px - this.#padL) / w) * (this.#xMax - this.#xMin);
  }

  /** Map pixel y back to CIE y. */
  #fromPixelY(py) {
    const h = this.#canvas.height - this.#padT - this.#padB;
    return this.#yMin + ((this.#padT + h - py) / h) * (this.#yMax - this.#yMin);
  }

  /** Build the horseshoe background into a cached ImageData. */
  #buildBackground() {
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const imgData = this.#ctx.createImageData(w, h);
    const data = imgData.data;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const cx = this.#fromPixelX(px);
        const cy = this.#fromPixelY(py);
        const idx = (py * w + px) * 4;

        if (pointInLocus(cx, cy)) {
          const rgb = xyToSrgbApprox(cx, cy);
          if (rgb) {
            data[idx]     = rgb[0];
            data[idx + 1] = rgb[1];
            data[idx + 2] = rgb[2];
            data[idx + 3] = 255;
          } else {
            data[idx] = data[idx + 1] = data[idx + 2] = 30;
            data[idx + 3] = 255;
          }
        } else {
          // Outside locus: dark background
          data[idx] = data[idx + 1] = data[idx + 2] = 18;
          data[idx + 3] = 255;
        }
      }
    }
    this.#bgCache = imgData;
  }

  /** Draw the spectral locus outline. */
  #drawLocusOutline() {
    const ctx = this.#ctx;
    ctx.beginPath();
    for (let i = 0; i < SPECTRAL_LOCUS.length; i++) {
      const [, x, y] = SPECTRAL_LOCUS[i];
      const px = this.#toPixelX(x);
      const py = this.#toPixelY(y);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Draw axis labels and ticks. */
  #drawAxes() {
    const ctx = this.#ctx;
    ctx.fillStyle = 'rgba(200,200,200,0.6)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // x-axis ticks
    for (let v = 0; v <= 0.8; v += 0.2) {
      const px = this.#toPixelX(v);
      ctx.fillText(v.toFixed(1), px, this.#canvas.height - 4);
    }

    // y-axis ticks
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= 0.8; v += 0.2) {
      const py = this.#toPixelY(v);
      ctx.fillText(v.toFixed(1), this.#padL - 3, py);
    }

    // Labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('x', this.#canvas.width / 2, this.#canvas.height - 14);
    ctx.save();
    ctx.translate(8, this.#canvas.height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('y', 0, 0);
    ctx.restore();
  }

  /**
   * Full render of the diagram.
   * @param {[number,number]|null} currentXY  Current color's chromaticity [x,y] or null
   * @param {{r:[number,number], g:[number,number], b:[number,number]}|null} gamutVertices
   */
  render(currentXY = null, gamutVertices = null) {
    if (!this.#bgCache) this.#buildBackground();

    this.#ctx.putImageData(this.#bgCache, 0, 0);
    this.#drawLocusOutline();
    this.#drawAxes();

    // Always draw sRGB gamut in white
    this.drawGamut(GAMUT_SRGB, 'rgba(255,255,255,0.7)', 1);

    // Draw requested gamut if provided and different from sRGB
    if (gamutVertices && gamutVertices !== GAMUT_SRGB) {
      this.drawGamut(gamutVertices, 'rgba(0,200,255,0.8)', 1.5);
    }

    // Mark white point
    this.markPoint(WHITE_D65[0], WHITE_D65[1], 'rgba(255,255,255,0.8)', null);

    // Mark current color
    if (currentXY) {
      this.markPoint(currentXY[0], currentXY[1], '#ff3333', null);
    }
  }

  /**
   * Draw a gamut triangle.
   * @param {{r:[number,number], g:[number,number], b:[number,number]}} vertices
   * @param {string} color  CSS color
   * @param {number} lineWidth
   */
  drawGamut(vertices, color, lineWidth) {
    const ctx = this.#ctx;
    ctx.beginPath();
    ctx.moveTo(this.#toPixelX(vertices.r[0]), this.#toPixelY(vertices.r[1]));
    ctx.lineTo(this.#toPixelX(vertices.g[0]), this.#toPixelY(vertices.g[1]));
    ctx.lineTo(this.#toPixelX(vertices.b[0]), this.#toPixelY(vertices.b[1]));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  /**
   * Mark a single point on the diagram.
   * @param {number} x  CIE x
   * @param {number} y  CIE y
   * @param {string} color  CSS color
   * @param {string|null} label  Optional text label
   */
  markPoint(x, y, color, label) {
    const ctx = this.#ctx;
    const px = this.#toPixelX(x);
    const py = this.#toPixelY(y);

    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (label) {
      ctx.fillStyle = color;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, px + 5, py - 3);
    }
  }
}

// ---------------------------------------------------------------------------
//  ConeResponseChart
// ---------------------------------------------------------------------------

export class ConeResponseChart {
  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;
  /** @type {ColorEngine} */
  #engine;

  /**
   * @param {HTMLCanvasElement} canvasEl
   * @param {ColorEngine} engine
   */
  constructor(canvasEl, engine) {
    this.#canvas = canvasEl;
    this.#ctx = canvasEl.getContext('2d');
    this.#engine = engine;
    this.#canvas.width = 250;
    this.#canvas.height = 150;
  }

  render() {
    const ctx = this.#ctx;
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const pad = { l: 35, r: 10, t: 10, b: 25 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const data = this.#engine.getConeFundamentals();
    const wlMin = data.wavelengths[0];
    const wlMax = data.wavelengths[data.wavelengths.length - 1];

    // Clear to dark background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let yv = 0; yv <= 1; yv += 0.25) {
      const py = pad.t + plotH - yv * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.l, py);
      ctx.lineTo(pad.l + plotW, py);
      ctx.stroke();
    }
    for (let wl = 400; wl <= 800; wl += 100) {
      const px = pad.l + ((wl - wlMin) / (wlMax - wlMin)) * plotW;
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, pad.t + plotH);
      ctx.stroke();
    }

    // Helper to map wavelength index -> pixel coords
    const toPixel = (i, val) => {
      const px = pad.l + ((data.wavelengths[i] - wlMin) / (wlMax - wlMin)) * plotW;
      const py = pad.t + plotH - val * plotH;
      return [px, py];
    };

    // Draw curves
    const curves = [
      { vals: data.L, color: 'rgba(220, 60, 60, 0.85)' },
      { vals: data.M, color: 'rgba(60, 180, 60, 0.85)' },
      { vals: data.S, color: 'rgba(60, 80, 220, 0.85)' },
    ];

    for (const curve of curves) {
      ctx.beginPath();
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < curve.vals.length; i++) {
        const [px, py] = toPixel(i, Math.min(1, curve.vals[i]));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = 'rgba(200,200,200,0.7)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let wl = 400; wl <= 800; wl += 100) {
      const px = pad.l + ((wl - wlMin) / (wlMax - wlMin)) * plotW;
      ctx.fillText(`${wl}`, px, pad.t + plotH + 4);
    }
    ctx.fillText('Wavelength (nm)', pad.l + plotW / 2, pad.t + plotH + 14);

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let yv = 0; yv <= 1; yv += 0.5) {
      const py = pad.t + plotH - yv * plotH;
      ctx.fillText(yv.toFixed(1), pad.l - 4, py);
    }

    // Legend
    const legends = [
      { label: 'L', color: 'rgba(220, 60, 60, 0.85)' },
      { label: 'M', color: 'rgba(60, 180, 60, 0.85)' },
      { label: 'S', color: 'rgba(60, 80, 220, 0.85)' },
    ];
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < legends.length; i++) {
      const lx = pad.l + plotW - 40;
      const ly = pad.t + 4 + i * 13;
      ctx.fillStyle = legends[i].color;
      ctx.fillRect(lx, ly + 2, 8, 8);
      ctx.fillStyle = 'rgba(200,200,200,0.8)';
      ctx.fillText(legends[i].label, lx + 12, ly);
    }
  }
}

// ---------------------------------------------------------------------------
//  InfoPanel
// ---------------------------------------------------------------------------

export class InfoPanel {
  /** @type {{descriptionEl: HTMLElement, equationsEl: HTMLElement, gamutEl: HTMLElement, spaceSelect: HTMLSelectElement}} */
  #els;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;
  /** @type {ChromaticityDiagram|null} */
  #diagram = null;
  /** @type {HTMLCanvasElement|null} */
  #diagramCanvas = null;

  /**
   * @param {{descriptionEl: HTMLElement, equationsEl: HTMLElement, gamutEl: HTMLElement, spaceSelect: HTMLSelectElement}} elements
   * @param {AppState} state
   * @param {ColorEngine} engine
   */
  constructor(elements, state, engine) {
    this.#els = elements;
    this.#state = state;
    this.#engine = engine;

    this.#populateSelect();

    // Sync select from state
    const initial = this.#state.get('infoPanel.selectedSpace') || 'srgb';
    this.#els.spaceSelect.value = initial;

    // Listen for user selection changes
    this.#els.spaceSelect.addEventListener('change', () => {
      this.#state.set('infoPanel.selectedSpace', this.#els.spaceSelect.value);
      this.render();
    });

    // Listen for state-driven changes (e.g. from other UI)
    this.#state.subscribe('infoPanel.selectedSpace', (newVal) => {
      if (this.#els.spaceSelect.value !== newVal) {
        this.#els.spaceSelect.value = newVal;
      }
      this.render();
    });

    // Also re-render when currentColor changes (for the chromaticity point)
    this.#state.subscribe('currentColor', () => {
      this.render();
    });
  }

  /** Populate the space-select dropdown with all known spaces. */
  #populateSelect() {
    this.#els.spaceSelect.innerHTML = '';
    for (const [id, space] of this.#engine.spaces) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = space.name;
      this.#els.spaceSelect.appendChild(opt);
    }
  }

  /** Render the info panel for the currently selected space. */
  render() {
    const spaceId = this.#els.spaceSelect.value || 'srgb';
    const space = this.#engine.spaces.get(spaceId);
    if (!space) return;

    // --- Description ---
    this.#els.descriptionEl.textContent = space.meta.description || '';

    // --- Equations ---
    this.#renderEquations(space);

    // --- Gamut info ---
    this.#renderGamut(space, spaceId);
  }

  #renderEquations(space) {
    const el = this.#els.equationsEl;
    el.innerHTML = '';

    if (!space.meta.equations || space.meta.equations.length === 0) {
      el.textContent = 'No conversion equations available.';
      return;
    }

    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:0; padding:8px; font-family:monospace; font-size:12px; ' +
      'background:rgba(0,0,0,0.3); border-radius:4px; overflow-x:auto; white-space:pre-wrap; ' +
      'color:#ccc; line-height:1.6;';
    pre.textContent = space.meta.equations.join('\n');
    el.appendChild(pre);
  }

  #renderGamut(space, spaceId) {
    const el = this.#els.gamutEl;
    el.innerHTML = '';

    // Coverage line
    const coverageP = document.createElement('p');
    coverageP.style.cssText = 'margin:0 0 6px 0; font-size:13px;';
    coverageP.innerHTML = `<strong>Coverage:</strong> ${space.meta.gamutCoverageDesc || 'N/A'}`;
    el.appendChild(coverageP);

    // Uniformity
    const uniformityP = document.createElement('p');
    uniformityP.style.cssText = 'margin:0 0 6px 0; font-size:13px;';
    const uLabel = space.meta.uniformity || 'unknown';
    const uExplain = {
      poor: 'Equal numeric steps do not produce equally perceived color differences.',
      moderate: 'Reasonably uniform; small steps are roughly equal in perception, but not perfect.',
      good: 'Very close to perceptual uniformity across the space.',
    };
    uniformityP.innerHTML = `<strong>Uniformity:</strong> ${uLabel} &mdash; ${uExplain[uLabel] || ''}`;
    el.appendChild(uniformityP);

    // Absolute vs device-dependent
    const absP = document.createElement('p');
    absP.style.cssText = 'margin:0 0 8px 0; font-size:13px;';
    absP.innerHTML = `<strong>Type:</strong> ${space.meta.absolute ? 'Absolute (device-independent)' : 'Device-dependent'}`;
    el.appendChild(absP);

    // Component details
    const compHeader = document.createElement('p');
    compHeader.style.cssText = 'margin:0 0 4px 0; font-size:13px; font-weight:bold;';
    compHeader.textContent = 'Components:';
    el.appendChild(compHeader);

    const compList = document.createElement('ul');
    compList.style.cssText = 'margin:0 0 8px 0; padding-left:18px; font-size:12px; line-height:1.5;';
    for (const comp of space.components) {
      const li = document.createElement('li');
      li.textContent = `${comp.name} (${comp.id}): range [${comp.range[0]}, ${comp.range[1]}], step ${comp.step}`;
      compList.appendChild(li);
    }
    el.appendChild(compList);

    // Chromaticity diagram canvas
    if (!this.#diagramCanvas) {
      this.#diagramCanvas = document.createElement('canvas');
      this.#diagramCanvas.style.cssText = 'display:block; margin-top:8px; border-radius:4px;';
    }
    el.appendChild(this.#diagramCanvas);

    if (!this.#diagram) {
      this.#diagram = new ChromaticityDiagram(this.#diagramCanvas, this.#engine);
    }

    // Compute the current color's chromaticity
    let currentXY = null;
    const cc = this.#state.get('currentColor');
    if (cc && cc.xyz) {
      const [X, Y, Z] = cc.xyz;
      const sum = X + Y + Z;
      if (sum > 1e-6) {
        currentXY = [X / sum, Y / sum];
      }
    }

    // Determine the gamut to overlay for the selected space
    const gamut = GAMUTS_BY_SPACE[spaceId] || null;
    this.#diagram.render(currentXY, gamut);
  }
}

// ---------------------------------------------------------------------------
//  AccuracyMeters
// ---------------------------------------------------------------------------

/** Classify a Delta-E value into a human-readable description. */
function classifyDeltaE(dE) {
  if (dE < 0.01)  return { label: 'Identical',          cssClass: 'de-identical' };
  if (dE < 1)     return { label: 'Imperceptible',      cssClass: 'de-imperceptible' };
  if (dE < 2)     return { label: 'Barely perceptible',  cssClass: 'de-barely' };
  if (dE < 5)     return { label: 'Noticeable',          cssClass: 'de-noticeable' };
  if (dE < 10)    return { label: 'Significant',         cssClass: 'de-significant' };
  return           { label: 'Very different',             cssClass: 'de-very-different' };
}

/** Get a CSS color for a given delta magnitude (0=green, mid=yellow, high=red). */
function deltaColor(fraction) {
  // fraction: 0..1 where 1 = max delta
  const f = Math.max(0, Math.min(1, fraction));
  if (f < 0.5) {
    // green to yellow
    const t = f * 2;
    const r = Math.round(60 + t * 195);
    const g = Math.round(200 - t * 40);
    return `rgb(${r}, ${g}, 50)`;
  }
  // yellow to red
  const t = (f - 0.5) * 2;
  const r = Math.round(255);
  const g = Math.round(160 - t * 160);
  return `rgb(${r}, ${g}, 50)`;
}

/** Get a CSS color for a Delta-E classification. */
function deltaEColor(dE) {
  if (dE < 0.01)  return '#4caf50';
  if (dE < 1)     return '#66bb6a';
  if (dE < 2)     return '#c8e600';
  if (dE < 5)     return '#ffc107';
  if (dE < 10)    return '#ff9800';
  return '#f44336';
}

export class AccuracyMeters {
  /** @type {{meterGroupOriginal: HTMLElement, meterGroupHSB: HTMLElement, meterGroupLMS: HTMLElement, deltaEDisplay: HTMLElement}} */
  #els;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;
  /** Currently selected meter group: 'original' | 'hsb' | 'lms' */
  #activeGroup = 'hsb';

  /**
   * @param {{meterGroupOriginal: HTMLElement, meterGroupHSB: HTMLElement, meterGroupLMS: HTMLElement, deltaEDisplay: HTMLElement}} elements
   * @param {AppState} state
   * @param {ColorEngine} engine
   */
  constructor(elements, state, engine) {
    this.#els = elements;
    this.#state = state;
    this.#engine = engine;

    // Initialize group from state
    const stateGroup = this.#state.get('accuracyMeters.group');
    if (stateGroup) this.#activeGroup = stateGroup;

    // Listen for radio button changes
    this.#setupRadioListeners();

    // Re-render on color changes
    this.#state.subscribe('currentColor', () => this.render());
    this.#state.subscribe('accuracyMeters.group', (val) => {
      if (val && val !== this.#activeGroup) {
        this.#activeGroup = val;
        this.#syncRadios();
        this.render();
      }
    });
  }

  #setupRadioListeners() {
    // Look for radio buttons in the parent of deltaEDisplay or the document
    const container = this.#els.deltaEDisplay?.closest?.('.accuracy-panel') || document;
    const radios = container.querySelectorAll('input[name="meter-group"]');
    for (const radio of radios) {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.#activeGroup = radio.value;
          this.#state.set('accuracyMeters.group', radio.value);
          this.render();
        }
      });
    }
    this.#syncRadios();
  }

  #syncRadios() {
    const container = this.#els.deltaEDisplay?.closest?.('.accuracy-panel') || document;
    const radios = container.querySelectorAll('input[name="meter-group"]');
    for (const radio of radios) {
      radio.checked = radio.value === this.#activeGroup;
    }
  }

  render() {
    const cc = this.#state.get('currentColor');
    if (!cc) return;

    const spaceId = cc.sourceSpace;
    const values = cc.sourceValues;
    if (!spaceId || !values) return;

    const accuracy = this.#engine.getAccuracy(values, spaceId);

    // --- Delta E display ---
    this.#renderDeltaE(accuracy.deltaE, accuracy.isExact);

    // --- Show/hide meter groups ---
    this.#els.meterGroupOriginal.style.display = this.#activeGroup === 'original' ? '' : 'none';
    this.#els.meterGroupHSB.style.display = this.#activeGroup === 'hsb' ? '' : 'none';
    this.#els.meterGroupLMS.style.display = this.#activeGroup === 'lms' ? '' : 'none';

    if (accuracy.isExact) {
      this.#renderExactMatch(this.#els.meterGroupOriginal);
      this.#renderExactMatch(this.#els.meterGroupHSB);
      this.#renderExactMatch(this.#els.meterGroupLMS);
      return;
    }

    // Render the active meter group
    const space = this.#engine.spaces.get(spaceId);
    switch (this.#activeGroup) {
      case 'original':
        this.#renderMeterGroup(
          this.#els.meterGroupOriginal,
          space ? space.components.map(c => c.name) : ['C0', 'C1', 'C2'],
          accuracy.componentDeltas,
          space ? space.components.map(c => c.range[1] - c.range[0]) : [255, 255, 255],
        );
        break;
      case 'hsb':
        this.#renderMeterGroup(
          this.#els.meterGroupHSB,
          ['Hue', 'Saturation', 'Brightness'],
          accuracy.hsbDeltas,
          [180, 100, 100],
        );
        break;
      case 'lms':
        this.#renderMeterGroup(
          this.#els.meterGroupLMS,
          ['L (long)', 'M (medium)', 'S (short)'],
          accuracy.lmsDeltas,
          [0.5, 0.5, 0.5],
        );
        break;
    }
  }

  #renderDeltaE(dE, isExact) {
    const el = this.#els.deltaEDisplay;
    el.innerHTML = '';

    if (isExact) {
      el.innerHTML = '<span style="color:#4caf50; font-weight:bold;">Delta E: 0.00 &mdash; Identical</span>';
      return;
    }

    const classification = classifyDeltaE(dE);
    const color = deltaEColor(dE);

    // Container
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

    // Text line
    const textLine = document.createElement('div');
    textLine.style.cssText = 'font-size:13px;';
    textLine.innerHTML = `<span style="font-weight:bold;">Delta E 2000:</span> ` +
      `<span style="color:${color}; font-weight:bold;">${dE.toFixed(2)}</span> ` +
      `<span style="color:${color};">&mdash; ${classification.label}</span>`;
    wrapper.appendChild(textLine);

    // Small bar visualization (0 to 20 scale)
    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'width:150px; height:8px; background:rgba(255,255,255,0.08); ' +
      'border-radius:4px; overflow:hidden;';
    const barInner = document.createElement('div');
    const barFraction = Math.min(1, dE / 20);
    barInner.style.cssText = `width:${barFraction * 100}%; height:100%; ` +
      `background:${color}; border-radius:4px; transition:width 0.2s;`;
    barOuter.appendChild(barInner);
    wrapper.appendChild(barOuter);

    el.appendChild(wrapper);
  }

  #renderExactMatch(groupEl) {
    groupEl.innerHTML = '';
    const p = document.createElement('div');
    p.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px 0; font-size:13px; color:#4caf50;';
    p.innerHTML = '<span style="font-size:16px;">&#10003;</span><span style="font-weight:bold;">Exact match</span>';
    groupEl.appendChild(p);
  }

  /**
   * Render a set of horizontal bar meters.
   * @param {HTMLElement} groupEl  Container element
   * @param {string[]} names       Component names
   * @param {number[]} deltas      Delta values (signed)
   * @param {number[]} maxRanges   Max reasonable delta for scaling each bar
   */
  #renderMeterGroup(groupEl, names, deltas, maxRanges) {
    groupEl.innerHTML = '';

    for (let i = 0; i < names.length; i++) {
      const delta = deltas[i] || 0;
      const maxRange = maxRanges[i] || 1;
      const absDelta = Math.abs(delta);
      const fraction = Math.min(1, absDelta / maxRange);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; margin-bottom:4px;';

      // Label
      const label = document.createElement('span');
      label.style.cssText = 'font-size:12px; width:80px; flex-shrink:0; color:#ccc; text-align:right;';
      label.textContent = names[i];
      row.appendChild(label);

      // Bar
      const barOuter = document.createElement('div');
      barOuter.style.cssText = 'width:150px; height:10px; background:rgba(255,255,255,0.06); ' +
        'border-radius:5px; overflow:hidden; flex-shrink:0;';
      const barInner = document.createElement('div');
      const barColor = deltaColor(fraction);
      barInner.style.cssText = `width:${Math.max(1, fraction * 100)}%; height:100%; ` +
        `background:${barColor}; border-radius:5px; transition:width 0.2s;`;
      barOuter.appendChild(barInner);
      row.appendChild(barOuter);

      // Value
      const valSpan = document.createElement('span');
      valSpan.style.cssText = 'font-size:11px; color:#aaa; width:60px; flex-shrink:0;';
      const sign = delta >= 0 ? '+' : '';
      valSpan.textContent = `${sign}${delta.toFixed(3)}`;
      row.appendChild(valSpan);

      groupEl.appendChild(row);
    }
  }
}
