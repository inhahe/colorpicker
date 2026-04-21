/**
 * gl-renderer.js — WebGL-accelerated gradient renderer
 *
 * Moves all per-pixel color-space conversion onto the GPU via fragment shaders.
 * A 400x400 picker goes from ~160,000 JS color conversions per frame to a
 * single draw call.  The GPU computes all pixels in parallel.
 *
 * Exports:
 *   PickerGLRenderer  — renders the 2D picker gradient
 *   SliderGLRenderer  — renders 1D slider gradients
 */

// ============================================================================
//  Shared GLSL code: color-space conversions (all 9 spaces)
// ============================================================================

const GLSL_COLOR_LIB = /* glsl */ `
precision highp float;

// ---------- Constants ----------

const float PI = 3.14159265359;
const float DEG2RAD = PI / 180.0;

// D65 white point (sRGB reference)
const vec3 D65 = vec3(0.95047, 1.0, 1.08883);

// sRGB gamma
const float SRGB_THRESH_INV = 0.04045;
const float SRGB_THRESH_FWD = 0.0031308;

// ---------- Matrices (GLSL mat3 is COLUMN-major) ----------

// sRGB linear → XYZ  (row-major in literature, transposed here for GLSL)
const mat3 M_SRGB_TO_XYZ = mat3(
  0.4124564, 0.2126729, 0.0193339,   // col 0
  0.3575761, 0.7151522, 0.1191920,   // col 1
  0.1804375, 0.0721750, 0.9503041    // col 2
);

// XYZ → sRGB linear
const mat3 M_XYZ_TO_SRGB = mat3(
  3.2404542, -0.9692660,  0.0556434,
 -1.5371385,  1.8760108, -0.2040259,
 -0.4985314,  0.0415560,  1.0572252
);

// Adobe RGB linear → XYZ
const mat3 M_ADOBERGB_TO_XYZ = mat3(
  0.5767309, 0.2973769, 0.0270343,
  0.1855540, 0.6273491, 0.0706872,
  0.1881852, 0.0752741, 0.9911085
);

// XYZ → LMS (Hunt-Pointer-Estevez)
const mat3 M_XYZ_TO_LMS = mat3(
  0.4002400, -0.2263000, 0.0,
  0.7076000,  1.1653200, 0.0,
 -0.0808100,  0.0457000, 0.9182200
);

// LMS → XYZ (inverse of above)
const mat3 M_LMS_TO_XYZ = mat3(
  1.8600666, 0.3612229, 0.0,
 -1.1294801, 0.6388043, 0.0,
  0.2198983,-0.0000064, 1.0890636
);

// (Bradford D50→D65 matrix removed — Lab now uses D65 directly)

// ---------- sRGB gamma ----------

float srgbToLinear(float v) {
  return v <= SRGB_THRESH_INV
    ? v / 12.92
    : pow((v + 0.055) / 1.055, 2.4);
}

vec3 srgbToLinearV(vec3 v) {
  return vec3(srgbToLinear(v.x), srgbToLinear(v.y), srgbToLinear(v.z));
}

float linearToSrgb(float v) {
  return v <= SRGB_THRESH_FWD
    ? v * 12.92
    : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

vec3 linearToSrgbV(vec3 v) {
  return vec3(linearToSrgb(v.x), linearToSrgb(v.y), linearToSrgb(v.z));
}

// ---------- Space → XYZ conversions ----------

// sRGB [0-255] → XYZ
vec3 srgbToXYZ(vec3 v) {
  vec3 lin = srgbToLinearV(v / 255.0);
  return M_SRGB_TO_XYZ * lin;
}

// Adobe RGB [0-255] → XYZ
vec3 adobergbToXYZ(vec3 v) {
  vec3 lin = pow(clamp(v / 255.0, 0.0, 1.0), vec3(2.19921875));
  return M_ADOBERGB_TO_XYZ * lin;
}

// XYZ → XYZ (identity)
vec3 xyzToXYZ(vec3 v) { return v; }

// L*a*b* → XYZ (D65 direct — no chromatic adaptation needed since sRGB is D65)
vec3 labToXYZ(vec3 v) {
  float L = v.x, a = v.y, b = v.z;
  float fy = (L + 16.0) / 116.0;
  float fx = a / 500.0 + fy;
  float fz = fy - b / 200.0;

  float delta = 6.0 / 29.0;
  float k     = 3.0 * delta * delta;

  float x = fx > delta ? fx*fx*fx : k * (fx - 4.0/29.0);
  float y = fy > delta ? fy*fy*fy : k * (fy - 4.0/29.0);
  float z = fz > delta ? fz*fz*fz : k * (fz - 4.0/29.0);

  return vec3(x * D65.x, y * D65.y, z * D65.z);
}

// LCh → XYZ (polar L*a*b*)
vec3 lchToXYZ(vec3 v) {
  float L = v.x, C = v.y, h = v.z;
  float a = C * cos(h * DEG2RAD);
  float b = C * sin(h * DEG2RAD);
  return labToXYZ(vec3(L, a, b));
}

// HSB [H:0-360, S:0-100, B:0-100] → XYZ (via sRGB)
vec3 hsbToXYZ(vec3 v) {
  float H = mod(v.x, 360.0);
  float S = v.y / 100.0;
  float V = v.z / 100.0;
  float C = V * S;
  float hSeg = H / 60.0;
  float X = C * (1.0 - abs(mod(hSeg, 2.0) - 1.0));
  float m = V - C;

  vec3 rgb;
  if      (hSeg < 1.0) rgb = vec3(C, X, 0.0);
  else if (hSeg < 2.0) rgb = vec3(X, C, 0.0);
  else if (hSeg < 3.0) rgb = vec3(0.0, C, X);
  else if (hSeg < 4.0) rgb = vec3(0.0, X, C);
  else if (hSeg < 5.0) rgb = vec3(X, 0.0, C);
  else                  rgb = vec3(C, 0.0, X);
  rgb += m;

  // rgb is already in sRGB gamma space 0-1, linearize
  return M_SRGB_TO_XYZ * srgbToLinearV(rgb);
}

// HSL [H:0-360, S:0-100, L:0-100] → XYZ (via sRGB)
vec3 hslToXYZ(vec3 v) {
  float H = mod(v.x, 360.0);
  float S = v.y / 100.0;
  float L = v.z / 100.0;
  float C = (1.0 - abs(2.0 * L - 1.0)) * S;
  float hSeg = H / 60.0;
  float X = C * (1.0 - abs(mod(hSeg, 2.0) - 1.0));
  float m = L - C / 2.0;

  vec3 rgb;
  if      (hSeg < 1.0) rgb = vec3(C, X, 0.0);
  else if (hSeg < 2.0) rgb = vec3(X, C, 0.0);
  else if (hSeg < 3.0) rgb = vec3(0.0, C, X);
  else if (hSeg < 4.0) rgb = vec3(0.0, X, C);
  else if (hSeg < 5.0) rgb = vec3(X, 0.0, C);
  else                  rgb = vec3(C, 0.0, X);
  rgb += m;

  return M_SRGB_TO_XYZ * srgbToLinearV(rgb);
}

// CMY [0-255] → XYZ
vec3 cmyToXYZ(vec3 v) {
  vec3 srgb = (255.0 - v) / 255.0;
  return M_SRGB_TO_XYZ * srgbToLinearV(srgb);
}

// LMS [0-1] → XYZ
vec3 lmsToXYZ(vec3 v) {
  return M_LMS_TO_XYZ * v;
}

// Color Opponent [YB:-50..50, RG:-30..30, Br:0..100] → XYZ
vec3 opponentToXYZ(vec3 v) {
  float yb = v.x, rg = v.y, br = v.z;
  float half_val = br / 100.0;
  float diff = rg / 100.0;
  float L = max(0.0, half_val + diff / 2.0);
  float M = max(0.0, half_val - diff / 2.0);
  float S = max(0.0, half_val - yb / 100.0);
  return M_LMS_TO_XYZ * vec3(L, M, S);
}

// ---------- Dispatcher ----------

vec3 spaceToXYZ(vec3 v, int space) {
  if (space == 0) return srgbToXYZ(v);
  if (space == 1) return adobergbToXYZ(v);
  if (space == 2) return xyzToXYZ(v);
  if (space == 3) return labToXYZ(v);
  if (space == 4) return lchToXYZ(v);
  if (space == 5) return hsbToXYZ(v);
  if (space == 6) return hslToXYZ(v);
  if (space == 7) return cmyToXYZ(v);
  if (space == 8) return lmsToXYZ(v);
  if (space == 9) return opponentToXYZ(v);
  return vec3(0.0);
}
`;

