/**
 * ui-3d.js -- 3D color space visualization module
 *
 * ES module. Imports from ./color-engine.js and ./state.js.
 *
 * Renders a WebGL 3D view of any color space as a cube/volume with:
 *   - Wireframe cube outline
 *   - Colored point cloud (~4096 samples)
 *   - Current color marker
 *   - Palette trace (optional)
 *   - Axis labels (canvas 2D overlay)
 *   - Trackball rotation + scroll zoom
 *
 * Exports:
 *   ColorSpace3D  -- main class
 */

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

// ============================================================================
//  Inline 4x4 matrix math (no gl-matrix dependency)
// ============================================================================

function mat4Identity() {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** Multiply two column-major 4x4 matrices: out = a * b. */
function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/** Perspective projection (column-major). */
function mat4Perspective(fovYRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovYRad / 2);
  const nf = 1.0 / (near - far);
  const out = new Float32Array(16);
  out[0]  = f / aspect;
  out[5]  = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/** LookAt view matrix (column-major). */
function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (len > 1e-8) { zx /= len; zy /= len; zz /= len; }

  // x = normalize(cross(up, z))
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (len > 1e-8) { xx /= len; xy /= len; xz /= len; }

  // y = cross(z, x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const out = new Float32Array(16);
  out[0]  = xx; out[1]  = yx; out[2]  = zx; out[3]  = 0;
  out[4]  = xy; out[5]  = yy; out[6]  = zy; out[7]  = 0;
  out[8]  = xz; out[9]  = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/** Rotation about X axis (column-major). */
function mat4RotateX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = mat4Identity();
  out[5] = c;  out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

/** Rotation about Y axis (column-major). */
function mat4RotateY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = mat4Identity();
  out[0] = c;  out[2] = -s;
  out[8] = s;  out[10] = c;
  return out;
}

/** Transform a 3D point by a 4x4 column-major matrix (perspective divide). */
function mat4TransformPoint(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}

// ============================================================================
//  Shaders
// ============================================================================

const VERT_SRC = `
attribute vec3 a_position;
attribute vec4 a_color;
uniform mat4 u_mvp;
uniform float u_pointSize;
varying vec4 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_mvp * vec4(a_position, 1.0);
  gl_PointSize = u_pointSize;
}
`;

const FRAG_SRC = `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = v_color;
}
`;

const LINE_FRAG_SRC = `
precision mediump float;
varying vec4 v_color;
void main() {
  gl_FragColor = v_color;
}
`;

// ============================================================================
//  Wireframe cube geometry (12 edges, 24 vertices)
// ============================================================================

function buildCubeLines() {
  // 8 corners of a [-1,1]^3 cube
  const corners = [
    [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1],
    [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1],
  ];
  // 12 edges as index pairs
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0], // back face
    [4, 5], [5, 6], [6, 7], [7, 4], // front face
    [0, 4], [1, 5], [2, 6], [3, 7], // connecting
  ];
  const positions = [];
  const colors = [];
  for (const [a, b] of edges) {
    positions.push(...corners[a], ...corners[b]);
    // White/gray edges
    colors.push(0.6, 0.6, 0.6, 0.7,  0.6, 0.6, 0.6, 0.7);
  }
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: edges.length * 2,
  };
}

// ============================================================================
//  Space ID to short axis labels
// ============================================================================

const AXIS_LABELS = {
  srgb:     ['R', 'G', 'B'],
  adobergb: ['R', 'G', 'B'],
  xyz:      ['X', 'Y', 'Z'],
  lab:      ['L*', 'a*', 'b*'],
  lch:      ['L*', 'C*', 'h'],
  hsb:      ['H', 'S', 'B'],
  hsl:      ['H', 'S', 'L'],
  cmy:      ['C', 'M', 'Y'],
  lms:      ['L', 'M', 'S'],
  opponent: ['Y-B', 'R-G', 'Br'],
};

// Spaces that should be displayed as cylinders.
// Maps spaceId -> { hue: component index, radius: index, height: index }
const CYLINDER_SPACES = {
  hsb: { hue: 0, radius: 1, height: 2 },  // H=angle, S=radius, B=height
  hsl: { hue: 0, radius: 1, height: 2 },  // H=angle, S=radius, L=height
  lch: { hue: 2, radius: 1, height: 0 },  // h=angle, C=radius, L=height
};

// Sphere mapping: Hue=longitude, Brightness/Lightness=radius, Saturation=latitude
// This gives a color sphere where bright saturated colors are on the surface
// and dark/desaturated colors are near the center
const SPHERE_SPACES = {
  hsb: { hue: 0, sat: 1, val: 2 },  // H=longitude, S=latitude, B=radius
  hsl: { hue: 0, sat: 1, val: 2 },  // H=longitude, S=latitude, L=radius
};

// Global toggle — set by the 3D viewer UI
let useSphereMode = false;

/**
 * Build wireframe for a sphere: circles at equator, meridians, tropics
 */
function buildSphereWireframe() {
  const positions = [];
  const colors = [];
  const gray = [0.5, 0.5, 0.5, 0.5];
  const segs = 32;

  // Three great circles: equator (XZ), and two meridians (XY, YZ)
  for (const plane of [[0,2], [0,1], [1,2]]) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0 = [0, 0, 0], p1 = [0, 0, 0];
      p0[plane[0]] = Math.cos(a0);
      p0[plane[1]] = Math.sin(a0);
      p1[plane[0]] = Math.cos(a1);
      p1[plane[1]] = Math.sin(a1);
      positions.push(...p0, ...p1);
      colors.push(...gray, ...gray);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
}

/**
 * Convert a color space value to 3D position.
 * Supports cube, cylinder, and sphere mappings.
 */
function valueTo3D(values, comps, spaceId) {
  // Sphere mapping (if enabled and supported)
  if (useSphereMode) {
    const sph = SPHERE_SPACES[spaceId];
    if (sph) {
      const hueNorm = (values[sph.hue] - comps[sph.hue].range[0]) /
        (comps[sph.hue].range[1] - comps[sph.hue].range[0]);
      const satNorm = (values[sph.sat] - comps[sph.sat].range[0]) /
        (comps[sph.sat].range[1] - comps[sph.sat].range[0]);
      const valNorm = (values[sph.val] - comps[sph.val].range[0]) /
        (comps[sph.val].range[1] - comps[sph.val].range[0]);

      const lon = hueNorm * Math.PI * 2;
      const lat = (satNorm - 0.5) * Math.PI; // -PI/2 to PI/2
      const r = valNorm; // 0-1
      return [
        r * Math.cos(lat) * Math.cos(lon),
        r * Math.sin(lat),
        r * Math.cos(lat) * Math.sin(lon),
      ];
    }
  }

  // Cylinder mapping
  const cyl = CYLINDER_SPACES[spaceId];
  if (cyl) {
    const hueNorm = (values[cyl.hue] - comps[cyl.hue].range[0]) /
      (comps[cyl.hue].range[1] - comps[cyl.hue].range[0]);
    const radNorm = (values[cyl.radius] - comps[cyl.radius].range[0]) /
      (comps[cyl.radius].range[1] - comps[cyl.radius].range[0]);
    const hgtNorm = (values[cyl.height] - comps[cyl.height].range[0]) /
      (comps[cyl.height].range[1] - comps[cyl.height].range[0]);

    const angle = hueNorm * Math.PI * 2;
    const r = radNorm;  // 0-1
    const y = hgtNorm * 2 - 1; // -1 to 1
    return [r * Math.cos(angle), y, r * Math.sin(angle)];
  }
  // Cube mapping
  return [
    ((values[0] - comps[0].range[0]) / (comps[0].range[1] - comps[0].range[0])) * 2 - 1,
    ((values[1] - comps[1].range[0]) / (comps[1].range[1] - comps[1].range[0])) * 2 - 1,
    ((values[2] - comps[2].range[0]) / (comps[2].range[1] - comps[2].range[0])) * 2 - 1,
  ];
}

