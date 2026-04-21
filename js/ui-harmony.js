// ---------------------------------------------------------------------------
//  ui-harmony.js  --  Color harmony module
//
//  ES module.  Displays harmony swatches (complementary, split-complementary,
//  triadic, tetradic, analogous) based on the current color.  Users can click
//  a swatch to select it, drag it, or save all harmony colors at once.
// ---------------------------------------------------------------------------

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

// ---------------------------------------------------------------------------
//  Harmony definitions  (hue offsets in degrees)
// ---------------------------------------------------------------------------

/** @type {Record<string, {label: string, offsets: number[]}>} */
const HARMONIES = {
  complementary:  { label: 'Complementary',        offsets: [180] },
  split:          { label: 'Split Complementary',   offsets: [150, 210] },
  triadic:        { label: 'Triadic',               offsets: [120, 240] },
  square:         { label: 'Tetradic (Square)',     offsets: [90, 180, 270] },
  rectangular:    { label: 'Tetradic (Rectangular)',offsets: [60, 180, 240] },
  analogous:      { label: 'Analogous',             offsets: [-60, -30, 30, 60] },
  splitComplement:{ label: 'Split-Complement',      offsets: [150, -150] },
  squareEven:     { label: 'Square',                offsets: [90, 180, 270] },
  doubleComplement:{ label: 'Double-Complement',    offsets: [30, 180, 210] },
};

const HARMONY_ORDER = [
  'complementary', 'split', 'triadic', 'square', 'rectangular', 'analogous',
  'splitComplement', 'squareEven', 'doubleComplement',
];

// ---------------------------------------------------------------------------
//  Swatch style constants
// ---------------------------------------------------------------------------

const SWATCH_SIZE  = 32;   // px
const SWATCH_GAP   = 6;    // px
const BORDER_WIDTH = 2;    // px  (base swatch gets 3 px white border)

// ---------------------------------------------------------------------------
//  ColorHarmony
// ---------------------------------------------------------------------------

export class ColorHarmony {
  /** @type {HTMLElement} */
  #container;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;

  /** @type {string} currently selected harmony key */
  #activeType = 'triadic';

  /** @type {HTMLSelectElement} */
  #selectEl;
  /** @type {HTMLDivElement} */
  #swatchRow;

  /** Cached HSB triplets: index 0 = base color, 1..N = harmony colors */
  #hsbColors = [];

  /** RAF guard to coalesce rapid updates */
  #rafId = 0;

  /** Unsubscribe function returned by state.subscribe */
  #unsub = null;

  // -----------------------------------------------------------------------
  //  Construction
  // -----------------------------------------------------------------------

