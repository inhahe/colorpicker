/**
 * app.js — Entry point for the Ultimate Color Picker
 *
 * Initializes the ColorEngine, AppState, and all UI components,
 * then wires them together with event handlers and keyboard shortcuts.
 */

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';
import { Picker2D, AxisSliders, ColorSliders, ColorSwatch, HexDisplay,
         ExcludedSlider, PickerControls, Eyedropper, GradientUI,
         Opponent6D } from './ui-picker-v2.js';
import { InfoPanel, AccuracyMeters } from './ui-info.js';
import { SavedColorsUI, CollectionsUI } from './collections.js';
import { PaletteEditor } from './ui-palette.js';
import { ColorHarmony } from './ui-harmony.js';
import { ColorSpace3D } from './ui-3d-v2.js';
import { ColorOutput, CSS_NAMED } from './ui-output.js';
import { HexPicker } from './ui-hex-picker.js';
import { RBFGradient } from './ui-rbf-gradient.js';
import { ICCManager } from './ui-icc.js';

// ============================================================================
// Bootstrap
// ============================================================================

class App {
  constructor() {
    this.engine = new ColorEngine();
    this.state = new AppState();

    // Load persisted state (saved colors, palettes, preferences)
    this.state.load();

    // Validate loaded color — if XYZ is all zeros or NaN, reset to default
    const loadedColor = this.state.get('currentColor');
    if (!loadedColor || !loadedColor.xyz ||
        (loadedColor.xyz[0] === 0 && loadedColor.xyz[1] === 0 && loadedColor.xyz[2] === 0) ||
        loadedColor.xyz.some(v => isNaN(v))) {
      this.state.set('currentColor', {
        xyz: [0.2188, 0.2224, 0.6851],
        sourceSpace: 'srgb',
        sourceValues: [74, 144, 217],
      });
    }

    // Always ensure all color spaces are active (overrides any saved subset)
    const allSpaces = Array.from(this.engine.spaces.keys()).filter(s => s !== 'xyz');
    this.state.set('availableSpaces', allSpaces);
    this.state.set('activeSpaces', allSpaces);

    // Build the panel layout
    this._buildLayout();

    this._initComponents();
    this._initToolbar();
    this._initKeyboardShortcuts();
    this._initQuickColors();
    this._initColorNameSearch();
    this._initDragDrop();
    this._initSpacePickerDialog();

    // Initial render pass
    this._renderAll();

    console.log(`[ColorPicker] Initialized with ${this.engine.spaces.size} color spaces`);
  }

  // --------------------------------------------------------------------------
  // Panel layout — simple flex with draggable dividers, all inline styles
  // --------------------------------------------------------------------------

  _buildLayout() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    main.style.cssText = 'display:flex;height:100%;overflow:hidden;';

    // Default: 3 columns. Column 2 has panels stacked vertically.
    const defaultLayout = [
      { width: 220, panels: [{ id: 'panel-sliders', label: 'Color Models' }] },
      { width: 320, panels: [
        { id: 'panel-picker', label: '2D Picker' },
        { id: 'panel-color-output', label: 'Color / Hex / CSS' },
      ]},
      { width: 0,   panels: [
        { id: 'panel-3dview', label: '3D View' },
        { id: 'panel-harmony', label: 'Harmony' },
        { id: 'panel-hexpicker', label: 'Hex Grid' },
        { id: 'panel-info', label: 'Color Info' },
        { id: 'panel-accuracy', label: 'Accuracy' },
        { id: 'panel-saved', label: 'Saved / History' },
      ]},
    ];

    let layout;
    try {
      // Clear old layouts that don't have the new panels
      const saved = localStorage.getItem('colorPickerPanelLayout2');
      if (saved) {
        const parsed = JSON.parse(saved);
        const allIds = parsed.flatMap(c => c.panels.map(p => p.id));
        // Only use saved layout if it has the new panels
        if (allIds.includes('panel-color-output') && allIds.includes('panel-saved')) {
          layout = parsed;
        }
      }
    } catch {}
    if (!layout) layout = defaultLayout;

    const S = (el, css) => { el.style.cssText = css; return el; };
    const DIV = (css) => S(document.createElement('div'), css);