/**
 * Generate wireframe geometry for a cylinder: circles at top/bottom + vertical struts.
 */
function buildCylinderWireframe() {
  const positions = [];
  const colors = [];
  const segs = 32;
  const gray = [0.5, 0.5, 0.5, 0.6];

  // Top and bottom circles
  for (const y of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      positions.push(Math.cos(a0), y, Math.sin(a0));
      positions.push(Math.cos(a1), y, Math.sin(a1));
      colors.push(...gray, ...gray);
    }
  }
  // Vertical struts at regular angles
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a), z = Math.sin(a);
    positions.push(x, -1, z, x, 1, z);
    colors.push(...gray, ...gray);
  }
  // Center vertical axis (thin)
  positions.push(0, -1, 0, 0, 1, 0);
  colors.push(0.3, 0.3, 0.3, 0.4, 0.3, 0.3, 0.3, 0.4);

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
}

// ============================================================================
//  ColorSpace3D
// ============================================================================

export class ColorSpace3D {
  /** @type {HTMLElement} */
  #container;
  /** @type {AppState} */
  #state;
  /** @type {ColorEngine} */
  #engine;

  // DOM elements
  #root = null;
  #canvas = null;
  #labelCanvas = null;
  #select = null;

  // WebGL
  #gl = null;
  #program = null;
  #lineProgram = null;
  #uMVP = null;
  #uPointSize = null;
  #lineMVP = null;
  #linePointSize = null;
  #contextLost = false;

  // Buffers
  #cubeVAO = null;      // {posBuf, colBuf, count}
  #cloudVAO = null;     // {posBuf, colBuf, count}
  #markerVAO = null;    // {posBuf, colBuf, count}
  #traceVAO = null;     // {posBuf, colBuf, count}

  // Camera state
  #rotX = -0.5;   // initial tilt
  #rotY = 0.6;    // initial rotation
  #zoom = 4.5;    // distance from origin

  // Interaction
  #dragging = false;
  #lastMouse = [0, 0];

  // Current visualization space
  #spaceId = 'srgb';
  #density = 15;
  #pointSize = 3.0;
  #stereoMode = 'off';  // 'off' | 'anaglyph' | 'crosseyed'
  #dirty = true;
  #rafId = 0;

  // Palette trace data
  #tracePoints = null;

  // Dual-space mode
  #dualMode = false;
  #secondarySpaceId = null;
  #secondaryCloudVAO = null;  // {posBuf, colBuf, count}
  #secondaryWireVAO = null;   // {posBuf, colBuf, count}
  #secondaryTraceVAO = null;  // {posBuf, colBuf, count}
  #secondaryMarkerVAO = null; // {posBuf, colBuf, count}
  #dualSelect = null;

  // Stored image pixel data (persists across space changes)
  #imageRGBs = null;  // Float32Array of [r/255, g/255, b/255, ...] or null
  #imageSRGBs = null; // Uint8Array of [r, g, b, ...] for conversion
  #imageLabel = null;  // HTMLElement showing image name + × button

  // Subscriptions
  #unsubs = [];

