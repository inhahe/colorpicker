// ---------------------------------------------------------------------------
//  ui-hex-picker.js  --  Hexagonal color grid picker
//
//  ES module.  Renders a flat-top hexagonal grid of color swatches on a canvas.
//  Two color-space components map to the grid X (columns) and Y (rows) axes;
//  the third is held constant (mirroring the 2D picker's axis configuration).
//  Users can click any hexagon to select that color, hover to preview, and
//  adjust the grid resolution with a slider.
// ---------------------------------------------------------------------------

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

const SQRT3 = Math.sqrt(3);

// ---------------------------------------------------------------------------
//  HexPicker
// ---------------------------------------------------------------------------

export class HexPicker {
  /** @type {HTMLElement} */
  #container;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;

  /** @type {HTMLCanvasElement} */
  #canvas;
  /** @type {CanvasRenderingContext2D} */
  #ctx;

  /** @type {number} grid resolution (columns and rows) */
  #resolution = 12;
  /** @type {number} computed hex radius */
  #radius = 0;

  /** @type {{col: number, row: number} | null} currently hovered cell */
  #hoverCell = null;
  /** @type {{col: number, row: number} | null} cell matching current color */
  #selectedCell = null;

  /** RAF guard */
  #rafId = 0;

  /** Unsubscribe handles */
  #unsubs = [];

  // -----------------------------------------------------------------------
  //  Construction
  // -----------------------------------------------------------------------