    // Shared row-divider creator with resize logic
    const makeRowDivider = (panelAbove) => {
      const hDiv = DIV('height:4px;cursor:row-resize;background:#2a2a4a;flex-shrink:0;');
      hDiv.addEventListener('mouseenter', () => hDiv.style.background = '#4a90d9');
      hDiv.addEventListener('mouseleave', () => { if (!hDiv._active) hDiv.style.background = '#2a2a4a'; });
      hDiv.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hDiv._active = true;
        // Resize both adjacent panels so the others don't shift
        const above = hDiv.previousElementSibling;
        const below = hDiv.nextElementSibling;
        if (!above) return;
        const startY = e.clientY;
        const startAboveH = above.offsetHeight;
        const startBelowH = below ? below.offsetHeight : 0;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        const onMove = (me) => {
          const dy = me.clientY - startY;
          above.style.flex = 'none';
          above.style.height = Math.max(40, startAboveH + dy) + 'px';
          if (below) {
            below.style.flex = 'none';
            below.style.height = Math.max(40, startBelowH - dy) + 'px';
          }
        };
        const onUp = () => {
          hDiv._active = false;
          hDiv.style.background = '#2a2a4a';
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._saveLayout();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      return hDiv;
    };

    // Build columns
    layout.forEach((col, ci) => {
      const ml = col.marginLeft || 0;
      const mlStyle = ml > 0 ? `margin-left:${ml}px;` : '';
      const colEl = DIV(col.width > 0
        ? `width:${col.width}px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative;${mlStyle}`
        : `flex:1;min-width:100px;display:flex;flex-direction:column;min-height:0;overflow:hidden;position:relative;${mlStyle}`);
      colEl.dataset.col = ci;

      // Left-edge resize handle — shifts the column rightward, creating free space on the left
      const leftEdge = DIV('position:absolute;top:0;left:0;width:4px;height:100%;cursor:col-resize;z-index:5;');
      leftEdge.addEventListener('mouseenter', () => leftEdge.style.background = 'rgba(74,144,217,0.5)');
      leftEdge.addEventListener('mouseleave', () => { if (!leftEdge._active) leftEdge.style.background = ''; });
      leftEdge.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        leftEdge._active = true;
        const startX = e.clientX;
        const startML = parseInt(colEl.style.marginLeft) || 0;
        const startW = colEl.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const onMove = (me) => {
          const dx = me.clientX - startX;
          const newML = Math.max(0, startML + dx);
          const newW = Math.max(100, startW - dx);
          colEl.style.marginLeft = newML + 'px';
          colEl.style.width = newW + 'px';
          colEl.style.flex = 'none';
          colEl.style.flexShrink = '0';
        };
        const onUp = () => {
          leftEdge._active = false;
          leftEdge.style.background = '';
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._saveLayout();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      colEl.appendChild(leftEdge);

      // Right-edge resize handle
      const edgeHandle = DIV('position:absolute;top:0;right:0;width:4px;height:100%;cursor:col-resize;z-index:5;');
      edgeHandle.addEventListener('mouseenter', () => edgeHandle.style.background = 'rgba(74,144,217,0.5)');
      edgeHandle.addEventListener('mouseleave', () => { if (!edgeHandle._active) edgeHandle.style.background = ''; });
      edgeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        edgeHandle._active = true;
        const startX = e.clientX;
        const startW = colEl.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const onMove = (me) => {
          colEl.style.width = Math.max(100, startW + me.clientX - startX) + 'px';
          colEl.style.flex = 'none';
          colEl.style.flexShrink = '0';
        };
        const onUp = () => {
          edgeHandle._active = false;
          edgeHandle.style.background = '';
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._saveLayout();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      colEl.appendChild(edgeHandle);

      col.panels.forEach((p, pi) => {
        const panel = document.getElementById(p.id);
        if (!panel) return;
        panel.style.display = '';

        // Panel wrapper — restore height if saved
        const hStyle = p.height > 0 ? `flex:none;height:${p.height}px;` : 'flex:1;';
        const wrap = DIV(`${hStyle}display:flex;flex-direction:column;min-height:60px;overflow:hidden;`);
        wrap.dataset.panelId = p.id;

        // Handle
        const handle = DIV('height:20px;background:#16213e;border-bottom:1px solid #2a2a4a;' +
          'cursor:move;font-size:10px;color:#8888aa;padding:2px 6px;flex-shrink:0;user-select:none;');
        handle.textContent = p.label;

        // Body
        const body = DIV('flex:1;overflow:auto;min-height:0;padding:4px;background:#1e1e3a;');
        body.appendChild(panel);

        wrap.appendChild(handle);
        wrap.appendChild(body);
        colEl.appendChild(wrap);

        // Vertical divider between stacked panels
        if (pi < col.panels.length - 1) {
          colEl.appendChild(makeRowDivider(wrap));
        }

        // Drag handle to reorder — drop onto any panel to swap, or onto a column
        handle.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = wrap.getBoundingClientRect();
          const ghost = DIV(`position:fixed;width:${rect.width}px;height:${Math.min(rect.height,100)}px;` +
            `background:rgba(74,144,217,0.2);border:2px dashed #4a90d9;border-radius:4px;` +
            `pointer-events:none;z-index:10000;`);
          ghost.style.left = rect.left + 'px';
          ghost.style.top = rect.top + 'px';
          document.body.appendChild(ghost);
          wrap.style.opacity = '0.3';
          document.body.style.cursor = 'move';
          document.body.style.userSelect = 'none';

          // Drop indicator
          const indicator = DIV('position:fixed;height:3px;background:#4a90d9;pointer-events:none;z-index:10001;display:none;border-radius:2px;');
          document.body.appendChild(indicator);

          let dropTarget = null;
          let newColSide = null;
          let dropPosition = 'after';

          const onMove = (me) => {
            ghost.style.left = (me.clientX - 40) + 'px';
            ghost.style.top = (me.clientY - 10) + 'px';

            // Find drop target — which panel is the mouse over or nearest to?
            dropTarget = null;
            indicator.style.display = 'none';
            const allWraps = main.querySelectorAll('[data-panel-id]');

            // First pass: find panel the mouse is directly over
            for (const w of allWraps) {
              if (w === wrap) continue;
              const r = w.getBoundingClientRect();
              if (me.clientX >= r.left && me.clientX <= r.right &&
                  me.clientY >= r.top && me.clientY <= r.bottom) {
                const midY = r.top + r.height / 2;
                dropTarget = w;
                dropPosition = me.clientY < midY ? 'before' : 'after';
                break;
              }
            }

            // Second pass: if not directly over a panel, check if we're
            // in a column's horizontal range but below/above all its panels
            if (!dropTarget) {
              const columns = main.querySelectorAll('[data-col]');
              for (const col of columns) {
                const cr = col.getBoundingClientRect();
                if (me.clientX < cr.left || me.clientX > cr.right) continue;

                // Find the last and first panels in this column
                const colPanels = col.querySelectorAll('[data-panel-id]');
                for (const w of colPanels) {
                  if (w === wrap) continue;
                  const r = w.getBoundingClientRect();
                  // Below this panel?
                  if (me.clientY > r.bottom) {
                    dropTarget = w;
                    dropPosition = 'after';
                  }
                  // Above this panel and no target yet?
                  if (me.clientY < r.top && !dropTarget) {
                    dropTarget = w;
                    dropPosition = 'before';
                    break;
                  }
                }
                break;
              }
            }

            // Third pass: if mouse is beyond the left/right edge of all columns,
            // signal "create new column" at that edge
            newColSide = null;
            if (!dropTarget) {
              const columns = main.querySelectorAll('[data-col]');
              if (columns.length > 0) {
                const firstCol = columns[0].getBoundingClientRect();
                const lastCol = columns[columns.length - 1].getBoundingClientRect();
                // Use a generous zone: 30px past the last column OR anywhere past it
                if (me.clientX > lastCol.right - 10) {
                  newColSide = 'right';
                } else if (me.clientX < firstCol.left + 10) {
                  newColSide = 'left';
                }
              }
            }

            // Show indicator
            if (dropTarget) {
              const r = dropTarget.getBoundingClientRect();
              const iy = dropPosition === 'before' ? r.top : r.bottom;
              indicator.style.cssText = `position:fixed;height:3px;background:#4a90d9;pointer-events:none;z-index:10001;border-radius:2px;` +
                `left:${r.left}px;top:${iy - 1}px;width:${r.width}px;`;
            } else if (newColSide) {
              // Show a vertical indicator at the edge
              const mainRect = main.getBoundingClientRect();
              const ix = newColSide === 'right' ? mainRect.right - 4 : mainRect.left;
              indicator.style.cssText = `position:fixed;width:3px;background:#4a90d9;pointer-events:none;z-index:10001;border-radius:2px;` +
                `left:${ix}px;top:${mainRect.top}px;height:${mainRect.height}px;`;
            }
          };

          const onUp = () => {
            ghost.remove();
            indicator.remove();
            wrap.style.opacity = '';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            // No valid drop target and not creating a new column — cancel
            if (!dropTarget && !newColSide) return;
            if (dropTarget === wrap) return;

            // Creating a new column at the edge
            if (!dropTarget && newColSide) {
              const sourceCol = wrap.parentElement;
              if (!sourceCol) return;

              // Remove from source
              const prevSib = wrap.previousElementSibling;
              const nextSib = wrap.nextElementSibling;
              if (prevSib && prevSib.style.cursor === 'row-resize') prevSib.remove();
              else if (nextSib && nextSib.style.cursor === 'row-resize') nextSib.remove();
              wrap.remove();

              // Create new column
              const newCol = DIV('flex:1;min-width:100px;display:flex;flex-direction:column;min-height:0;overflow:hidden;');
              newCol.dataset.col = Date.now(); // unique id
              newCol.appendChild(wrap);

              // Create column divider
              const vDiv = DIV('width:4px;cursor:col-resize;background:#2a2a4a;flex-shrink:0;');
              vDiv.addEventListener('mouseenter', () => vDiv.style.background = '#4a90d9');
              vDiv.addEventListener('mouseleave', () => { if (!vDiv._active) vDiv.style.background = '#2a2a4a'; });
              vDiv.addEventListener('mousedown', (de) => {
                de.preventDefault();
                vDiv._active = true;
                const startX = de.clientX;
                const startW = newCol.offsetWidth;
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                const onMoveDiv = (me2) => {
                  newCol.style.width = Math.max(100, startW + me2.clientX - startX) + 'px';
                  newCol.style.flex = 'none';
                  newCol.style.flexShrink = '0';
                };
                const onUpDiv = () => {
                  vDiv._active = false;
                  vDiv.style.background = '#2a2a4a';
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                  document.removeEventListener('mousemove', onMoveDiv);
                  document.removeEventListener('mouseup', onUpDiv);
                  this._saveLayout();
                };
                document.addEventListener('mousemove', onMoveDiv);
                document.addEventListener('mouseup', onUpDiv);
              });

              if (newColSide === 'right') {
                main.appendChild(vDiv);
                main.appendChild(newCol);
              } else {
                main.insertBefore(newCol, main.firstChild);
                main.insertBefore(vDiv, newCol.nextElementSibling);
              }

              // Clean up empty source column
              if (sourceCol.querySelectorAll('[data-panel-id]').length === 0) {
                const pd = sourceCol.previousElementSibling;
                const nd = sourceCol.nextElementSibling;
                if (pd && pd.style.cursor === 'col-resize') pd.remove();
                else if (nd && nd.style.cursor === 'col-resize') nd.remove();
                sourceCol.remove();
              }

              this._saveLayout();
              return;
            }

            const targetCol = dropTarget.parentElement;
            const sourceCol = wrap.parentElement;

            // Safety: don't proceed if either column is missing
            if (!targetCol || !sourceCol) return;

            // Remove wrap and its adjacent divider from source column
            const prevSib = wrap.previousElementSibling;
            const nextSib = wrap.nextElementSibling;
            if (prevSib && prevSib.style.cursor === 'row-resize') prevSib.remove();
            else if (nextSib && nextSib.style.cursor === 'row-resize') nextSib.remove();
            wrap.remove();

            // Insert into target column with a functional row divider
            if (dropPosition === 'before') {
              const hd = makeRowDivider(wrap);
              targetCol.insertBefore(hd, dropTarget);
              targetCol.insertBefore(wrap, hd);
            } else {
              const hd = makeRowDivider(wrap);
              targetCol.insertBefore(hd, dropTarget.nextElementSibling);
              targetCol.insertBefore(wrap, hd.nextElementSibling);
            }

            // Clean up empty source column
            if (sourceCol.querySelectorAll('[data-panel-id]').length === 0) {
              const prevDiv = sourceCol.previousElementSibling;
              const nextDiv = sourceCol.nextElementSibling;
              if (prevDiv && prevDiv.style.cursor === 'col-resize') prevDiv.remove();
              else if (nextDiv && nextDiv.style.cursor === 'col-resize') nextDiv.remove();
              sourceCol.remove();
            }

            this._saveLayout();
          };

          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      main.appendChild(colEl);

      // Column divider — between columns only (not after the last one)
      if (ci < layout.length - 1) {
        const vDiv = DIV('width:4px;cursor:col-resize;background:#2a2a4a;flex-shrink:0;');
        vDiv.addEventListener('mouseenter', () => vDiv.style.background = '#4a90d9');
        vDiv.addEventListener('mouseleave', () => { if (!vDiv._active) vDiv.style.background = '#2a2a4a'; });
        vDiv.addEventListener('mousedown', (e) => {
          e.preventDefault();
          vDiv._active = true;
          const startX = e.clientX;
          // Resize both adjacent columns: left column grows, right column shrinks
          const leftCol = vDiv.previousElementSibling;
          const rightCol = vDiv.nextElementSibling;
          const startLeftW = leftCol ? leftCol.offsetWidth : 0;
          const startRightW = rightCol ? rightCol.offsetWidth : 0;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          const onMove = (me) => {
            const dx = me.clientX - startX;
            if (leftCol) {
              leftCol.style.width = Math.max(100, startLeftW + dx) + 'px';
              leftCol.style.flex = 'none';
              leftCol.style.flexShrink = '0';
            }
            if (rightCol) {
              rightCol.style.width = Math.max(100, startRightW - dx) + 'px';
              rightCol.style.flex = 'none';
              rightCol.style.flexShrink = '0';
            }
          };
          const onUp = () => {
            vDiv._active = false;
            vDiv.style.background = '#2a2a4a';
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this._saveLayout();
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
        main.appendChild(vDiv);
      }
    });

    // Toolbar buttons
    const resetBtn = document.getElementById('btn-clean-slate');
    if (resetBtn && !document.getElementById('btn-reset-layout')) {
      const layoutBtn = document.createElement('button');
      layoutBtn.id = 'btn-reset-layout';
      layoutBtn.className = 'tool-btn';
      layoutBtn.textContent = 'Reset Layout';
      layoutBtn.addEventListener('click', () => {
        localStorage.removeItem('colorPickerPanelLayout2');
        location.reload();
      });
      resetBtn.parentElement.insertBefore(layoutBtn, resetBtn);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'tool-btn';
      exportBtn.textContent = 'Export Layout';
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(this._getCurrentLayout(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'colorpicker-layout.json';
        a.click();
      });
      resetBtn.parentElement.insertBefore(exportBtn, resetBtn);

      const importBtn = document.createElement('button');
      importBtn.className = 'tool-btn';
      importBtn.textContent = 'Import Layout';
      importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
          const file = input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const layout = JSON.parse(e.target.result);
              if (Array.isArray(layout) && layout.length > 0) {
                localStorage.setItem('colorPickerPanelLayout2', JSON.stringify(layout));
                location.reload();
              }
            } catch (err) {
              alert('Invalid layout file: ' + err.message);
            }
          };
          reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
      });
      resetBtn.parentElement.insertBefore(importBtn, resetBtn);
    }
  }

  _saveLayout() {
    try {
      localStorage.setItem('colorPickerPanelLayout2', JSON.stringify(this._getCurrentLayout()));
    } catch {}
  }

  _getCurrentLayout() {
    const main = document.getElementById('main-content');
    const layout = [];
    for (const colEl of main.children) {
      if (!colEl.dataset || colEl.dataset.col === undefined) continue;
      const col = {
        width: colEl.style.flex === '1' ? 0 : colEl.offsetWidth,
        marginLeft: parseInt(colEl.style.marginLeft) || 0,
        panels: [],
      };
      colEl.querySelectorAll('[data-panel-id]').forEach(wrap => {
        col.panels.push({
          id: wrap.dataset.panelId,
          label: wrap.querySelector('div')?.textContent || wrap.dataset.panelId,
          height: wrap.style.flex === '1' || !wrap.style.height ? 0 : wrap.offsetHeight,
        });
      });
      if (col.panels.length > 0) layout.push(col);
    }
    return layout;
  }

  // --------------------------------------------------------------------------
  // Component initialization
  // --------------------------------------------------------------------------

  _initComponents() {
    const $ = id => document.getElementById(id);

    // --- 2D Picker ---
    this.picker2d = new Picker2D(
      $('picker-canvas'),
      $('picker-crosshair'),
      this.state,
      this.engine
    );

    // --- RBF Gradient (place color points for 2D interpolation) ---
    this.rbfGradient = new RBFGradient(
      $('picker-canvas'),
      this.state,
      this.engine
    );

    // --- Axis sliders along picker edges ---
    this.axisSliders = new AxisSliders(
      $('picker-x-slider'),
      $('picker-y-slider'),
      this.state,
      this.engine
    );

    // --- Color model sliders (left panel) ---
    // ColorSliders handles state changes internally, so no callback needed
    this.colorSliders = new ColorSliders(
      $('slider-groups'),
      this.state,
      this.engine
    );

    // --- 6D Opponent sliders ---
    this.opponent6d = new Opponent6D($('opponent-6d'), this.state, this.engine);

    // --- Current color swatch ---
    this.swatch = new ColorSwatch(
      $('swatch-actual'),
      $('swatch-intended'),
      this.state,
      this.engine
    );

    // --- Hex display ---
    this.hexDisplay = new HexDisplay(
      $('hex-input'),
      $('btn-copy-hex'),
      $('btn-paste-hex'),
      this.state,
      this.engine
    );

    // --- Excluded dimension slider ---
    this.excludedSlider = new ExcludedSlider(
      $('excluded-slider'),
      $('excluded-label'),
      $('excluded-value'),
      this.state,
      this.engine
    );

    // --- Picker axis controls ---
    this.pickerControls = new PickerControls(
      {
        spaceSelect: $('picker-space-select'),
        xSelect: $('picker-x-select'),
        ySelect: $('picker-y-select'),
        excludedSelect: $('picker-excluded-select'),
        swapBtn: $('btn-swap-axes'),
        reverseXBtn: $('btn-reverse-x'),
        reverseYBtn: $('btn-reverse-y'),
        rotateBtn: $('btn-rotate-picker'),
        rot1: $('picker-rot1'),
        rot2: $('picker-rot2'),
        rotLine: $('btn-rot-line'),
        rot2Color: $('btn-rot-2color'),
        rotReset: $('btn-rot-reset'),
      },
      this.state,
      this.engine
    );

    // --- Eyedropper ---
    this.eyedropper = new Eyedropper(
      $('btn-eyedropper'),
      this.state,
      this.engine
    );

    // --- Gradient tools ---
    this.gradientUI = new GradientUI(
      {
        color1Swatch: $('gradient-color1'),
        color2Swatch: $('gradient-color2'),
        gradientBar: $('gradient-bar'),
        triCanvas: $('triangle-canvas'),
        triSwatches: [$('tri-color1'), $('tri-color2'), $('tri-color3')],
      },
      this.state,
      this.engine
    );

    // --- Info panel ---
    this.infoPanel = new InfoPanel(
      {
        descriptionEl: $('info-description'),
        equationsEl: $('info-equations-content'),
        gamutEl: $('info-gamut-content'),
        spaceLabel: $('info-space-label'),
      },
      this.state,
      this.engine
    );

    // --- Accuracy meters ---
    this.accuracyMeters = new AccuracyMeters(
      {
        meterGroupOriginal: $('meter-group-original'),
        meterGroupHSB: $('meter-group-hsb'),
        meterGroupLMS: $('meter-group-lms'),
        deltaEDisplay: $('accuracy-delta-e'),
      },
      this.state,
      this.engine
    );

    // --- Saved colors ---
    this.savedColors = new SavedColorsUI(
      $('saved-colors-strip'),
      $('btn-save-color'),
      this.state,
      this.engine,
      (color) => this._selectSavedColor(color)
    );

    // --- Standard collections ---
    this.collections = new CollectionsUI(
      $('collection-select'),
      $('collection-colors'),
      (color) => this._selectCollectionColor(color)
    );

    // --- 3D color space viewer ---
    if (ColorSpace3D) {
      try {
        const view3dEl = $('view3d-container');
        if (view3dEl) {
          this.view3d = new ColorSpace3D(view3dEl, this.state, this.engine);
        }
      } catch (err) {
        console.warn('[App] 3D viewer failed to initialize:', err);
      }
    }

    // --- Color harmony ---
    try {
      this.harmony = new ColorHarmony($('harmony-container'), this.state, this.engine);
    } catch (err) {
      console.warn('[App] Harmony failed to initialize:', err);
    }

    // --- Hex picker ---
    try {
      this.hexPicker = new HexPicker($('hexpicker-container'), this.state, this.engine);
    } catch (err) {
      console.warn('[App] Hex picker failed:', err);
    }

    // --- CSS output, contrast, nearest name ---
    this.colorOutput = new ColorOutput(
      $('css-formats'),
      $('contrast-info'),
      $('nearest-name'),
      this.state,
      this.engine,
      $('cvd-sim'),
      $('color-temp')
    );

    // --- Palette editor ---
    this.paletteEditor = new PaletteEditor(
      {
        panel: $('palette-editor-panel'),
        canvas: $('palette-canvas'),
        btnNew: $('btn-palette-new'),
        btnFromImage: $('btn-palette-from-image'),
        btnSave: $('btn-palette-save'),
        btnLoad: $('btn-palette-load'),
        btnExport: $('btn-palette-export'),
        rotationSlider: $('palette-rotation'),
      },
      this.state,
      this.engine
    );

    // --- ICC profile manager ---
    this.iccManager = new ICCManager(this.state, this.engine);

    // --- Color history ---
    this._colorHistory = [];
    this._historyStrip = document.getElementById('color-history-strip');

    // Record color to history on mouseup (end of drag) instead of debouncing
    document.addEventListener('mouseup', () => {
      const color = this.state.get('currentColor');
      if (!color) return;
      const hex = this.engine.toHex(color.sourceValues, color.sourceSpace);
      this._addToHistory(hex, color);
    });

    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      this._colorHistory = [];
      this._renderHistory();
    });
  }

  // --------------------------------------------------------------------------
  // Toolbar button handlers
  // --------------------------------------------------------------------------

  _initToolbar() {
    const $ = id => document.getElementById(id);

    // Undo / Redo
    const undoBtn = $('btn-undo');
    const redoBtn = $('btn-redo');

    undoBtn.addEventListener('click', () => {
      this.state.undo();
      this._updateUndoRedoButtons();
    });

    redoBtn.addEventListener('click', () => {
      this.state.redo();
      this._updateUndoRedoButtons();
    });

    // Update undo/redo button states on any change
    this.state.onChange(() => this._updateUndoRedoButtons());
    this._updateUndoRedoButtons();

    // Clean Slate
    $('btn-clean-slate').addEventListener('click', () => {
      if (confirm('Reset all settings to defaults? (Saved colors and palettes will be kept)')) {
        this.state.cleanSlate();
        // Force all spaces back and re-render everything
        const allSpaces = Array.from(this.engine.spaces.keys()).filter(s => s !== 'xyz');
        this.state.set('activeSpaces', allSpaces);
        this._renderAll();
      }
    });

    // Export Session
    $('btn-export-session')?.addEventListener('click', () => {
      const state = this.state.snapshot();
      const json = JSON.stringify(state, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `colorpicker-session-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Import Session
    $('btn-import-session')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            this.state.loadFromSnapshot(data);
            // Re-ensure all color spaces are active (same as constructor)
            const allSpaces = Array.from(this.engine.spaces.keys()).filter(s => s !== 'xyz');
            this.state.set('availableSpaces', allSpaces);
            this.state.set('activeSpaces', allSpaces);
            this._renderAll();
          } catch (err) {
            console.error('Failed to import session:', err);
            alert('Failed to import session: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);
    });

    // Palette Editor toggle
    const palettePanel = $('palette-editor-panel');
    $('btn-palette-editor').addEventListener('click', () => {
      const isOpen = palettePanel.style.display !== 'none';
      palettePanel.style.display = isOpen ? 'none' : 'block';
      this.state.set('paletteEditor.open', !isOpen);
    });
    $('btn-close-palette').addEventListener('click', () => {
      palettePanel.style.display = 'none';
      this.state.set('paletteEditor.open', false);
    });

    // Gradient / Triangle toggle buttons in toolbar
    $('btn-gradient-tool')?.addEventListener('click', () => {
      const section = document.getElementById('two-color-gradient');
      if (section) {
        const visible = section.style.display !== 'none';
        section.style.display = visible ? 'none' : '';
        this.state.set('gradient.enabled', !visible);
      }
    });
    $('btn-triangle-tool')?.addEventListener('click', () => {
      const section = document.getElementById('three-color-gradient');
      if (section) {
        const visible = section.style.display !== 'none';
        section.style.display = visible ? 'none' : '';
        this.state.set('triangleGradient.enabled', !visible);
      }
    });

    // Gradient section close buttons
    document.querySelectorAll('.close-btn[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.close;
        const el = document.getElementById(target);
        if (el) el.style.display = 'none';
        if (target === 'two-color-gradient') this.state.set('gradient.enabled', false);
        if (target === 'three-color-gradient') this.state.set('triangleGradient.enabled', false);
      });
    });

    // Meter group radio buttons
    document.querySelectorAll('input[name="meter-group"]').forEach(radio => {
      radio.addEventListener('change', () => {
        this.state.set('accuracyMeters.group', radio.value);
      });
    });

    // --- Saved Picker Views ---
    const pickerViewsSelect = $('picker-saved-views');
    const btnSavePicker = $('btn-save-picker');

    const loadSavedViews = () => {
      try {
        return JSON.parse(localStorage.getItem('colorPickerSavedViews') || '[]');
      } catch { return []; }
    };

    const populateViewsDropdown = () => {
      if (!pickerViewsSelect) return;
      const views = loadSavedViews();
      // Keep the placeholder, remove the rest
      pickerViewsSelect.length = 1;
      for (let i = 0; i < views.length; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = views[i].name;
        pickerViewsSelect.appendChild(opt);
      }
    };

    if (btnSavePicker) {
      btnSavePicker.addEventListener('click', () => {
        const name = prompt('Name for this picker view:');
        if (!name) return;
        const picker = this.state.get('picker');
        const entry = {
          name,
          config: JSON.parse(JSON.stringify(picker)),
        };
        const views = loadSavedViews();
        views.push(entry);
        localStorage.setItem('colorPickerSavedViews', JSON.stringify(views));
        populateViewsDropdown();
      });
    }

    if (pickerViewsSelect) {
      pickerViewsSelect.addEventListener('change', () => {
        const idx = parseInt(pickerViewsSelect.value, 10);
        if (isNaN(idx)) return;
        const views = loadSavedViews();
        if (views[idx]) {
          this.state.set('picker', views[idx].config);
        }
        pickerViewsSelect.value = '';
      });
    }

    // Populate on startup
    populateViewsDropdown();
  }

  _updateUndoRedoButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = !this.state.canUndo();
    if (redoBtn) redoBtn.disabled = !this.state.canRedo();
  }

  // --------------------------------------------------------------------------
  // Keyboard shortcuts
  // --------------------------------------------------------------------------

  _initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept when typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+Z → Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.state.undo();
        this._updateUndoRedoButtons();
      }

      // Ctrl+Y or Ctrl+Shift+Z → Redo
      if ((ctrl && e.key === 'y') || (ctrl && e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        this.state.redo();
        this._updateUndoRedoButtons();
      }

      // Ctrl+C → Copy hex
      if (ctrl && e.key === 'c') {
        const color = this.state.get('currentColor');
        const hex = this.engine.toHex(color.sourceValues, color.sourceSpace);
        navigator.clipboard?.writeText(hex);
      }

      // Ctrl+V → Paste image (extract palette) or hex color
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        // Try image paste first (for palette extraction)
        navigator.clipboard?.read?.().then(items => {
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
              item.getType(imageType).then(blob => {
                createImageBitmap(blob).then(bmp => {
                  if (this.paletteEditor) {
                    this.paletteEditor._extractPaletteFromImage(bmp);
                  }
                });
              });
              return;
            }
          }
          // No image found — fall back to text paste (hex color)
          navigator.clipboard?.readText().then(text => {
            const parsed = this.engine.fromHex(text?.trim());
            if (parsed) {
              this._setColorFromSpace(parsed.values, parsed.spaceId);
            }
          }).catch(() => {});
        }).catch(() => {
          // clipboard.read() not available — fall back to text paste
          navigator.clipboard?.readText().then(text => {
            const parsed = this.engine.fromHex(text?.trim());
            if (parsed) {
              this._setColorFromSpace(parsed.values, parsed.spaceId);
            }
          }).catch(() => {});
        });
      }

      // I → Eyedropper
      if (e.key === 'i' || e.key === 'I') {
        this.eyedropper.pick();
      }

      // S → Save current color
      if (e.key === 's' && !ctrl) {
        const color = this.state.get('currentColor');
        this.state.addSavedColor({
          sourceSpace: color.sourceSpace,
          sourceValues: [...color.sourceValues],
          xyz: [...color.xyz],
        });
      }

      // G → Toggle two-color gradient
      if (e.key === 'g' || e.key === 'G') {
        const section = document.getElementById('two-color-gradient');
        if (section) {
          const visible = section.style.display !== 'none';
          section.style.display = visible ? 'none' : 'flex';
          this.state.set('gradient.enabled', !visible);
        }
      }

      // T → Toggle three-color triangle
      if (e.key === 't' || e.key === 'T') {
        const section = document.getElementById('three-color-gradient');
        if (section) {
          const visible = section.style.display !== 'none';
          section.style.display = visible ? 'none' : 'block';
          this.state.set('triangleGradient.enabled', !visible);
        }
      }

      // R → Rotate picker axes
      if (e.key === 'r' || e.key === 'R') {
        const picker = this.state.get('picker');
        const rotation = [
          [0, 1, 2],
          [1, 2, 0],
          [2, 0, 1],
        ];
        const curr = rotation.findIndex(r =>
          r[0] === picker.excluded && r[1] === picker.xAxis && r[2] === picker.yAxis
        );
        const next = rotation[(curr + 1) % 3];
        this.state.batch({
          'picker.excluded': next[0],
          'picker.xAxis': next[1],
          'picker.yAxis': next[2],
        });
      }

      // C → Complement color (rotate hue 180°)
      if (e.key === 'c' && !ctrl) {
        this._setComplement();
      }

      // N → Random color
      if (e.key === 'n' || e.key === 'N') {
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        this._setColorFromSpace([r, g, b], 'srgb');
      }

      // X → Swap X and Y axes
      if (e.key === 'x' || e.key === 'X') {
        const picker = this.state.get('picker');
        this.state.batch({
          'picker.xAxis': picker.yAxis,
          'picker.yAxis': picker.xAxis,
        });
      }

      // E → Eyedropper (alias for I)
      if (e.key === 'e' || e.key === 'E') {
        this.eyedropper.pick();
      }

      // V → Invert color (RGB: 255-R, 255-G, 255-B)
      if (e.key === 'v' && !ctrl) {
        const color = this.state.get('currentColor');
        const rgb = this.engine.convert(color.xyz, 'xyz', 'srgb');
        const inverted = [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
        this._setColorFromSpace(inverted, 'srgb');
      }

      // D → Desaturate to grayscale (set HSB saturation to 0)
      if (e.key === 'd' || e.key === 'D') {
        const color = this.state.get('currentColor');
        const hsb = this.engine.convert(color.xyz, 'xyz', 'hsb');
        hsb[1] = 0;
        this._setColorFromSpace(hsb, 'hsb');
      }

      // L → Lighter (increase HSB brightness by 10, capped at 100)
      if (e.key === 'l' || e.key === 'L') {
        const color = this.state.get('currentColor');
        const hsb = this.engine.convert(color.xyz, 'xyz', 'hsb');
        hsb[2] = Math.min(100, hsb[2] + 10);
        this._setColorFromSpace(hsb, 'hsb');
      }

      // K → Darker (decrease HSB brightness by 10, min 0)
      if (e.key === 'k' || e.key === 'K') {
        const color = this.state.get('currentColor');
        const hsb = this.engine.convert(color.xyz, 'xyz', 'hsb');
        hsb[2] = Math.max(0, hsb[2] - 10);
        this._setColorFromSpace(hsb, 'hsb');
      }
    });
  }

  /**
   * Set the current color to its HSB complement (hue + 180°).
   */
  _setComplement() {
    const color = this.state.get('currentColor');
    const hsb = this.engine.convert(color.xyz, 'xyz', 'hsb');
    hsb[0] = (hsb[0] + 180) % 360;
    const xyz = this.engine.convert(hsb, 'hsb', 'xyz');
    this.state.set('currentColor', {
      xyz,
      sourceSpace: 'hsb',
      sourceValues: hsb,
    });
  }

  // --------------------------------------------------------------------------
  // Quick color buttons
  // --------------------------------------------------------------------------

  _initQuickColors() {
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const hex = btn.dataset.color;
        if (hex) {
          try {
            const parsed = this.engine.fromHex(hex);
            this._setColorFromSpace(parsed.values, parsed.spaceId);
          } catch {}
        }
      });
      btn.draggable = true;
      btn.addEventListener('dragstart', (e) => {
        const hex = btn.dataset.color;
        if (hex) {
          e.dataTransfer.setData('text/plain', hex);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // Color name search — type a CSS color name to jump to that color
  // --------------------------------------------------------------------------

  _initColorNameSearch() {
    const nameSearch = document.getElementById('color-name-search');
    if (!nameSearch) return;

    // Build a <datalist> for browser-native autocomplete
    const datalist = document.createElement('datalist');
    datalist.id = 'color-names-list';
    for (const name of Object.keys(CSS_NAMED)) {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    }
    document.body.appendChild(datalist);
    nameSearch.setAttribute('list', 'color-names-list');

    nameSearch.addEventListener('change', () => {
      const query = nameSearch.value.trim().toLowerCase().replace(/\s+/g, '');
      if (!query) return;

      // Exact match
      const exact = CSS_NAMED[query];
      if (exact) {
        this._setColorFromSpace([...exact], 'srgb');
        nameSearch.value = query;
        return;
      }

      // Partial / substring match — pick the first hit
      const matches = Object.keys(CSS_NAMED).filter(n => n.includes(query));
      if (matches.length > 0) {
        const rgb = CSS_NAMED[matches[0]];
        this._setColorFromSpace([...rgb], 'srgb');
        nameSearch.value = matches[0];
      }
    });
  }

  // --------------------------------------------------------------------------
  // Global drag and drop
  // --------------------------------------------------------------------------

  _initDragDrop() {
    // Allow dropping hex colors onto the main swatch
    const swatch = document.getElementById('current-swatch');
    if (swatch) {
      swatch.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      swatch.addEventListener('drop', (e) => {
        e.preventDefault();
        swatch.classList.remove('drop-highlight');
        const hex = e.dataTransfer.getData('text/plain');
        if (hex && /^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
          const parsed = this.engine.fromHex(hex.trim());
          if (parsed) {
            this._setColorFromSpace(parsed.values, parsed.spaceId);
          }
        }
      });
    }

    // Allow dropping colors onto the saved colors strip
    const strip = document.getElementById('saved-colors-strip');
    if (strip) {
      strip.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      strip.addEventListener('drop', (e) => {
        e.preventDefault();
        strip.classList.remove('drop-highlight');
        // Only handle drops that don't come from within saved colors (reorder)
        const colorIdx = e.dataTransfer.getData('application/x-color-index');
        if (colorIdx) return; // handled by SavedColorsUI

        const hex = e.dataTransfer.getData('text/plain');
        if (hex && /^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
          const parsed = this.engine.fromHex(hex.trim());
          if (parsed) {
            const xyz = this.engine.convert(parsed.values, parsed.spaceId, 'xyz');
            const name = e.dataTransfer.getData('application/x-color-name') || null;
            this.state.addSavedColor({
              sourceSpace: parsed.spaceId,
              sourceValues: parsed.values,
              xyz,
              name,
            });
          }
        }
      });
    }

    // --- A. Make the current color swatch a drag source ---
    // (Don't make canvases draggable — it fights with their mouse interaction)
    // (reuse `swatch` from the drop-target setup above)
    if (swatch) {
      swatch.draggable = true;
      swatch.addEventListener('dragstart', (e) => {
        const color = this.state.get('currentColor');
        const hex = this.engine.toHex(color.sourceValues, color.sourceSpace);
        e.dataTransfer.setData('text/plain', hex);
        e.dataTransfer.effectAllowed = 'copy';
        // Create a small colored drag image
        const img = document.createElement('div');
        img.style.cssText = `width:32px;height:32px;background:${hex};border-radius:4px;position:absolute;top:-999px;`;
        document.body.appendChild(img);
        e.dataTransfer.setDragImage(img, 16, 16);
        setTimeout(() => document.body.removeChild(img), 0);
      });
    }

    // --- B. Make the palette canvas a drop target ---
    const paletteCanvas = document.getElementById('palette-canvas');
    if (paletteCanvas) {
      paletteCanvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      paletteCanvas.addEventListener('drop', (e) => {
        e.preventDefault();
        paletteCanvas.classList.remove('drop-highlight');
        const hex = e.dataTransfer.getData('text/plain');
        if (hex && /^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
          try {
            const parsed = this.engine.fromHex(hex.trim());
            const rect = paletteCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const idx = Math.round((x / rect.width) * 255);
            if (this.paletteEditor) {
              this.paletteEditor.controlPoints.push({
                index: idx,
                color: parsed.values,
              });
              this.paletteEditor._interpolatePalette();
              this.paletteEditor._markDirty();
            }
          } catch {}
        }
      });
    }

    // --- C. Drop color onto 2D picker — changes excluded dimension to match ---
    // Listen on the container (not just the canvas) since overlays may intercept events
    const pickerCanvas = document.getElementById('picker-canvas-container') || document.getElementById('picker-canvas');
    if (pickerCanvas) {
      pickerCanvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      pickerCanvas.addEventListener('drop', (e) => {
        e.preventDefault();
        pickerCanvas.classList.remove('drop-highlight');
        const hex = e.dataTransfer.getData('text/plain');
        if (hex && /^#?[0-9a-fA-F]{3,6}$/.test(hex.trim())) {
          try {
            const parsed = this.engine.fromHex(hex.trim());
            const xyz = this.engine.convert(parsed.values, parsed.spaceId, 'xyz');
            const picker = this.state.get('picker');
            const space = this.engine.spaces.get(picker.spaceId);
            if (space) {
              // Convert dropped color to the picker's space
              const vals = this.engine.convert(xyz, 'xyz', picker.spaceId);
              // Set the excluded dimension to the dropped color's value
              this.state.batch({
                'picker.excludedValue': vals[picker.excluded],
                'currentColor.xyz': xyz,
                'currentColor.sourceSpace': parsed.spaceId,
                'currentColor.sourceValues': parsed.values,
              });
            }
          } catch {}
        }
      });
    }

    // --- E. Visual feedback during drag ---
    const dropTargets = [swatch, strip, paletteCanvas, pickerCanvas].filter(Boolean);
    for (const target of dropTargets) {
      target.addEventListener('dragenter', (e) => {
        e.preventDefault();
        target.classList.add('drop-highlight');
      });
      target.addEventListener('dragleave', () => {
        target.classList.remove('drop-highlight');
      });
      // Also clear on drop (swatch drop handler above doesn't clear it)
      target.addEventListener('drop', () => {
        target.classList.remove('drop-highlight');
      });
    }
  }

  // --------------------------------------------------------------------------
  // Color space picker dialog
  // --------------------------------------------------------------------------

  _initSpacePickerDialog() {
    const dialog = document.getElementById('space-picker-dialog');
    const list = document.getElementById('space-picker-list');
    const addBtn = document.getElementById('btn-add-space');
    const closeBtn = document.getElementById('btn-close-space-picker');

    if (!dialog || !list || !addBtn) return;

    addBtn.addEventListener('click', () => {
      this._renderSpacePickerList();
      dialog.showModal();
    });

    closeBtn?.addEventListener('click', () => dialog.close());

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }

  _renderSpacePickerList() {
    const list = document.getElementById('space-picker-list');
    if (!list) return;

    list.innerHTML = '';
    const activeSpaces = this.state.get('activeSpaces') || [];

    for (const [spaceId, spaceDef] of this.engine.spaces) {
      if (spaceId === 'xyz') continue; // XYZ is internal, don't show in picker

      const item = document.createElement('div');
      const isActive = activeSpaces.includes(spaceId);
      item.className = 'space-picker-item' + (isActive ? ' active' : '');

      const info = document.createElement('div');
      info.innerHTML = `
        <div class="space-name">${spaceDef.name}</div>
        <div class="space-desc">${spaceDef.meta?.description?.substring(0, 80) || ''}...</div>
      `;

      const toggle = document.createElement('div');
      toggle.className = 'space-toggle';

      item.appendChild(info);
      item.appendChild(toggle);

      item.addEventListener('click', () => {
        const current = this.state.get('activeSpaces') || [];
        if (current.includes(spaceId)) {
          // Remove (but keep at least one)
          if (current.length > 1) {
            this.state.set('activeSpaces', current.filter(s => s !== spaceId));
          }
        } else {
          // Add
          this.state.set('activeSpaces', [...current, spaceId]);
        }
        this._renderSpacePickerList();
      });

      list.appendChild(item);
    }
  }

  // --------------------------------------------------------------------------
  // Color setting helpers
  // --------------------------------------------------------------------------

  _addToHistory(hex, color) {
    // Don't add duplicates of the most recent entry
    if (this._colorHistory.length > 0 && this._colorHistory[0].hex === hex) return;
    this._colorHistory.unshift({
      hex,
      sourceSpace: color.sourceSpace,
      sourceValues: [...color.sourceValues],
      xyz: [...color.xyz],
    });
    // Keep max 30
    if (this._colorHistory.length > 30) this._colorHistory.pop();
    this._renderHistory();
  }

  _renderHistory() {
    if (!this._historyStrip) return;
    this._historyStrip.innerHTML = '';
    for (const entry of this._colorHistory) {
      const swatch = document.createElement('div');
      swatch.className = 'history-swatch';
      swatch.style.backgroundColor = entry.hex;
      swatch.title = entry.hex;
      swatch.addEventListener('click', () => {
        this.state.batch({
          'currentColor.xyz': [...entry.xyz],
          'currentColor.sourceSpace': entry.sourceSpace,
          'currentColor.sourceValues': [...entry.sourceValues],
        });
      });
      swatch.draggable = true;
      swatch.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', entry.hex);
        e.dataTransfer.effectAllowed = 'copy';
      });
      this._historyStrip.appendChild(swatch);
    }
  }


  _setColorFromSpace(values, spaceId) {
    try {
      const xyz = this.engine.convert(values, spaceId, 'xyz');
      this.state.batch({
        'currentColor.xyz': xyz,
        'currentColor.sourceSpace': spaceId,
        'currentColor.sourceValues': values,
      });
    } catch (err) {
      console.warn('[App] Failed to set color:', err);
    }
  }

  _selectSavedColor(color) {
    this.state.batch({
      'currentColor.xyz': [...color.xyz],
      'currentColor.sourceSpace': color.sourceSpace,
      'currentColor.sourceValues': [...color.sourceValues],
    });
  }

  _selectCollectionColor(color) {
    try {
      const xyz = this.engine.convert(color.sourceValues, color.sourceSpace, 'xyz');
      this.state.batch({
        'currentColor.xyz': xyz,
        'currentColor.sourceSpace': color.sourceSpace,
        'currentColor.sourceValues': [...color.sourceValues],
      });
    } catch (err) {
      console.warn('[App] Failed to select collection color:', err);
    }
  }

  // --------------------------------------------------------------------------
  // Full render pass
  // --------------------------------------------------------------------------

  _renderAll() {
    // Each component auto-renders on state changes via subscriptions.
    // This method is for the initial render and after cleanSlate().
    // We trigger a synthetic state change to force all components to update.
    const color = this.state.get('currentColor');
    this.state.batch({
      'currentColor.xyz': color.xyz,
      'currentColor.sourceSpace': color.sourceSpace,
      'currentColor.sourceValues': color.sourceValues,
    });
  }
}

// ============================================================================
// Context menu support
// ============================================================================

// Prevent default context menu on canvases (we handle right-click ourselves)
document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'CANVAS' || e.target.closest('.saved-swatch')) {
    e.preventDefault();
  }
});

// Close any open context menus on click elsewhere
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.color-context-menu')) {
    document.querySelectorAll('.color-context-menu').forEach(m => m.remove());
  }
});

// Add context menu styles dynamically
const contextMenuStyle = document.createElement('style');
contextMenuStyle.textContent = `
  .color-context-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    padding: 4px 0;
    min-width: 160px;
  }
  .context-menu-item {
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .context-menu-item:hover {
    background: var(--bg-tertiary);
  }
  .context-menu-item.danger {
    color: var(--danger);
  }
  .context-menu-item.danger:hover {
    background: rgba(217, 74, 74, 0.15);
  }

  /* Dragging states */
  .saved-swatch.dragging {
    opacity: 0.5;
    transform: scale(0.9);
  }
  .saved-swatch.drag-over {
    border-color: var(--accent) !important;
    box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.3);
  }

  .saved-empty-hint {
    font-size: 11px;
    color: var(--text-dim);
    padding: 8px;
    font-style: italic;
  }

  /* Drop-target highlight during drag */
  .drop-highlight {
    outline: 2px dashed var(--accent) !important;
    outline-offset: -2px;
  }
`;
document.head.appendChild(contextMenuStyle);

// ============================================================================
// Launch
// ============================================================================

function boot() {
  if (window.colorPicker) return; // already initialized
  try {
    window.colorPicker = new App();
  } catch (err) {
    console.error('[ColorPicker] FATAL:', err);
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="background:red;color:white;padding:12px;font-family:monospace;position:fixed;top:0;left:0;right:0;z-index:9999">
        Error: ${err.message}<br>Check browser console (F12) for details.
      </div>`);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