  /**
   * @param {HTMLElement}  containerEl  Wrapper element to build UI inside
   * @param {AppState}     state        Central state store
   * @param {ColorEngine}  engine       Color conversion engine
   */
  constructor(containerEl, state, engine) {
    this.#container = containerEl;
    this.#state     = state;
    this.#engine    = engine;

    this.#buildDOM();
    this.#update();

    this.#unsub = state.subscribe('currentColor', () => {
      this.#scheduleUpdate();
    });
  }

  // -----------------------------------------------------------------------
  //  DOM scaffolding
  // -----------------------------------------------------------------------

  #buildDOM() {
    const section = document.createElement('div');
    section.className = 'harmony-section';
    section.style.cssText = 'padding:8px 10px;border-bottom:1px solid var(--border,#333)';

    // -- header row -------------------------------------------------------
    const header = document.createElement('div');
    header.className = 'harmony-header';
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px';

    const label = document.createElement('span');
    label.textContent = 'Color Harmony';
    label.style.cssText = 'font-weight:600;font-size:13px';

    this.#selectEl = document.createElement('select');
    this.#selectEl.className = 'harmony-type-select';
    this.#selectEl.style.cssText =
      'font-size:12px;padding:2px 4px;background:var(--input-bg,#222);' +
      'color:var(--text,#eee);border:1px solid var(--border,#555);border-radius:3px';

    for (const key of HARMONY_ORDER) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = HARMONIES[key].label;
      if (key === this.#activeType) opt.selected = true;
      this.#selectEl.appendChild(opt);
    }

    this.#selectEl.addEventListener('change', () => {
      this.#activeType = this.#selectEl.value;
      this.#update();
    });

    header.appendChild(label);
    header.appendChild(this.#selectEl);

    // -- swatch row -------------------------------------------------------
    this.#swatchRow = document.createElement('div');
    this.#swatchRow.className = 'harmony-swatches';
    this.#swatchRow.style.cssText =
      `display:flex;gap:${SWATCH_GAP}px;align-items:center;justify-content:center;` +
      'flex-wrap:wrap;margin-bottom:6px';

    // -- save-all button --------------------------------------------------
    const saveBtn = document.createElement('button');
    saveBtn.className = 'harmony-save-all small-btn';
    saveBtn.textContent = 'Save All';
    saveBtn.style.cssText =
      'font-size:11px;padding:2px 8px;cursor:pointer;background:var(--btn-bg,#333);' +
      'color:var(--text,#eee);border:1px solid var(--border,#555);border-radius:3px';
    saveBtn.addEventListener('click', () => this.#saveAll());

    // -- assemble ---------------------------------------------------------
    section.appendChild(header);
    section.appendChild(this.#swatchRow);
    section.appendChild(saveBtn);
    this.#container.appendChild(section);
  }

  // -----------------------------------------------------------------------
  //  Harmony computation
  // -----------------------------------------------------------------------

  /** Recompute #hsbColors from the current state color. */
  #computeHarmony() {
    const cc = this.#state.get('currentColor');
    if (!cc) return;

    const baseHSB = this.#engine.convert(cc.xyz, 'xyz', 'hsb');
    const [h, s, b] = baseHSB;

    const offsets = HARMONIES[this.#activeType].offsets;
    this.#hsbColors = [baseHSB];

    for (const offset of offsets) {
      this.#hsbColors.push([(h + offset + 360) % 360, s, b]);
    }
  }

  // -----------------------------------------------------------------------
  //  Rendering
  // -----------------------------------------------------------------------

  #scheduleUpdate() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#update();
    });
  }

  #update() {
    this.#computeHarmony();
    this.#renderSwatches();
  }

  #renderSwatches() {
    this.#swatchRow.innerHTML = '';

    for (let i = 0; i < this.#hsbColors.length; i++) {
      const hsb  = this.#hsbColors[i];
      const hex  = this.#engine.toHex(hsb, 'hsb');
      const [r, g, b] = this.#engine.toSRGB(hsb, 'hsb');
      const isBase = i === 0;

      const swatch = document.createElement('div');
      swatch.className = 'saved-swatch';
      swatch.title = hex;
      swatch.draggable = true;

      const borderColor = isBase ? '#fff' : 'var(--border,#555)';
      const borderW     = isBase ? 3 : BORDER_WIDTH;

      swatch.style.cssText =
        `width:${SWATCH_SIZE}px;height:${SWATCH_SIZE}px;` +
        `background:${hex};` +
        `border:${borderW}px solid ${borderColor};` +
        'border-radius:4px;cursor:pointer;box-sizing:border-box;' +
        'transition:transform 0.1s ease,box-shadow 0.1s ease;position:relative';

      // Hover feedback
      swatch.addEventListener('mouseenter', () => {
        swatch.style.transform = 'scale(1.15)';
        swatch.style.boxShadow = '0 0 6px rgba(255,255,255,0.4)';
      });
      swatch.addEventListener('mouseleave', () => {
        swatch.style.transform = '';
        swatch.style.boxShadow = '';
      });

      // Base-color indicator dot
      if (isBase) {
        const dot = document.createElement('div');
        // Use a contrasting dot color
        const luminance = (r * 0.299 + g * 0.587 + b * 0.114);
        const dotColor  = luminance > 128 ? '#000' : '#fff';
        dot.style.cssText =
          `width:6px;height:6px;border-radius:50%;background:${dotColor};` +
          'position:absolute;bottom:2px;right:2px;pointer-events:none';
        swatch.appendChild(dot);
      }

      // Click -> set as current color
      swatch.addEventListener('click', () => {
        const xyz = this.#engine.convert(hsb, 'hsb', 'xyz');
        this.#state.set('currentColor', {
          sourceSpace: 'hsb',
          sourceValues: [...hsb],
          xyz,
        });
      });

      // Drag support
      swatch.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', hex);
        e.dataTransfer.effectAllowed = 'copy';
      });

      this.#swatchRow.appendChild(swatch);
    }
  }

  // -----------------------------------------------------------------------
  //  Save all harmony colors
  // -----------------------------------------------------------------------

  #saveAll() {
    for (let i = 0; i < this.#hsbColors.length; i++) {
      const hsb = this.#hsbColors[i];
      const xyz = this.#engine.convert(hsb, 'hsb', 'xyz');
      this.#state.addSavedColor({
        sourceSpace: 'hsb',
        sourceValues: [...hsb],
        xyz,
        name: `Harmony ${i}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  //  Cleanup
  // -----------------------------------------------------------------------

  /** Remove DOM elements and unsubscribe from state. */
  destroy() {
    if (this.#unsub) {
      this.#unsub();
      this.#unsub = null;
    }
    if (this.#rafId) {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = 0;
    }
    this.#container.innerHTML = '';
  }
}