  /**
   * @param {HTMLElement}  containerEl  Wrapper div to build UI inside
   * @param {AppState}     state        Central state store
   * @param {ColorEngine}  engine       Color conversion engine
   */
  constructor(containerEl, state, engine) {
    this.#container = containerEl;
    this.#state     = state;
    this.#engine    = engine;

    this.#buildDOM();
    this.#attachEvents();

    // Subscribe to state changes
    this.#unsubs.push(
      state.subscribe('currentColor', () => this.#scheduleRender()),
      state.subscribe('picker', () => this.#scheduleRender()),
    );

    // Initial render
    this.#scheduleRender();
  }

  // -----------------------------------------------------------------------
  //  DOM
  // -----------------------------------------------------------------------

  #buildDOM() {
    const section = document.createElement('div');
    section.className = 'hexpicker-section';
    section.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // -- header with resolution slider ------------------------------------
    const header = document.createElement('div');
    header.className = 'hexpicker-header';
    header.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:6px 10px;border-bottom:1px solid var(--border,#333);flex-shrink:0;';

    const title = document.createElement('span');
    title.textContent = 'Hex Grid';
    title.style.cssText = 'font-size:12px;color:var(--text-dim,#888);';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:11px;color:var(--text-dim,#888);display:flex;align-items:center;gap:4px;';

    this.#resLabel = document.createElement('span');
    this.#resLabel.textContent = `Res: ${this.#resolution}`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '4';
    slider.max = '32';
    slider.value = String(this.#resolution);
    slider.style.cssText = 'width:80px;';
    slider.addEventListener('input', () => {
      this.#resolution = parseInt(slider.value, 10);
      this.#resLabel.textContent = `Res: ${this.#resolution}`;
      this.#scheduleRender();
    });

    label.appendChild(this.#resLabel);
    label.appendChild(slider);
    header.appendChild(title);
    header.appendChild(label);

    // -- canvas -----------------------------------------------------------
    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'hexpicker-canvas';
    this.#canvas.style.cssText = 'flex:1;min-height:0;width:100%;cursor:crosshair;';
    this.#ctx = this.#canvas.getContext('2d');

    section.appendChild(header);
    section.appendChild(this.#canvas);
    this.#container.appendChild(section);
  }

  /** @type {HTMLSpanElement} */
  #resLabel;

  // -----------------------------------------------------------------------
  //  Events
  // -----------------------------------------------------------------------

  #attachEvents() {
    this.#canvas.addEventListener('mousemove', (e) => {
      const cell = this.#hitTest(e);
      if (!this.#hoverCell ||
          !cell ||
          cell.col !== this.#hoverCell.col ||
          cell.row !== this.#hoverCell.row) {
        this.#hoverCell = cell;
        this.#scheduleRender();
      }
    });

    this.#canvas.addEventListener('mouseleave', () => {
      this.#hoverCell = null;
      this.#scheduleRender();
    });

    this.#canvas.addEventListener('click', (e) => {
      const cell = this.#hitTest(e);
      if (!cell) return;
      const color = this.#colorForCell(cell.col, cell.row);
      if (!color) return;

      const xyz = this.#engine.convert(color.values, color.spaceId, 'xyz');
      this.#state.batch({
        'currentColor.xyz': xyz,
        'currentColor.sourceSpace': color.spaceId,
        'currentColor.sourceValues': color.values,
      });
    });

    // Resize observer to keep the canvas sized to its container
    const ro = new ResizeObserver(() => this.#scheduleRender());
    ro.observe(this.#canvas);
  }

  // -----------------------------------------------------------------------
  //  Hit testing
  // -----------------------------------------------------------------------

  /**
   * Given a mouse event, return the {col, row} of the hex cell under the
   * cursor, or null if none.
   */
  #hitTest(e) {
    const rect = this.#canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const R = this.#radius;
    if (R <= 0) return null;
    const N = this.#resolution;

    // Brute-force: check each cell (fast enough for N <= 32)
    for (let col = 0; col < N; col++) {
      for (let row = 0; row < N; row++) {
        const { cx, cy } = this.#hexCenter(col, row);
        const dx = mx - cx;
        const dy = my - cy;
        // Quick bounding-circle check
        if (dx * dx + dy * dy > R * R) continue;
        // Precise hex containment: flat-top hex, check all 6 edges
        if (this.#pointInHex(mx, my, cx, cy, R)) {
          return { col, row };
        }
      }
    }
    return null;
  }

  /**
   * Test if point (px,py) is inside a flat-top regular hexagon centered at
   * (cx,cy) with circumradius R.
   */
  #pointInHex(px, py, cx, cy, R) {
    const dx = Math.abs(px - cx);
    const dy = Math.abs(py - cy);
    // Flat-top hex bounds
    if (dx > R) return false;
    if (dy > R * SQRT3 / 2) return false;
    // Edge test: the slanted edge satisfies  dy <= sqrt(3) * (R - dx)
    return dy <= SQRT3 * (R - dx);
  }

  // -----------------------------------------------------------------------
  //  Hex geometry helpers
  // -----------------------------------------------------------------------

  /** Pixel center of a flat-top hex cell at grid position (col, row). */
  #hexCenter(col, row) {
    const R = this.#radius;
    const pad = R; // padding so edge hexes aren't clipped
    const cx = pad + col * R * 1.5;
    const cy = pad + row * R * SQRT3 + (col % 2 ? R * SQRT3 / 2 : 0);
    return { cx, cy };
  }

  // -----------------------------------------------------------------------
  //  Color mapping
  // -----------------------------------------------------------------------

  /**
   * Return the color-space values for a given hex cell, or null if the
   * space is not found.
   */
  #colorForCell(col, row) {
    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return null;

    const N = this.#resolution;
    const channels = space.channels;

    // Map col -> X-axis component, row -> Y-axis component
    const xCh = channels[picker.xAxis];
    const yCh = channels[picker.yAxis];
    const exCh = channels[picker.excluded];

    const xVal = xCh.range[0] + (col / (N - 1)) * (xCh.range[1] - xCh.range[0]);
    const yVal = yCh.range[0] + (row / (N - 1)) * (yCh.range[1] - yCh.range[0]);

    // Build values array in channel order
    const values = [0, 0, 0];
    values[picker.xAxis] = xVal;
    values[picker.yAxis] = yVal;
    values[picker.excluded] = picker.excludedValue != null
      ? picker.excludedValue
      : exCh.defaultValue;

    return { spaceId: picker.spaceId, values };
  }

  // -----------------------------------------------------------------------
  //  Rendering
  // -----------------------------------------------------------------------

  #scheduleRender() {
    if (this.#rafId) return;
    this.#rafId = requestAnimationFrame(() => {
      this.#rafId = 0;
      this.#render();
    });
  }

  #render() {
    const canvas = this.#canvas;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = Math.max(rect.width, 60);
    // Use available height for the canvas (subtract header)
    const H = Math.max(canvas.clientHeight, 60);

    // Set canvas backing size to match CSS size (avoid blur)
    if (canvas.width !== Math.round(W) || canvas.height !== Math.round(H)) {
      canvas.width = Math.round(W);
      canvas.height = Math.round(H);
    }

    const ctx = this.#ctx;
    const N = this.#resolution;

    // Compute radius so the grid fits inside the canvas
    // Flat-top hex: width per col = 1.5 * R (except first which is 2R).
    // Height per row = sqrt(3) * R, plus half-row offset.
    const maxColSpan = (N - 1) * 1.5 + 2; // in units of R
    const maxRowSpan = N * SQRT3 + SQRT3 / 2 + 2; // in units of R (extra for offset + padding)
    const R = Math.min(W / maxColSpan, H / maxRowSpan);
    this.#radius = R;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Determine selected cell from current color
    this.#selectedCell = this.#findSelectedCell();

    // Draw each hex
    for (let col = 0; col < N; col++) {
      for (let row = 0; row < N; row++) {
        const color = this.#colorForCell(col, row);
        if (!color) continue;

        // Convert to sRGB for display
        let rgb;
        try {
          rgb = this.#engine.toSRGB(color.values, color.spaceId);
        } catch {
          rgb = [128, 128, 128]; // fallback for out-of-gamut
        }

        const { cx, cy } = this.#hexCenter(col, row);
        const fillColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

        // Draw hex polygon
        this.#drawHex(ctx, cx, cy, R, fillColor);

        // Highlight: hover
        const isHover = this.#hoverCell &&
          this.#hoverCell.col === col &&
          this.#hoverCell.row === row;

        // Highlight: selected (matches current color)
        const isSelected = this.#selectedCell &&
          this.#selectedCell.col === col &&
          this.#selectedCell.row === row;

        if (isHover || isSelected) {
          ctx.save();
          this.#hexPath(ctx, cx, cy, R - 1);
          ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(255,255,255,0.7)';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  /**
   * Draw a filled flat-top hexagon.
   */
  #drawHex(ctx, cx, cy, R, fillStyle) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i;
      const x = cx + R * Math.cos(angle);
      const y = cy + R * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  /**
   * Trace a hex path (for stroking) without filling.
   */
  #hexPath(ctx, cx, cy, R) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i;
      const x = cx + R * Math.cos(angle);
      const y = cy + R * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // -----------------------------------------------------------------------
  //  Selected cell detection
  // -----------------------------------------------------------------------

  /**
   * Find the grid cell that best matches the current color.
   * Returns {col, row} or null.
   */
  #findSelectedCell() {
    const currentColor = this.#state.get('currentColor');
    if (!currentColor) return null;

    const picker = this.#state.get('picker');
    const space = this.#engine.spaces.get(picker.spaceId);
    if (!space) return null;

    // Convert current color to the picker space
    let vals;
    try {
      vals = this.#engine.convert(currentColor.xyz, 'xyz', picker.spaceId);
    } catch {
      return null;
    }

    const N = this.#resolution;
    const channels = space.channels;
    const xCh = channels[picker.xAxis];
    const yCh = channels[picker.yAxis];

    // Map the current color's X/Y values to grid coordinates
    const xFrac = (vals[picker.xAxis] - xCh.range[0]) / (xCh.range[1] - xCh.range[0]);
    const yFrac = (vals[picker.yAxis] - yCh.range[0]) / (yCh.range[1] - yCh.range[0]);

    const col = Math.round(xFrac * (N - 1));
    const row = Math.round(yFrac * (N - 1));

    if (col < 0 || col >= N || row < 0 || row >= N) return null;
    return { col, row };
  }
}