// ============================================================================
//  Space ID mapping (must match the shader dispatcher)
// ============================================================================

const SPACE_ID_MAP = {
  srgb: 0, adobergb: 1, xyz: 2, lab: 3, lch: 4,
  hsb: 5, hsl: 6, cmy: 7, lms: 8, opponent: 9,
};

// ============================================================================
//  2D Picker GL Renderer
// ============================================================================

const PICKER_VERT = /* glsl */ `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;  // [-1,1] → [0,1]
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const PICKER_FRAG = /* glsl */ `
${GLSL_COLOR_LIB}

varying vec2 v_uv;

uniform int u_space;
uniform int u_xAxis;
uniform int u_yAxis;
uniform int u_excluded;
uniform float u_excludedVal;
uniform float u_xMin, u_xMax;
uniform float u_yMin, u_yMax;
uniform bool u_reverseX;
uniform bool u_reverseY;
uniform bool u_showGamut;

void main() {
  float tX = u_reverseX ? 1.0 - v_uv.x : v_uv.x;
  float tY = u_reverseY ? v_uv.y : 1.0 - v_uv.y;  // default: top=max

  float xVal = mix(u_xMin, u_xMax, tX);
  float yVal = mix(u_yMin, u_yMax, tY);

  // Build the 3-component color value
  vec3 values = vec3(0.0);
  // Assign x-axis value
  if (u_xAxis == 0) values.x = xVal;
  else if (u_xAxis == 1) values.y = xVal;
  else values.z = xVal;
  // Assign y-axis value
  if (u_yAxis == 0) values.x = yVal;
  else if (u_yAxis == 1) values.y = yVal;
  else values.z = yVal;
  // Assign excluded (fixed) value
  if (u_excluded == 0) values.x = u_excludedVal;
  else if (u_excluded == 1) values.y = u_excludedVal;
  else values.z = u_excludedVal;

  // Convert to XYZ
  vec3 xyz = spaceToXYZ(values, u_space);

  // Convert XYZ → linear sRGB
  vec3 linRGB = M_XYZ_TO_SRGB * xyz;

  // Apply gamma THEN clamp (matching qtpyrc approach).
  // max(0) prevents NaN from pow() on negatives.
  // Values > 1.0 go through gamma naturally — the curve compresses them,
  // making the gamut boundary a smooth roll-off instead of a hard edge.
  vec3 srgb = clamp(linearToSrgbV(max(linRGB, vec3(0.0))), 0.0, 1.0);

  gl_FragColor = vec4(srgb, 1.0);
}
`;

export class PickerGLRenderer {
  /** @type {WebGLRenderingContext|null} */
  #gl = null;
  #program = null;
  #uniforms = {};
  #ready = false;

  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {boolean} true if WebGL is available
   */
  init(canvas) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return false;
    this.#gl = gl;

    // Compile shaders
    const vs = this.#compile(gl.VERTEX_SHADER, PICKER_VERT);
    const fs = this.#compile(gl.FRAGMENT_SHADER, PICKER_FRAG);
    if (!vs || !fs) { this.#gl = null; return false; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[GL] Link error:', gl.getProgramInfoLog(prog));
      this.#gl = null;
      return false;
    }
    this.#program = prog;

    // Full-screen quad (two triangles)
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Cache uniform locations
    const names = [
      'u_space', 'u_xAxis', 'u_yAxis', 'u_excluded', 'u_excludedVal',
      'u_xMin', 'u_xMax', 'u_yMin', 'u_yMax',
      'u_reverseX', 'u_reverseY', 'u_showGamut',
    ];
    for (const n of names) {
      this.#uniforms[n] = gl.getUniformLocation(prog, n);
    }

    gl.useProgram(prog);
    this.#ready = true;
    return true;
  }

  get isReady() { return this.#ready; }

  /**
   * Render the 2D picker gradient.
   * @param {{spaceId:string, xAxis:number, yAxis:number, excluded:number,
   *          excludedValue:number, reversed:{x:boolean,y:boolean}}} picker
   * @param {object} space - ColorEngine space definition
   */
  render(picker, space) {
    const gl = this.#gl;
    if (!gl || !this.#ready) return;

    // Sync viewport to canvas size
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    const sid = SPACE_ID_MAP[picker.spaceId];
    if (sid === undefined) return;

    const xComp = space.components[picker.xAxis];
    const yComp = space.components[picker.yAxis];

    gl.uniform1i(this.#uniforms.u_space, sid);
    gl.uniform1i(this.#uniforms.u_xAxis, picker.xAxis);
    gl.uniform1i(this.#uniforms.u_yAxis, picker.yAxis);
    gl.uniform1i(this.#uniforms.u_excluded, picker.excluded);
    gl.uniform1f(this.#uniforms.u_excludedVal, picker.excludedValue);
    gl.uniform1f(this.#uniforms.u_xMin, xComp.range[0]);
    gl.uniform1f(this.#uniforms.u_xMax, xComp.range[1]);
    gl.uniform1f(this.#uniforms.u_yMin, yComp.range[0]);
    gl.uniform1f(this.#uniforms.u_yMax, yComp.range[1]);
    gl.uniform1i(this.#uniforms.u_reverseX, picker.reversed.x ? 1 : 0);
    gl.uniform1i(this.#uniforms.u_reverseY, picker.reversed.y ? 1 : 0);
    gl.uniform1i(this.#uniforms.u_showGamut, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  #compile(type, source) {
    const gl = this.#gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[GL] Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }
}

// ============================================================================
//  1D Slider GL Renderer (shared context for all sliders)
// ============================================================================

const SLIDER_FRAG = /* glsl */ `
${GLSL_COLOR_LIB}