  /**
   * @param {HTMLElement} containerEl
   * @param {AppState} state
   * @param {ColorEngine} engine
   */
  constructor(containerEl, state, engine) {
    this.#container = containerEl;
    this.#state = state;
    this.#engine = engine;

    this.#buildDOM();
    if (!this.#initWebGL()) return;
    this.#initBuffers();
    this.#initInteraction();
    this.#initSubscriptions();

    // Populate the dropdowns
    this.#populateSpaceSelect();
    this.#populateDualSelect();

    // Default to picker space
    const pickerSpace = state.get('picker.spaceId');
    if (pickerSpace && engine.spaces.has(pickerSpace)) {
      this.#spaceId = pickerSpace;
      this.#select.value = pickerSpace;
    }

    // Initial point cloud generation + render (defer to let layout settle)
    this.#rebuildCloud();
    this.#updateMarker();

    // ResizeObserver — re-render when the container/panel resizes
    const canvasWrap = this.#canvas.parentElement;
    if (canvasWrap) {
      new ResizeObserver(() => {
        this.#syncCanvasSize();
        this.#markDirty();
      }).observe(canvasWrap);
    }

    // Double-RAF ensures the DOM is laid out before first render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.#syncCanvasSize();
        this.#dirty = false;
        this.#markDirty();
      });
    });
  }

  #syncCanvasSize() {
    // Use the wrapper's size, not the canvas's, to avoid feedback loops
    const wrap = this.#canvas.parentElement;
    const available = wrap ? [wrap.clientWidth, wrap.clientHeight] : [250, 250];
    // Fit square into available space
    const size = Math.max(50, Math.min(available[0], available[1]));
    const w = size;
    const h = size;
    if (this.#canvas.width !== w || this.#canvas.height !== h) {
      this.#canvas.width = w;
      this.#canvas.height = h;
      if (this.#labelCanvas) {
        this.#labelCanvas.width = w;
        this.#labelCanvas.height = h;
      }
    }
  }

  // -----------------------------------------------------------------------
  //  DOM construction
  // -----------------------------------------------------------------------

  #buildDOM() {
    const root = document.createElement('div');
    root.className = 'view3d-section';

    // Header
    const header = document.createElement('div');
    header.className = 'view3d-header';

    const label = document.createElement('span');
    label.textContent = '3D View';

    const select = document.createElement('select');
    select.className = 'view3d-space-select';
    select.addEventListener('change', () => {
      this.#spaceId = select.value;
      this.#rebuildCloud();
      this.#updateMarker();
      this.#updateTrace();
      this.#markDirty();
    });
    this.#select = select;

    // Density slider
    const densityWrap = document.createElement('label');
    densityWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;color:#888;';
    densityWrap.textContent = 'Pts:';
    const densitySlider = document.createElement('input');
    densitySlider.type = 'range';
    densitySlider.min = '8';
    densitySlider.max = '28';
    densitySlider.value = '15';
    densitySlider.title = 'Point density';
    densitySlider.style.cssText = 'width:40px;accent-color:#4a90d9;';
    densitySlider.addEventListener('input', () => {
      this.#density = parseInt(densitySlider.value, 10);
      this.#rebuildCloud();
      this.#markDirty();
    });
    densityWrap.appendChild(densitySlider);

    // Point size slider
    const sizeWrap = document.createElement('label');
    sizeWrap.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;color:#888;';
    sizeWrap.textContent = 'Size:';
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '1';
    sizeSlider.max = '8';
    sizeSlider.value = '3';
    sizeSlider.title = 'Point size';
    sizeSlider.style.cssText = 'width:40px;accent-color:#4a90d9;';
    sizeSlider.addEventListener('input', () => {
      this.#pointSize = parseFloat(sizeSlider.value);
      this.#markDirty();
    });
    sizeWrap.appendChild(sizeSlider);

    // Stereo mode selector
    const stereoSelect = document.createElement('select');
    stereoSelect.style.cssText = 'font-size:10px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;padding:0 2px;height:18px;';
    stereoSelect.title = 'Stereoscopic 3D mode';
    stereoSelect.innerHTML = `
      <option value="off">Mono</option>
      <option value="anaglyph">Red/Cyan</option>
      <option value="anaglyph-by">Blue/Yellow</option>
      <option value="anaglyph-mg">Magenta/Green</option>
      <option value="crosseyed">Cross-eyed</option>
      <option value="parallel">Parallel (wall-eyed)</option>
    `;
    stereoSelect.addEventListener('change', () => {
      this.#stereoMode = stereoSelect.value;
      this.#markDirty();
    });

    // Image indicator (hidden until an image is loaded)
    const imageIndicator = document.createElement('span');
    imageIndicator.style.cssText = 'display:none;font-size:10px;color:#4a90d9;align-items:center;gap:2px;';
    const imageNameSpan = document.createElement('span');
    imageNameSpan.style.cssText = 'max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const imageClearBtn = document.createElement('button');
    imageClearBtn.textContent = '×';
    imageClearBtn.title = 'Unload image, show full color space';
    imageClearBtn.style.cssText = 'background:none;border:none;color:#d94a4a;cursor:pointer;font-size:12px;padding:0 2px;';
    imageClearBtn.addEventListener('click', () => {
      this.#imageRGBs = null;
      this.#imageSRGBs = null;
      imageIndicator.style.display = 'none';
      this.#rebuildCloud();
      this.#markDirty();
    });
    imageIndicator.appendChild(imageNameSpan);
    imageIndicator.appendChild(imageClearBtn);
    this.#imageLabel = { container: imageIndicator, name: imageNameSpan };

    header.appendChild(label);
    header.appendChild(select);
    header.appendChild(imageIndicator);

    // Controls row
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;';

    const imgBtn = document.createElement('button');
    imgBtn.textContent = 'Image';
    imgBtn.title = 'Load an image to visualize its color distribution';
    imgBtn.style.cssText = 'font-size:10px;padding:1px 5px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;cursor:pointer;height:18px;';
    imgBtn.addEventListener('click', () => this.#loadImageDistribution());

    // Palette trace button
    const palBtn = document.createElement('button');
    palBtn.textContent = 'Palette';
    palBtn.title = 'Show current palette as a 3D trace';
    palBtn.style.cssText = 'font-size:10px;padding:1px 5px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;cursor:pointer;height:18px;';
    palBtn.addEventListener('click', () => this.#showPaletteTrace());

    // Sphere mode checkbox (for HSB/HSL)
    const sphereLabel = document.createElement('label');
    sphereLabel.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:10px;color:#888;cursor:pointer;';
    const sphereCheck = document.createElement('input');
    sphereCheck.type = 'checkbox';
    sphereCheck.title = 'Sphere mapping (HSB/HSL: Hue=longitude, Saturation=latitude, Value=radius)';
    sphereCheck.style.cssText = 'margin:0;cursor:pointer;';
    const sphereText = document.createElement('span');
    sphereText.textContent = 'Sphere';
    sphereLabel.appendChild(sphereCheck);
    sphereLabel.appendChild(sphereText);
    sphereCheck.addEventListener('change', () => {
      useSphereMode = sphereCheck.checked;
      this.#rebuildCloud();
      this.#updateMarker();
      this.#updateTrace();
      this.#markDirty();
    });

    // Dual-space checkbox + secondary space dropdown
    const dualLabel = document.createElement('label');
    dualLabel.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:10px;color:#888;cursor:pointer;';
    const dualCheck = document.createElement('input');
    dualCheck.type = 'checkbox';
    dualCheck.title = 'Show two color spaces side by side';
    dualCheck.style.cssText = 'margin:0;cursor:pointer;';
    const dualText = document.createElement('span');
    dualText.textContent = 'Dual';
    dualLabel.appendChild(dualCheck);
    dualLabel.appendChild(dualText);

    const dualSelect = document.createElement('select');
    dualSelect.style.cssText = 'font-size:10px;background:#252545;color:#e0e0f0;border:1px solid #3a3a5a;border-radius:2px;padding:0 2px;height:18px;display:none;';
    dualSelect.title = 'Secondary color space';
    this.#dualSelect = dualSelect;

    dualCheck.addEventListener('change', () => {
      this.#dualMode = dualCheck.checked;
      dualSelect.style.display = dualCheck.checked ? '' : 'none';
      if (this.#dualMode) {
        if (!this.#secondarySpaceId) this.#secondarySpaceId = dualSelect.value;
        this.#rebuildSecondary();
      }
      this.#markDirty();
    });
    dualSelect.addEventListener('change', () => {
      this.#secondarySpaceId = dualSelect.value;
      this.#rebuildSecondary();
      this.#markDirty();
    });

    controls.appendChild(densityWrap);
    controls.appendChild(sizeWrap);
    controls.appendChild(stereoSelect);
    controls.appendChild(imgBtn);
    controls.appendChild(palBtn);
    controls.appendChild(sphereLabel);
    controls.appendChild(dualLabel);
    controls.appendChild(dualSelect);

    // Canvas wrapper
    const wrap = document.createElement('div');
    wrap.className = 'view3d-canvas-wrap';
    wrap.style.position = 'relative';

    wrap.style.width = '100%';
    wrap.style.flex = '1';
    wrap.style.minHeight = '0';

    const canvas = document.createElement('canvas');
    canvas.className = 'view3d-canvas';
    canvas.width = 250;
    canvas.height = 250;
    this.#canvas = canvas;

    const labelCanvas = document.createElement('canvas');
    labelCanvas.className = 'view3d-labels';
    labelCanvas.width = 250;
    labelCanvas.height = 250;
    labelCanvas.style.position = 'absolute';
    labelCanvas.style.top = '0';
    labelCanvas.style.left = '0';
    labelCanvas.style.width = '100%';
    labelCanvas.style.height = '100%';
    labelCanvas.style.pointerEvents = 'none';
    this.#labelCanvas = labelCanvas;

    wrap.appendChild(canvas);
    wrap.appendChild(labelCanvas);
    root.appendChild(header);
    root.appendChild(controls);
    root.appendChild(wrap);

    this.#container.appendChild(root);
    this.#root = root;
  }

  // -----------------------------------------------------------------------
  //  WebGL initialization
  // -----------------------------------------------------------------------

  #initWebGL() {
    const gl = this.#canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.#showFallback();
      return false;
    }
    this.#gl = gl;

    // Context loss handling
    this.#canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.#contextLost = true;
      if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = 0; }
    });
    this.#canvas.addEventListener('webglcontextrestored', () => {
      this.#contextLost = false;
      this.#initWebGL();
      this.#initBuffers();
      this.#rebuildCloud();
      this.#updateMarker();
      this.#updateTrace();
      this.#markDirty();
    });

    // Compile programs
    this.#program = this.#buildProgram(VERT_SRC, FRAG_SRC);
    this.#lineProgram = this.#buildProgram(VERT_SRC, LINE_FRAG_SRC);
    if (!this.#program || !this.#lineProgram) {
      this.#showFallback();
      return false;
    }

    // Uniform locations
    this.#uMVP = gl.getUniformLocation(this.#program, 'u_mvp');
    this.#uPointSize = gl.getUniformLocation(this.#program, 'u_pointSize');
    this.#lineMVP = gl.getUniformLocation(this.#lineProgram, 'u_mvp');
    this.#linePointSize = gl.getUniformLocation(this.#lineProgram, 'u_pointSize');

    // Global GL state
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.08, 0.08, 0.10, 1.0);

    return true;
  }

  #buildProgram(vSrc, fSrc) {
    const gl = this.#gl;
    const vs = this.#compileShader(gl.VERTEX_SHADER, vSrc);
    const fs = this.#compileShader(gl.FRAGMENT_SHADER, fSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[3D] Link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  #compileShader(type, source) {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[3D] Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  #showFallback() {
    const msg = document.createElement('div');
    msg.style.cssText =
      'padding:24px;text-align:center;color:#888;font-size:13px;';
    msg.textContent = 'WebGL required for 3D view';
    if (this.#root) {
      // Replace canvas wrap with message
      const wrap = this.#root.querySelector('.view3d-canvas-wrap');
      if (wrap) wrap.replaceWith(msg);
    }
  }

  // -----------------------------------------------------------------------
  //  Buffer helpers
  // -----------------------------------------------------------------------

  #initBuffers() {
    // Wireframe cube (static)
    const cube = buildCubeLines();
    this.#cubeVAO = this.#createVAO(cube.positions, cube.colors, cube.count);
  }

  /**
   * Upload position + color arrays into a pair of GL buffers.
   * @returns {{posBuf, colBuf, count}}
   */
  #createVAO(positions, colors, count) {
    const gl = this.#gl;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    return { posBuf, colBuf, count };
  }

  /** Replace data in an existing VAO (reuse buffers). */
  #updateVAO(vao, positions, colors, count) {
    const gl = this.#gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, vao.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    vao.count = count;
  }

  // -----------------------------------------------------------------------
  //  Geometry generation
  // -----------------------------------------------------------------------

  #rebuildCloud() {
    // If an image is loaded, re-project it instead of building the regular cloud
    if (this.#imageSRGBs && this.#imageSRGBs.length > 0) {
      this.#projectImageToCloud();
      this.#rebuildWireframe();
      return;
    }

    const space = this.#engine.spaces.get(this.#spaceId);
    if (!space) return;

    const comps = space.components;
    const positions = [];
    const colors = [];
    const cyl = CYLINDER_SPACES[this.#spaceId];

    const addPoint = (values) => {
      const pos = valueTo3D(values, comps, this.#spaceId);
      positions.push(pos[0], pos[1], pos[2]);
      try {
        const rgb = this.#engine.toSRGB(values, this.#spaceId);
        const gamut = this.#engine.classifyColor(values, this.#spaceId);
        colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, gamut.displayable ? 1.0 : 0.25);
      } catch {
        colors.push(0.3, 0.3, 0.3, 0.1);
      }
    };

    if (cyl) {
      // Fibonacci spiral distribution — mathematically optimal even spacing.
      // For each height slice, distribute N points on a disk using the
      // sunflower pattern: angle = i * golden_angle, radius = sqrt(i/N).
      // This eliminates all visible radial spokes and ring patterns.
      const d = this.#density;
      const hSteps = Math.max(4, Math.round(d * 0.7));
      const pointsPerSlice = Math.max(8, Math.round(d * d * 0.5));
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.39996 radians

      for (let hi = 0; hi <= hSteps; hi++) {
        const hgtNorm = hi / hSteps;

        for (let i = 0; i < pointsPerSlice; i++) {
          const rNorm = Math.sqrt((i + 0.5) / pointsPerSlice); // sqrt for area-uniform
          const angle = i * goldenAngle; // golden angle spiral
          const hueNorm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);

          const values = [0, 0, 0];
          values[cyl.hue] = comps[cyl.hue].range[0] + hueNorm * (comps[cyl.hue].range[1] - comps[cyl.hue].range[0]);
          values[cyl.radius] = comps[cyl.radius].range[0] + rNorm * (comps[cyl.radius].range[1] - comps[cyl.radius].range[0]);
          values[cyl.height] = comps[cyl.height].range[0] + hgtNorm * (comps[cyl.height].range[1] - comps[cyl.height].range[0]);

          addPoint(values);
        }
      }
    } else {
      // Cube: uniform grid sampling
      const steps = this.#density;
      for (let xi = 0; xi <= steps; xi++) {
        for (let yi = 0; yi <= steps; yi++) {
          for (let zi = 0; zi <= steps; zi++) {
            const values = [
              comps[0].range[0] + (xi / steps) * (comps[0].range[1] - comps[0].range[0]),
              comps[1].range[0] + (yi / steps) * (comps[1].range[1] - comps[1].range[0]),
              comps[2].range[0] + (zi / steps) * (comps[2].range[1] - comps[2].range[0]),
            ];
            addPoint(values);
          }
        }
      }
    }

    const posArr = new Float32Array(positions);
    const colArr = new Float32Array(colors);
    const count = positions.length / 3;

    if (this.#cloudVAO) {
      this.#updateVAO(this.#cloudVAO, posArr, colArr, count);
    } else {
      this.#cloudVAO = this.#createVAO(posArr, colArr, count);
    }

    // Rebuild wireframe: cylinder for HSB/HSL/LCh, cube for others
    this.#rebuildWireframe();
    if (this.#dualMode) this.#rebuildSecondary();
  }

  #rebuildWireframe() {
    let wf;
    if (useSphereMode && SPHERE_SPACES[this.#spaceId]) {
      wf = buildSphereWireframe();
    } else if (CYLINDER_SPACES[this.#spaceId]) {
      wf = buildCylinderWireframe();
    } else {
      wf = buildCubeLines();
    }
    if (this.#cubeVAO) {
      this.#updateVAO(this.#cubeVAO, wf.positions, wf.colors, wf.count);
    } else {
      this.#cubeVAO = this.#createVAO(wf.positions, wf.colors, wf.count);
    }
  }

  /**
   * Rebuild all secondary-space geometry (cloud, wireframe, marker, trace)
   * for dual-space mode. Mirrors the primary-space build pipeline but
   * targets #secondarySpaceId and stores into #secondary*VAO fields.
   */
  #rebuildSecondary() {
    const sid = this.#secondarySpaceId;
    if (!sid) return;
    const space = this.#engine.spaces.get(sid);
    if (!space) return;
    const comps = space.components;

    // -- Cloud --
    const buildCloud = () => {
      if (this.#imageSRGBs && this.#imageSRGBs.length > 0) {
        // Reproject loaded image into secondary space
        const count = this.#imageSRGBs.length / 3;
        const positions = [];
        for (let i = 0; i < count; i++) {
          const r = this.#imageSRGBs[i * 3], g = this.#imageSRGBs[i * 3 + 1], b = this.#imageSRGBs[i * 3 + 2];
          try {
            const vals = this.#engine.convert([r, g, b], 'srgb', sid);
            const pos = valueTo3D(vals, comps, sid);
            for (let j = 0; j < 3; j++) { if (!isFinite(pos[j])) pos[j] = 0; pos[j] = Math.max(-1.5, Math.min(1.5, pos[j])); }
            positions.push(pos[0], pos[1], pos[2]);
          } catch { positions.push(0, 0, 0); }
        }
        return { positions: new Float32Array(positions), colors: this.#imageRGBs, count };
      }

      const positions = [], colors = [];
      const cyl = CYLINDER_SPACES[sid];
      const addPt = (values) => {
        const pos = valueTo3D(values, comps, sid);
        positions.push(pos[0], pos[1], pos[2]);
        try {
          const rgb = this.#engine.toSRGB(values, sid);
          const gamut = this.#engine.classifyColor(values, sid);
          colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, gamut.displayable ? 1.0 : 0.25);
        } catch { colors.push(0.3, 0.3, 0.3, 0.1); }
      };

      if (cyl) {
        const d = this.#density, hSteps = Math.max(4, Math.round(d * 0.7));
        const pps = Math.max(8, Math.round(d * d * 0.5));
        const ga = Math.PI * (3 - Math.sqrt(5));
        for (let hi = 0; hi <= hSteps; hi++) {
          const hgtNorm = hi / hSteps;
          for (let i = 0; i < pps; i++) {
            const rNorm = Math.sqrt((i + 0.5) / pps);
            const angle = i * ga;
            const hueNorm = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
            const values = [0, 0, 0];
            values[cyl.hue] = comps[cyl.hue].range[0] + hueNorm * (comps[cyl.hue].range[1] - comps[cyl.hue].range[0]);
            values[cyl.radius] = comps[cyl.radius].range[0] + rNorm * (comps[cyl.radius].range[1] - comps[cyl.radius].range[0]);
            values[cyl.height] = comps[cyl.height].range[0] + hgtNorm * (comps[cyl.height].range[1] - comps[cyl.height].range[0]);
            addPt(values);
          }
        }
      } else {
        const steps = this.#density;
        for (let xi = 0; xi <= steps; xi++)
          for (let yi = 0; yi <= steps; yi++)
            for (let zi = 0; zi <= steps; zi++) {
              addPt([
                comps[0].range[0] + (xi / steps) * (comps[0].range[1] - comps[0].range[0]),
                comps[1].range[0] + (yi / steps) * (comps[1].range[1] - comps[1].range[0]),
                comps[2].range[0] + (zi / steps) * (comps[2].range[1] - comps[2].range[0]),
              ]);
            }
      }
      return { positions: new Float32Array(positions), colors: new Float32Array(colors), count: positions.length / 3 };
    };

    const cloud = buildCloud();
    if (this.#secondaryCloudVAO) this.#updateVAO(this.#secondaryCloudVAO, cloud.positions, cloud.colors, cloud.count);
    else this.#secondaryCloudVAO = this.#createVAO(cloud.positions, cloud.colors, cloud.count);

    // -- Wireframe --
    const wf = CYLINDER_SPACES[sid] ? buildCylinderWireframe() : buildCubeLines();
    if (this.#secondaryWireVAO) this.#updateVAO(this.#secondaryWireVAO, wf.positions, wf.colors, wf.count);
    else this.#secondaryWireVAO = this.#createVAO(wf.positions, wf.colors, wf.count);

    // -- Marker --
    const color = this.#state.get('currentColor');
    if (color) {
      try {
        const vals = this.#engine.convert(color.sourceValues, color.sourceSpace, sid);
        const pos = valueTo3D(vals, comps, sid);
        for (let i = 0; i < 3; i++) { if (!isFinite(pos[i])) pos[i] = 0; pos[i] = Math.max(-1.5, Math.min(1.5, pos[i])); }
        const mPos = new Float32Array([...pos, ...pos]);
        const mCol = new Float32Array([1, 1, 1, 0.35, 1, 1, 1, 1]);
        if (this.#secondaryMarkerVAO) this.#updateVAO(this.#secondaryMarkerVAO, mPos, mCol, 2);
        else this.#secondaryMarkerVAO = this.#createVAO(mPos, mCol, 2);
      } catch { /* skip marker */ }
    }

    // -- Trace --
    if (this.#tracePoints && this.#tracePoints.length >= 2) {
      const tPos = [], tCol = [];
      for (const entry of this.#tracePoints) {
        try {
          const vals = this.#engine.convert(entry.sourceValues, entry.sourceSpace, sid);
          const pos = valueTo3D(vals, comps, sid);
          for (let i = 0; i < 3; i++) { if (!isFinite(pos[i])) pos[i] = 0; pos[i] = Math.max(-1.5, Math.min(1.5, pos[i])); }
          tPos.push(...pos);
        } catch { tPos.push(0, 0, 0); }
        const rgb = this.#engine.toSRGB(entry.sourceValues, entry.sourceSpace);
        tCol.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1.0);
      }
      const tpArr = new Float32Array(tPos), tcArr = new Float32Array(tCol);
      if (this.#secondaryTraceVAO) this.#updateVAO(this.#secondaryTraceVAO, tpArr, tcArr, this.#tracePoints.length);
      else this.#secondaryTraceVAO = this.#createVAO(tpArr, tcArr, this.#tracePoints.length);
    } else if (this.#secondaryTraceVAO) {
      this.#secondaryTraceVAO.count = 0;
    }
  }

  #updateMarker() {
    const color = this.#state.get('currentColor');
    if (!color) return;

    const space = this.#engine.spaces.get(this.#spaceId);
    if (!space) return;

    // Convert current color to this space
    const vals = this.#engine.convert(color.sourceValues, color.sourceSpace, this.#spaceId);
    const comps = space.components;

    // Map to 3D position (cylindrical or cube)
    const pos = valueTo3D(vals, comps, this.#spaceId);

    // Clamp
    for (let i = 0; i < 3; i++) {
      if (!isFinite(pos[i])) pos[i] = 0;
      pos[i] = Math.max(-1.5, Math.min(1.5, pos[i]));
    }

    // Marker: a single point drawn large with white + glow halo
    // We draw two points: a larger dim white halo, and a smaller bright white core
    const positions = new Float32Array([
      ...pos,   // halo
      ...pos,   // core
    ]);
    const colors = new Float32Array([
      1.0, 1.0, 1.0, 0.35,  // halo
      1.0, 1.0, 1.0, 1.0,   // core
    ]);

    if (this.#markerVAO) {
      this.#updateVAO(this.#markerVAO, positions, colors, 2);
    } else {
      this.#markerVAO = this.#createVAO(positions, colors, 2);
    }
    if (this.#dualMode) this.#rebuildSecondary();
  }

  #updateTrace() {
    if (!this.#tracePoints || this.#tracePoints.length < 2) {
      if (this.#traceVAO) this.#traceVAO.count = 0;
      return;
    }

    const space = this.#engine.spaces.get(this.#spaceId);
    if (!space) return;
    const comps = space.components;

    const positions = [];
    const colors = [];

    for (const entry of this.#tracePoints) {
      // Each entry: { sourceSpace, sourceValues, xyz } (same shape as savedColor)
      try {
        const vals = this.#engine.convert(
          entry.sourceValues, entry.sourceSpace, this.#spaceId
        );
        const pos = valueTo3D(vals, comps, this.#spaceId);
        for (let i = 0; i < 3; i++) {
          if (!isFinite(pos[i])) pos[i] = 0;
          pos[i] = Math.max(-1.5, Math.min(1.5, pos[i]));
        }
        positions.push(...pos);
      } catch {
        positions.push(0, 0, 0);
      }

      // Color: actual sRGB color of this palette entry
      const rgb = this.#engine.toSRGB(entry.sourceValues, entry.sourceSpace);
      colors.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1.0);
    }

    const posArr = new Float32Array(positions);
    const colArr = new Float32Array(colors);
    const count = this.#tracePoints.length;

    if (this.#traceVAO) {
      this.#updateVAO(this.#traceVAO, posArr, colArr, count);
    } else {
      this.#traceVAO = this.#createVAO(posArr, colArr, count);
    }
    if (this.#dualMode) this.#rebuildSecondary();
  }

  // -----------------------------------------------------------------------
  //  Public API: set palette trace
  // -----------------------------------------------------------------------

  /**
   * Set the palette trace points. Each entry should have
   * { sourceSpace, sourceValues } at minimum.
   * @param {Array<{sourceSpace:string, sourceValues:number[]}>|null} points
   */
  setTrace(points) {
    this.#tracePoints = points && points.length >= 2 ? points : null;
    this.#updateTrace();
    this.#markDirty();
  }

  /**
   * Read the current palette from the palette editor and display it as a 3D trace.
   */
  #showPaletteTrace() {
    const paletteEditor = window.colorPicker?.paletteEditor;
    if (!paletteEditor) return;
    const palette = paletteEditor.getRotatedPalette(); // [[r,g,b], ...]
    if (!palette || palette.length < 2) return;
    const tracePoints = palette.map(([r, g, b]) => ({
      sourceSpace: 'srgb',
      sourceValues: [r, g, b],
    }));
    this.setTrace(tracePoints);
  }

  // -----------------------------------------------------------------------
  //  Image color distribution
  // -----------------------------------------------------------------------

  #loadImageDistribution() {
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
          this.#buildImageCloud(img);
          document.body.removeChild(input);
        };
        img.onerror = () => document.body.removeChild(input);
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  #buildImageCloud(img) {
    // Downsample and read pixels
    const maxDim = 128;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale); h = Math.round(h * scale);
    }
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w; tmpCanvas.height = h;
    const ctx = tmpCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const allPixels = ctx.getImageData(0, 0, w, h).data;

    // Sample pixels (max ~4000)
    const totalPixels = w * h;
    const step = Math.max(1, Math.floor(totalPixels / 4000));

    // Store the sampled sRGB values so we can re-project when the space changes
    const rgbs = [];    // [r/255, g/255, b/255, ...] for GL colors
    const srgbs = [];   // [r, g, b, ...] for conversion
    for (let i = 0; i < totalPixels; i += step) {
      const r = allPixels[i * 4], g = allPixels[i * 4 + 1], b = allPixels[i * 4 + 2];
      if (allPixels[i * 4 + 3] < 128) continue;
      rgbs.push(r / 255, g / 255, b / 255, 1.0);
      srgbs.push(r, g, b);
    }

    this.#imageRGBs = new Float32Array(rgbs);
    this.#imageSRGBs = new Uint8Array(srgbs);

    // Show the image indicator
    if (this.#imageLabel) {
      this.#imageLabel.name.textContent = img.src.length > 30 ? 'image' : (img.src.split('/').pop() || 'image');
      this.#imageLabel.container.style.display = 'flex';
    }

    // Project into current space
    this.#projectImageToCloud();
  }

  /** Re-project stored image pixels into the current 3D space. */
  #projectImageToCloud() {
    if (!this.#imageSRGBs || this.#imageSRGBs.length === 0) return;

    const space = this.#engine.spaces.get(this.#spaceId);
    if (!space) return;
    const comps = space.components;
    const count = this.#imageSRGBs.length / 3;

    const positions = [];
    for (let i = 0; i < count; i++) {
      const r = this.#imageSRGBs[i * 3];
      const g = this.#imageSRGBs[i * 3 + 1];
      const b = this.#imageSRGBs[i * 3 + 2];
      try {
        const vals = this.#engine.convert([r, g, b], 'srgb', this.#spaceId);
        const pos = valueTo3D(vals, comps, this.#spaceId);
        for (let j = 0; j < 3; j++) {
          if (!isFinite(pos[j])) pos[j] = 0;
          pos[j] = Math.max(-1.5, Math.min(1.5, pos[j]));
        }
        positions.push(pos[0], pos[1], pos[2]);
      } catch {
        positions.push(0, 0, 0);
      }
    }

    const posArr = new Float32Array(positions);
    if (this.#cloudVAO) {
      this.#updateVAO(this.#cloudVAO, posArr, this.#imageRGBs, count);
    } else {
      this.#cloudVAO = this.#createVAO(posArr, this.#imageRGBs, count);
    }
    this.#markDirty();
  }

  // -----------------------------------------------------------------------
  //  Rendering
  // -----------------------------------------------------------------------

  #markDirty() {
    this.#dirty = true;
    if (!this.#rafId) {
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = 0;
        if (this.#dirty) {
          this.#dirty = false;
          this.#render();
          // If still dragging, keep the loop going
          if (this.#dragging) this.#markDirty();
        }
      });
    }
  }

  #render() {
    if (!this.#gl) return;
    if (this.#gl.isContextLost()) { this.#contextLost = true; return; }

    const gl = this.#gl;
    this.#syncCanvasSize();
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    gl.viewport(0, 0, w, h);

    const eyeSep = 0.15;

    if (this.#stereoMode.startsWith('anaglyph')) {
      // Anaglyph stereo with configurable channel masks
      const masks = {
        'anaglyph':    { left: [true,false,false,true], right: [false,true,true,true] },   // Red/Cyan
        'anaglyph-by': { left: [false,false,true,true], right: [true,true,false,true] },   // Blue/Yellow
        'anaglyph-mg': { left: [true,false,true,true],  right: [false,true,false,true] },  // Magenta/Green
      };
      const m = masks[this.#stereoMode] || masks['anaglyph'];
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.colorMask(...m.left);
      this.#drawScene(gl, this.#buildMVP(w, h, -eyeSep / 2));
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.colorMask(...m.right);
      this.#drawScene(gl, this.#buildMVP(w, h, eyeSep / 2));
      gl.colorMask(true, true, true, true);
      this.#drawLabels(this.#buildMVP(this.#canvas.clientWidth || w, this.#canvas.clientHeight || h, 0), w, h);

    } else if (this.#stereoMode === 'crosseyed' || this.#stereoMode === 'parallel') {
      // Side-by-side stereo pair
      // Cross-eyed: left half = right eye, right half = left eye
      // Parallel (wall-eyed): left half = left eye, right half = right eye
      const swapped = this.#stereoMode === 'crosseyed';
      const leftEye = swapped ? eyeSep / 2 : -eyeSep / 2;
      const rightEye = swapped ? -eyeSep / 2 : eyeSep / 2;

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const halfW = Math.floor(w / 2);

      gl.viewport(0, 0, halfW, h);
      gl.scissor(0, 0, halfW, h);
      gl.enable(gl.SCISSOR_TEST);
      this.#drawScene(gl, this.#buildMVP(halfW, h, leftEye));

      gl.viewport(halfW, 0, w - halfW, h);
      gl.scissor(halfW, 0, w - halfW, h);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.#drawScene(gl, this.#buildMVP(w - halfW, h, rightEye));

      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, w, h);
      this.#drawLabels(this.#buildMVP(this.#canvas.clientWidth || w, this.#canvas.clientHeight || h, 0), w, h);

    } else if (this.#dualMode && this.#secondaryCloudVAO) {
      // Dual-space: left half = primary space, right half = secondary space
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const halfW = Math.floor(w / 2);

      gl.viewport(0, 0, halfW, h);
      gl.scissor(0, 0, halfW, h);
      gl.enable(gl.SCISSOR_TEST);
      this.#drawScene(gl, this.#buildMVP(halfW, h, 0));

      gl.viewport(halfW, 0, w - halfW, h);
      gl.scissor(halfW, 0, w - halfW, h);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      this.#drawSecondaryScene(gl, this.#buildMVP(w - halfW, h, 0));

      gl.disable(gl.SCISSOR_TEST);
      gl.viewport(0, 0, w, h);
      this.#drawDualLabels(w, h);

    } else {
      // Normal mono rendering
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.#drawScene(gl, this.#buildMVP(w, h, 0));
      this.#drawLabels(this.#buildMVP(this.#canvas.clientWidth || w, this.#canvas.clientHeight || h, 0), w, h);
    }
  }

  /** Draw all scene geometry (shared by normal and anaglyph paths). */
  #drawScene(gl, mvp) {
    this.#drawLines(this.#cubeVAO, mvp);
    this.#drawPoints(this.#cloudVAO, mvp, this.#pointSize);

    if (this.#traceVAO && this.#traceVAO.count >= 2) {
      this.#drawLineStrip(this.#traceVAO, mvp);
      this.#drawPoints(this.#traceVAO, mvp, 6.0);
    }

    if (this.#markerVAO && this.#markerVAO.count > 0) {
      gl.useProgram(this.#program);
      gl.uniformMatrix4fv(this.#uMVP, false, mvp);
      gl.uniform1f(this.#uPointSize, 16.0);
      this.#bindVAO(this.#program, this.#markerVAO);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.uniform1f(this.#uPointSize, 8.0);
      gl.drawArrays(gl.POINTS, 1, 1);
    }
  }

  /** Draw secondary-space geometry for dual mode. */
  #drawSecondaryScene(gl, mvp) {
    this.#drawLines(this.#secondaryWireVAO, mvp);
    this.#drawPoints(this.#secondaryCloudVAO, mvp, this.#pointSize);

    if (this.#secondaryTraceVAO && this.#secondaryTraceVAO.count >= 2) {
      this.#drawLineStrip(this.#secondaryTraceVAO, mvp);
      this.#drawPoints(this.#secondaryTraceVAO, mvp, 6.0);
    }

    if (this.#secondaryMarkerVAO && this.#secondaryMarkerVAO.count > 0) {
      gl.useProgram(this.#program);
      gl.uniformMatrix4fv(this.#uMVP, false, mvp);
      gl.uniform1f(this.#uPointSize, 16.0);
      this.#bindVAO(this.#program, this.#secondaryMarkerVAO);
      gl.drawArrays(gl.POINTS, 0, 1);
      gl.uniform1f(this.#uPointSize, 8.0);
      gl.drawArrays(gl.POINTS, 1, 1);
    }
  }

  /** Draw axis labels for both halves in dual mode. */
  #drawDualLabels(w, h) {
    const ctx = this.#labelCanvas.getContext('2d');
    if (!ctx) return;
    const cw = this.#canvas.clientWidth || w;
    const ch = this.#canvas.clientHeight || h;

    this.#labelCanvas.style.width = cw + 'px';
    this.#labelCanvas.style.height = ch + 'px';
    if (this.#labelCanvas.width !== cw || this.#labelCanvas.height !== ch) {
      this.#labelCanvas.width = cw;
      this.#labelCanvas.height = ch;
    }
    ctx.clearRect(0, 0, cw, ch);

    // Space name labels at top of each half
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const primaryName = this.#engine.spaces.get(this.#spaceId)?.name || this.#spaceId;
    const secondaryName = this.#engine.spaces.get(this.#secondarySpaceId)?.name || this.#secondarySpaceId;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(primaryName, cw / 4 + 1, 5);
    ctx.fillText(secondaryName, cw * 3 / 4 + 1, 5);
    ctx.fillStyle = '#bbc';
    ctx.fillText(primaryName, cw / 4, 4);
    ctx.fillText(secondaryName, cw * 3 / 4, 4);
  }

  #buildMVP(w, h, eyeOffset = 0) {
    const aspect = w / h;
    const proj = mat4Perspective(45 * Math.PI / 180, aspect, 0.1, 100.0);
    const eye = [eyeOffset, 0, this.#zoom];
    const view = mat4LookAt(eye, [0, 0, 0], [0, 1, 0]);
    const rotX = mat4RotateX(this.#rotX);
    const rotY = mat4RotateY(this.#rotY);
    const model = mat4Multiply(rotX, rotY);
    const mv = mat4Multiply(view, model);
    return mat4Multiply(proj, mv);
  }

  #bindVAO(program, vao) {
    const gl = this.#gl;
    const aPos = gl.getAttribLocation(program, 'a_position');
    const aCol = gl.getAttribLocation(program, 'a_color');

    gl.bindBuffer(gl.ARRAY_BUFFER, vao.posBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vao.colBuf);
    gl.enableVertexAttribArray(aCol);
    gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, 0, 0);
  }

  #drawPoints(vao, mvp, size) {
    if (!vao || vao.count === 0) return;
    const gl = this.#gl;
    gl.useProgram(this.#program);
    gl.uniformMatrix4fv(this.#uMVP, false, mvp);
    gl.uniform1f(this.#uPointSize, size);
    this.#bindVAO(this.#program, vao);
    gl.drawArrays(gl.POINTS, 0, vao.count);
  }

  #drawLines(vao, mvp) {
    if (!vao || vao.count === 0) return;
    const gl = this.#gl;
    gl.useProgram(this.#lineProgram);
    gl.uniformMatrix4fv(this.#lineMVP, false, mvp);
    gl.uniform1f(this.#linePointSize, 1.0);
    this.#bindVAO(this.#lineProgram, vao);
    gl.drawArrays(gl.LINES, 0, vao.count);
  }

  #drawLineStrip(vao, mvp) {
    if (!vao || vao.count < 2) return;
    const gl = this.#gl;
    gl.useProgram(this.#lineProgram);
    gl.uniformMatrix4fv(this.#lineMVP, false, mvp);
    gl.uniform1f(this.#linePointSize, 1.0);
    this.#bindVAO(this.#lineProgram, vao);
    gl.drawArrays(gl.LINE_STRIP, 0, vao.count);
  }

  // -----------------------------------------------------------------------
  //  Axis labels (2D canvas overlay)
  // -----------------------------------------------------------------------

  #drawLabels(mvp, _w, _h) {
    const ctx = this.#labelCanvas.getContext('2d');
    if (!ctx) return;

    // Use the WebGL canvas's CSS display size — that's where the 3D content appears
    const w = this.#canvas.clientWidth || _w;
    const h = this.#canvas.clientHeight || _h;

    // Position the label canvas to exactly overlay the WebGL canvas
    this.#labelCanvas.style.width = w + 'px';
    this.#labelCanvas.style.height = h + 'px';

    if (this.#labelCanvas.width !== w || this.#labelCanvas.height !== h) {
      this.#labelCanvas.width = w;
      this.#labelCanvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labels = AXIS_LABELS[this.#spaceId] || ['?', '?', '?'];
    const cyl = CYLINDER_SPACES[this.#spaceId];

    const drawLabel = (text, pos3d) => {
      const ndc = mat4TransformPoint(mvp, pos3d);
      const px = (ndc[0] * 0.5 + 0.5) * w;
      const py = (-ndc[1] * 0.5 + 0.5) * h;
      if (px < -20 || px > w + 20 || py < -20 || py > h + 20) return;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(text, px + 1, py + 1);
      ctx.fillStyle = '#ddd';
      ctx.fillText(text, px, py);
    };

    if (cyl) {
      // Cylindrical: label height axis + cardinal hue directions
      const heightLabel = labels[cyl.height];
      drawLabel(heightLabel, [0, 1.3, 0]);    // top
      drawLabel('0°', [1.2, 0, 0]);           // hue = 0
      drawLabel('90°', [0, 0, 1.2]);          // hue = 90
      drawLabel('180°', [-1.2, 0, 0]);        // hue = 180
      drawLabel('270°', [0, 0, -1.2]);        // hue = 270
    } else {
      // Cube: label three orthogonal axes
      const tips = [
        [1.2,  0,    0],
        [0,    1.2,  0],
        [0,    0,    1.2],
      ];
      for (let i = 0; i < 3; i++) {
        drawLabel(labels[i], tips[i]);
      }
    }
  }

  // -----------------------------------------------------------------------
  //  Interaction: trackball drag + scroll zoom
  // -----------------------------------------------------------------------

  #initInteraction() {
    const canvas = this.#canvas;

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.#dragging = true;
      this.#lastMouse = [e.clientX, e.clientY];
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.#dragging) return;
      const dx = e.clientX - this.#lastMouse[0];
      const dy = e.clientY - this.#lastMouse[1];
      this.#lastMouse = [e.clientX, e.clientY];

      this.#rotY += dx * 0.008;
      this.#rotX += dy * 0.008;

      // Clamp vertical rotation to avoid flipping
      this.#rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.#rotX));

      this.#markDirty();
    });

    canvas.addEventListener('pointerup', () => {
      this.#dragging = false;
    });
    canvas.addEventListener('pointercancel', () => {
      this.#dragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.#zoom += e.deltaY * 0.005;
      this.#zoom = Math.max(2.0, Math.min(12.0, this.#zoom));
      this.#markDirty();
    }, { passive: false });
  }

  // -----------------------------------------------------------------------
  //  Space selector dropdown
  // -----------------------------------------------------------------------

  #populateSpaceSelect() {
    const select = this.#select;
    select.innerHTML = '';
    for (const [id, def] of this.#engine.spaces) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = def.name;
      select.appendChild(opt);
    }
    select.value = this.#spaceId;
  }

  #populateDualSelect() {
    const select = this.#dualSelect;
    if (!select) return;
    select.innerHTML = '';
    // Default secondary to a different space than primary
    let firstOther = null;
    for (const [id, def] of this.#engine.spaces) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = def.name;
      select.appendChild(opt);
      if (!firstOther && id !== this.#spaceId) firstOther = id;
    }
    this.#secondarySpaceId = firstOther || this.#spaceId;
    select.value = this.#secondarySpaceId;
  }

  // -----------------------------------------------------------------------
  //  State subscriptions
  // -----------------------------------------------------------------------

  #initSubscriptions() {
    // Current color changes -> update marker
    this.#unsubs.push(
      this.#state.subscribe('currentColor', () => {
        this.#updateMarker();
        this.#markDirty();
      })
    );

    // Picker space changes -> optionally auto-switch
    this.#unsubs.push(
      this.#state.subscribe('picker.spaceId', (newSpace) => {
        if (newSpace && this.#engine.spaces.has(newSpace)) {
          this.#spaceId = newSpace;
          this.#select.value = newSpace;
          this.#rebuildCloud();
          this.#updateMarker();
          this.#updateTrace();
          this.#markDirty();
        }
      })
    );

    // Saved colors -> update trace if we are showing it
    this.#unsubs.push(
      this.#state.subscribe('savedColors', (savedColors) => {
        if (savedColors && savedColors.length >= 2) {
          this.#tracePoints = savedColors;
          this.#updateTrace();
          this.#markDirty();
        } else {
          this.#tracePoints = null;
          if (this.#traceVAO) this.#traceVAO.count = 0;
          this.#markDirty();
        }
      })
    );
  }

  // -----------------------------------------------------------------------
  //  Cleanup
  // -----------------------------------------------------------------------

  destroy() {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs.length = 0;
    if (this.#rafId) { cancelAnimationFrame(this.#rafId); this.#rafId = 0; }
    if (this.#root && this.#root.parentNode) {
      this.#root.parentNode.removeChild(this.#root);
    }
    // WebGL resources are freed when the canvas is removed from DOM
    this.#gl = null;
  }
}