varying vec2 v_uv;

uniform int u_space;
uniform int u_componentIndex;  // which component varies along X
uniform vec3 u_fixedValues;    // values of all 3 components (varied one is ignored)
uniform float u_min, u_max;    // range of the varied component
uniform bool u_showGamut;

void main() {
  float t = v_uv.x;
  float val = mix(u_min, u_max, t);

  vec3 values = u_fixedValues;
  if (u_componentIndex == 0) values.x = val;
  else if (u_componentIndex == 1) values.y = val;
  else values.z = val;

  vec3 xyz = spaceToXYZ(values, u_space);
  vec3 linRGB = M_XYZ_TO_SRGB * xyz;

  // gamma first, then clamp — smooth gamut boundary
  vec3 srgb = clamp(linearToSrgbV(max(linRGB, vec3(0.0))), 0.0, 1.0);

  gl_FragColor = vec4(srgb, 1.0);
}
`;

export class SliderGLRenderer {
  /** @type {HTMLCanvasElement} offscreen canvas shared by all sliders */
  #canvas;
  /** @type {WebGLRenderingContext|null} */
  #gl = null;
  #program = null;
  #uniforms = {};
  #ready = false;

  constructor() {
    // Create an off-screen canvas for rendering slider gradients
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = 256;
    this.#canvas.height = 1;  // 1px tall — we only need a horizontal gradient
  }

  init() {
    const gl = this.#canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true,
    });
    if (!gl) return false;
    this.#gl = gl;

    const vs = this.#compile(gl.VERTEX_SHADER, PICKER_VERT);
    const fs = this.#compile(gl.FRAGMENT_SHADER, SLIDER_FRAG);
    if (!vs || !fs) { this.#gl = null; return false; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[GL Slider] Link error:', gl.getProgramInfoLog(prog));
      this.#gl = null;
      return false;
    }
    this.#program = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const names = [
      'u_space', 'u_componentIndex', 'u_fixedValues',
      'u_min', 'u_max', 'u_showGamut',
    ];
    for (const n of names) {
      this.#uniforms[n] = gl.getUniformLocation(prog, n);
    }
    gl.useProgram(prog);
    this.#ready = true;
    return true;
  }

  get isReady() { return this.#ready; }

  /**
   * Render a slider gradient, then blit it onto the target 2D canvas.
   * @param {CanvasRenderingContext2D} targetCtx — the slider's 2D context
   * @param {string} spaceId
   * @param {number} componentIndex — which component to vary
   * @param {number[]} currentValues — all 3 component values
   * @param {number} targetWidth — CSS width of the slider canvas
   * @param {number} targetHeight — CSS height of the slider canvas
   */
  renderSlider(targetCtx, spaceId, componentIndex, currentValues, targetWidth, targetHeight) {
    const gl = this.#gl;
    if (!gl || !this.#ready) return false;

    const sid = SPACE_ID_MAP[spaceId];
    if (sid === undefined) return false;

    // Render to the offscreen 256×1 canvas
    gl.viewport(0, 0, 256, 1);

    gl.uniform1i(this.#uniforms.u_space, sid);
    gl.uniform1i(this.#uniforms.u_componentIndex, componentIndex);
    gl.uniform3f(this.#uniforms.u_fixedValues,
      currentValues[0], currentValues[1], currentValues[2]);
    gl.uniform1f(this.#uniforms.u_min, 0);  // placeholder — overridden per-space
    gl.uniform1f(this.#uniforms.u_max, 0);
    gl.uniform1i(this.#uniforms.u_showGamut, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Blit the 256×1 offscreen canvas onto the target slider canvas
    // The browser handles scaling automatically via drawImage
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.drawImage(this.#canvas, 0, 0, targetWidth, targetHeight);
    return true;
  }

  /**
   * Render a slider gradient with explicit range.
   */
  renderSliderWithRange(targetCtx, spaceId, componentIndex, currentValues, minVal, maxVal, targetWidth, targetHeight) {
    const gl = this.#gl;
    if (!gl || !this.#ready) return false;

    const sid = SPACE_ID_MAP[spaceId];
    if (sid === undefined) return false;

    gl.viewport(0, 0, 256, 1);
    gl.uniform1i(this.#uniforms.u_space, sid);
    gl.uniform1i(this.#uniforms.u_componentIndex, componentIndex);
    gl.uniform3f(this.#uniforms.u_fixedValues,
      currentValues[0], currentValues[1], currentValues[2]);
    gl.uniform1f(this.#uniforms.u_min, minVal);
    gl.uniform1f(this.#uniforms.u_max, maxVal);
    gl.uniform1i(this.#uniforms.u_showGamut, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    targetCtx.imageSmoothingEnabled = true;
    targetCtx.drawImage(this.#canvas, 0, 0, targetWidth, targetHeight);
    return true;
  }

  #compile(type, source) {
    const gl = this.#gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[GL Slider] Shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }
}
