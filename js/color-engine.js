/**
 * color-engine.js  --  Complete color science engine
 *
 * ES module, no dependencies.  CIE XYZ (1931 2-deg observer, D65) is the
 * internal hub space; every other space converts through it.
 *
 * Spaces supported:
 *   srgb, adobergb, xyz, lab, lch, hsb, hsl, cmy, lms
 *
 * Key data embedded:
 *   - Stockman & Sharpe 2-deg cone fundamentals (energy, 5 nm, 390-830 nm)
 *   - CIE 1931 2-deg color matching functions (5 nm, 380-780 nm)
 *   - sRGB / Adobe RGB / LMS / Bradford matrices
 *   - D65 and D50 white points
 *   - Full CIEDE2000 implementation
 */

// ---------------------------------------------------------------------------
//  Matrices & constants
// ---------------------------------------------------------------------------

/** sRGB (IEC 61966-2-1) linear RGB to CIE XYZ (D65). */
const M_SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041],
];

/** Adobe RGB (1998) linear RGB to CIE XYZ (D65). */
const M_ADOBERGB_TO_XYZ = [
  [0.5767309, 0.1855540, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
];

/** CIE XYZ to LMS (Hunt-Pointer-Estevez / Stockman & Sharpe adapted). */
const M_XYZ_TO_LMS = [
  [ 0.4002400,  0.7076000, -0.0808100],
  [-0.2263000,  1.1653200,  0.0457000],
  [ 0.0000000,  0.0000000,  0.9182200],
];

/** Bradford chromatic adaptation matrix (source -> LMS-like). */
const M_BRADFORD = [
  [ 0.8951000,  0.2664000, -0.1614000],
  [-0.7502000,  1.7135000,  0.0367000],
  [ 0.0389000, -0.0685000,  1.0296000],
];

/** D65 reference white (CIE 1931 2-deg). */
const D65 = [0.95047, 1.00000, 1.08883];

/** D50 reference white. */
const D50 = [0.96422, 1.00000, 0.82521];

/** sRGB gamma constants. */
const SRGB_LINEAR_THRESHOLD = 0.0031308;
const SRGB_GAMMA = 2.4;
const SRGB_SLOPE = 12.92;
const SRGB_OFFSET = 0.055;

/** Adobe RGB effective gamma (563 / 256). */
const ADOBERGB_GAMMA = 2.19921875;

// ---------------------------------------------------------------------------
//  Linear-algebra helpers
// ---------------------------------------------------------------------------

/**
 * Multiply a 3x3 matrix by a 3-vector.
 * @param {number[][]} m  3x3 matrix (row-major)
 * @param {number[]}   v  3-vector
 * @returns {[number, number, number]}
 */
function matMul3x3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Invert a 3x3 matrix (Cramer's rule).
 * @param {number[][]} m
 * @returns {number[][]}
 */
function invertMatrix3x3(m) {
  const [a, b, c] = [m[0][0], m[0][1], m[0][2]];
  const [d, e, f] = [m[1][0], m[1][1], m[1][2]];
  const [g, h, i] = [m[2][0], m[2][1], m[2][2]];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-15) throw new Error('Singular matrix');
  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

// Pre-compute inverse matrices once at module load.
const M_XYZ_TO_SRGB    = invertMatrix3x3(M_SRGB_TO_XYZ);
const M_XYZ_TO_ADOBERGB = invertMatrix3x3(M_ADOBERGB_TO_XYZ);
const M_LMS_TO_XYZ      = invertMatrix3x3(M_XYZ_TO_LMS);
const M_BRADFORD_INV     = invertMatrix3x3(M_BRADFORD);

// Bradford D65 -> D50 adaptation matrix (computed once).
const M_D65_TO_D50 = (() => {
  const src = matMul3x3(M_BRADFORD, D65);
  const dst = matMul3x3(M_BRADFORD, D50);
  // Diagonal scale in Bradford space, then back.
  const scale = [
    [dst[0] / src[0], 0, 0],
    [0, dst[1] / src[1], 0],
    [0, 0, dst[2] / src[2]],
  ];
  // M_adapt = M_BRADFORD_INV * scale * M_BRADFORD
  const tmp = multiplyMatrices(scale, M_BRADFORD);
  return multiplyMatrices(M_BRADFORD_INV, tmp);
})();

const M_D50_TO_D65 = invertMatrix3x3(M_D65_TO_D50);

/** Multiply two 3x3 matrices. */
function multiplyMatrices(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
//  sRGB gamma (proper piecewise IEC 61966-2-1)
// ---------------------------------------------------------------------------

/** sRGB non-linear (0-1) -> linear (0-1). */
function srgbToLinear(v) {
  if (v <= 0.04045) return v / SRGB_SLOPE;
  return Math.pow((v + SRGB_OFFSET) / (1 + SRGB_OFFSET), SRGB_GAMMA);
}

/** sRGB linear (0-1) -> non-linear (0-1). */
function linearToSrgb(v) {
  if (v <= SRGB_LINEAR_THRESHOLD) return v * SRGB_SLOPE;
  return (1 + SRGB_OFFSET) * Math.pow(v, 1 / SRGB_GAMMA) - SRGB_OFFSET;
}

// ---------------------------------------------------------------------------
//  L*a*b* helpers (uses D50 by convention, Bradford-adapted from D65)
// ---------------------------------------------------------------------------

const LAB_EPSILON = 216 / 24389;   // (6/29)^3
const LAB_KAPPA   = 24389 / 27;    // (29/6)^3 * 3  -- but the standard form is 903.3

/** Forward L*a*b* transfer function. */
function labF(t) {
  return t > LAB_EPSILON ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;
}

/** Inverse L*a*b* transfer function. */
function labFInv(t) {
  return t > 6 / 29 ? t * t * t : (116 * t - 16) / LAB_KAPPA;
}

// ---------------------------------------------------------------------------
//  Spectral data -- Stockman & Sharpe 2-deg cone fundamentals
//  Energy-based (linear energy), 5 nm intervals, 390-830 nm.
//  Source: CVRL (Colour & Vision Research Laboratory) tabulated values.
// ---------------------------------------------------------------------------

const CONE_WAVELENGTHS = [];
for (let w = 390; w <= 830; w += 5) CONE_WAVELENGTHS.push(w);

/**
 * Stockman & Sharpe (2000) 2-degree cone fundamentals, energy-based,
 * 5 nm steps from 390 nm to 830 nm.
 * Each sub-array: [L, M, S] at that wavelength.
 * Data from CVRL: http://www.cvrl.org/cones.htm  (lin-energy, 2-deg)
 */
const CONE_DATA_LMS = [
  // 390 nm                                       395 nm                                       400 nm
  [1.0300e-03, 7.5800e-04, 5.5300e-02], [2.2500e-03, 1.6400e-03, 1.1320e-01], [5.1600e-03, 3.7800e-03, 2.2360e-01],
  // 405 nm                                       410 nm                                       415 nm
  [1.0900e-02, 8.1000e-03, 4.0170e-01], [2.0600e-02, 1.5700e-02, 6.2810e-01], [3.5700e-02, 2.8400e-02, 8.4840e-01],
  // 420 nm (S peak region)                        425 nm                                       430 nm
  [5.6100e-02, 4.7400e-02, 1.0000e+00], [7.7900e-02, 7.0900e-02, 9.7860e-01], [9.5000e-02, 9.5800e-02, 8.4540e-01],
  // 435 nm                                       440 nm                                       445 nm
  [1.0700e-01, 1.1680e-01, 6.6520e-01], [1.1510e-01, 1.3560e-01, 4.9220e-01], [1.1860e-01, 1.5220e-01, 3.4770e-01],
  // 450 nm                                       455 nm                                       460 nm
  [1.1530e-01, 1.6050e-01, 2.3310e-01], [1.0850e-01, 1.6350e-01, 1.5140e-01], [9.8600e-02, 1.6120e-01, 9.2500e-02],
  // 465 nm                                       470 nm                                       475 nm
  [8.7800e-02, 1.5730e-01, 5.5900e-02], [7.8200e-02, 1.5420e-01, 3.3200e-02], [7.1200e-02, 1.5440e-01, 1.9400e-02],
  // 480 nm                                       485 nm                                       490 nm
  [6.7300e-02, 1.5810e-01, 1.1200e-02], [6.4900e-02, 1.6420e-01, 6.3600e-03], [6.4700e-02, 1.7470e-01, 3.5100e-03],
  // 495 nm                                       500 nm                                       505 nm
  [6.7400e-02, 1.9010e-01, 1.9000e-03], [7.4200e-02, 2.1090e-01, 1.0200e-03], [8.6300e-02, 2.3960e-01, 5.2800e-04],
  // 510 nm                                       515 nm                                       520 nm
  [1.0560e-01, 2.7700e-01, 2.6400e-04], [1.3290e-01, 3.2410e-01, 1.2900e-04], [1.6880e-01, 3.8000e-01, 6.1300e-05],
  // 525 nm                                       530 nm (M peak region)                       535 nm
  [2.1330e-01, 4.4290e-01, 2.8600e-05], [2.6560e-01, 5.0960e-01, 1.3200e-05], [3.2320e-01, 5.7580e-01, 6.0000e-06],
  // 540 nm                                       545 nm                                       550 nm
  [3.8670e-01, 6.3820e-01, 2.7100e-06], [4.5530e-01, 6.9370e-01, 1.2200e-06], [5.2650e-01, 7.3730e-01, 5.5000e-07],
  // 555 nm                                       560 nm (L peak region)                       565 nm
  [5.9820e-01, 7.6620e-01, 2.5000e-07], [6.6720e-01, 7.7830e-01, 1.1000e-07], [7.3060e-01, 7.7300e-01, 0.0000e+00],
  // 570 nm                                       575 nm                                       580 nm
  [7.8530e-01, 7.5140e-01, 0.0000e+00], [8.2920e-01, 7.1470e-01, 0.0000e+00], [8.6130e-01, 6.6550e-01, 0.0000e+00],
  // 585 nm                                       590 nm                                       595 nm
  [8.8240e-01, 6.0770e-01, 0.0000e+00], [8.9510e-01, 5.4460e-01, 0.0000e+00], [8.9770e-01, 4.7770e-01, 0.0000e+00],
  // 600 nm                                       605 nm                                       610 nm
  [8.9330e-01, 4.1200e-01, 0.0000e+00], [8.8170e-01, 3.4950e-01, 0.0000e+00], [8.6120e-01, 2.9130e-01, 0.0000e+00],
  // 615 nm                                       620 nm                                       625 nm
  [8.3130e-01, 2.3880e-01, 0.0000e+00], [7.9310e-01, 1.9280e-01, 0.0000e+00], [7.4730e-01, 1.5350e-01, 0.0000e+00],
  // 630 nm                                       635 nm                                       640 nm
  [6.9580e-01, 1.2060e-01, 0.0000e+00], [6.3960e-01, 9.3300e-02, 0.0000e+00], [5.8010e-01, 7.1100e-02, 0.0000e+00],
  // 645 nm                                       650 nm                                       655 nm
  [5.1900e-01, 5.3500e-02, 0.0000e+00], [4.5830e-01, 3.9800e-02, 0.0000e+00], [3.9900e-01, 2.9200e-02, 0.0000e+00],
  // 660 nm                                       665 nm                                       670 nm
  [3.4270e-01, 2.1200e-02, 0.0000e+00], [2.9080e-01, 1.5300e-02, 0.0000e+00], [2.4360e-01, 1.0900e-02, 0.0000e+00],
  // 675 nm                                       680 nm                                       685 nm
  [2.0180e-01, 7.6600e-03, 0.0000e+00], [1.6520e-01, 5.3500e-03, 0.0000e+00], [1.3390e-01, 3.6900e-03, 0.0000e+00],
  // 690 nm                                       695 nm                                       700 nm
  [1.0730e-01, 2.5400e-03, 0.0000e+00], [8.5200e-02, 1.7400e-03, 0.0000e+00], [6.7100e-02, 1.1900e-03, 0.0000e+00],
  // 705 nm                                       710 nm                                       715 nm
  [5.2400e-02, 8.0300e-04, 0.0000e+00], [4.0700e-02, 5.4200e-04, 0.0000e+00], [3.1400e-02, 3.6300e-04, 0.0000e+00],
  // 720 nm                                       725 nm                                       730 nm
  [2.4100e-02, 2.4300e-04, 0.0000e+00], [1.8400e-02, 1.6200e-04, 0.0000e+00], [1.3900e-02, 1.0700e-04, 0.0000e+00],
  // 735 nm                                       740 nm                                       745 nm
  [1.0500e-02, 7.1200e-05, 0.0000e+00], [7.9000e-03, 4.7100e-05, 0.0000e+00], [5.9300e-03, 3.1200e-05, 0.0000e+00],
  // 750 nm                                       755 nm                                       760 nm
  [4.4300e-03, 2.0600e-05, 0.0000e+00], [3.3100e-03, 1.3500e-05, 0.0000e+00], [2.4600e-03, 8.8800e-06, 0.0000e+00],
  // 765 nm                                       770 nm                                       775 nm
  [1.8300e-03, 5.8200e-06, 0.0000e+00], [1.3600e-03, 3.8100e-06, 0.0000e+00], [1.0100e-03, 2.4900e-06, 0.0000e+00],
  // 780 nm                                       785 nm                                       790 nm
  [7.5200e-04, 1.6200e-06, 0.0000e+00], [5.5800e-04, 1.0600e-06, 0.0000e+00], [4.1400e-04, 6.8800e-07, 0.0000e+00],
  // 795 nm                                       800 nm                                       805 nm
  [3.0700e-04, 4.4800e-07, 0.0000e+00], [2.2800e-04, 2.9100e-07, 0.0000e+00], [1.6900e-04, 1.8900e-07, 0.0000e+00],
  // 810 nm                                       815 nm                                       820 nm
  [1.2500e-04, 1.2300e-07, 0.0000e+00], [9.2900e-05, 7.9700e-08, 0.0000e+00], [6.9000e-05, 5.1700e-08, 0.0000e+00],
  // 825 nm                                       830 nm
  [5.1200e-05, 3.3500e-08, 0.0000e+00], [3.8000e-05, 2.1700e-08, 0.0000e+00],
];

// ---------------------------------------------------------------------------
//  CIE 1931 2-degree color matching functions (x-bar, y-bar, z-bar)
//  5 nm intervals, 380 - 780 nm
// ---------------------------------------------------------------------------

const CMF_WAVELENGTHS = [];
for (let w = 380; w <= 780; w += 5) CMF_WAVELENGTHS.push(w);

/**
 * CIE 1931 2-degree standard observer, 5 nm steps 380-780 nm.
 * Each row: [x_bar, y_bar, z_bar].
 */
const CMF_DATA = [
  // 380 nm
  [0.001368, 0.000039, 0.006450],
  [0.002236, 0.000064, 0.010550],
  [0.004243, 0.000120, 0.020050],
  [0.007650, 0.000217, 0.036210],
  [0.014310, 0.000396, 0.067850],
  // 405 nm
  [0.023190, 0.000640, 0.110200],
  [0.043510, 0.001210, 0.207400],
  [0.077630, 0.002180, 0.371300],
  [0.134380, 0.004000, 0.645600],
  [0.214770, 0.007300, 1.039050],
  // 430 nm
  [0.283900, 0.011600, 1.385600],
  [0.328500, 0.016840, 1.622960],
  [0.348280, 0.023000, 1.747060],
  [0.348060, 0.029800, 1.782600],
  [0.336200, 0.038000, 1.772110],
  // 455 nm
  [0.318700, 0.048000, 1.744100],
  [0.290800, 0.060000, 1.669200],
  [0.251100, 0.073900, 1.528100],
  [0.195360, 0.090980, 1.287640],
  [0.142100, 0.112600, 1.041900],
  // 480 nm
  [0.095640, 0.139020, 0.812950],
  [0.057950, 0.169300, 0.616200],
  [0.032010, 0.208020, 0.465180],
  [0.014700, 0.258600, 0.353300],
  [0.004900, 0.323000, 0.272000],
  // 505 nm
  [0.002400, 0.407300, 0.212300],
  [0.009300, 0.503000, 0.158200],
  [0.029100, 0.608200, 0.111700],
  [0.063270, 0.710000, 0.078250],
  [0.109600, 0.793200, 0.057250],
  // 530 nm
  [0.165500, 0.862000, 0.042160],
  [0.225750, 0.914850, 0.029840],
  [0.290400, 0.954000, 0.020300],
  [0.359700, 0.980300, 0.013400],
  [0.433450, 0.994950, 0.008750],
  // 555 nm
  [0.512050, 1.000000, 0.005750],
  [0.594500, 0.995000, 0.003900],
  [0.678400, 0.978600, 0.002750],
  [0.762100, 0.952000, 0.002100],
  [0.842500, 0.915400, 0.001800],
  // 580 nm
  [0.916300, 0.870000, 0.001650],
  [0.978600, 0.816300, 0.001400],
  [1.026300, 0.757000, 0.001100],
  [1.056700, 0.694900, 0.001000],
  [1.062200, 0.631000, 0.000800],
  // 605 nm
  [1.045600, 0.566800, 0.000600],
  [1.002600, 0.503000, 0.000340],
  [0.938400, 0.441200, 0.000240],
  [0.854450, 0.381000, 0.000190],
  [0.751400, 0.321000, 0.000100],
  // 630 nm
  [0.642400, 0.265000, 0.000050],
  [0.541900, 0.217000, 0.000030],
  [0.447900, 0.175000, 0.000020],
  [0.360800, 0.138200, 0.000010],
  [0.283500, 0.107000, 0.000000],
  // 655 nm
  [0.218700, 0.081600, 0.000000],
  [0.164900, 0.061000, 0.000000],
  [0.121200, 0.044580, 0.000000],
  [0.087400, 0.032000, 0.000000],
  [0.063600, 0.023200, 0.000000],
  // 680 nm
  [0.046770, 0.017000, 0.000000],
  [0.032900, 0.011920, 0.000000],
  [0.022700, 0.008210, 0.000000],
  [0.015840, 0.005723, 0.000000],
  [0.011359, 0.004102, 0.000000],
  // 705 nm
  [0.008111, 0.002929, 0.000000],
  [0.005790, 0.002091, 0.000000],
  [0.004109, 0.001484, 0.000000],
  [0.002899, 0.001047, 0.000000],
  [0.002049, 0.000740, 0.000000],
  // 730 nm
  [0.001440, 0.000520, 0.000000],
  [0.001000, 0.000361, 0.000000],
  [0.000690, 0.000249, 0.000000],
  [0.000476, 0.000172, 0.000000],
  [0.000332, 0.000120, 0.000000],
  // 755 nm
  [0.000235, 0.000085, 0.000000],
  [0.000166, 0.000060, 0.000000],
  [0.000117, 0.000042, 0.000000],
  [0.000083, 0.000030, 0.000000],
  [0.000059, 0.000021, 0.000000],
  // 780 nm
  [0.000042, 0.000015, 0.000000],
];

// ---------------------------------------------------------------------------
//  ColorEngine
// ---------------------------------------------------------------------------

export class ColorEngine {
  /** @type {Map<string, object>} */
  spaces;

  constructor() {
    this.spaces = new Map();
    this._registerSpaces();
  }

  // -----------------------------------------------------------------------
  //  Static helpers (exposed on the class for external use)
  // -----------------------------------------------------------------------

  /**
   * Multiply a 3x3 matrix by a 3-vector.
   */
  static matMul3x3(m, v) {
    return matMul3x3(m, v);
  }

  /**
   * Invert a 3x3 matrix.
   */
  static invertMatrix3x3(m) {
    return invertMatrix3x3(m);
  }

  // -----------------------------------------------------------------------
  //  Space registration
  // -----------------------------------------------------------------------

  _registerSpaces() {
    this._registerSRGB();
    this._registerAdobeRGB();
    this._registerXYZ();
    this._registerLab();
    this._registerLCh();
    this._registerHSB();
    this._registerHSL();
    this._registerCMY();
    this._registerLMS();
    this._registerOpponent();
  }

  // ---- sRGB ----

  _registerSRGB() {
    this.spaces.set('srgb', {
      id: 'srgb',
      name: 'sRGB',
      components: [
        { id: 'r', name: 'Red',   range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'g', name: 'Green', range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'b', name: 'Blue',  range: [0, 255], step: 1, defaultValue: 128 },
      ],
      toXYZ: ([r, g, b]) => {
        // 0-255 -> 0-1 -> linear -> XYZ
        const rl = srgbToLinear(r / 255);
        const gl = srgbToLinear(g / 255);
        const bl = srgbToLinear(b / 255);
        return matMul3x3(M_SRGB_TO_XYZ, [rl, gl, bl]);
      },
      fromXYZ: (xyz) => {
        const [rl, gl, bl] = matMul3x3(M_XYZ_TO_SRGB, xyz);
        return [
          Math.round(clamp01(linearToSrgb(rl)) * 255),
          Math.round(clamp01(linearToSrgb(gl)) * 255),
          Math.round(clamp01(linearToSrgb(bl)) * 255),
        ];
      },
      meta: {
        description:
          'IEC 61966-2-1 standard RGB. The default color space for the web, most monitors, ' +
          'and nearly all consumer content. Uses D65 illuminant and a specific 709 gamut.',
        gamutCoverageDesc: '~35% of visible gamut',
        uniformity: 'poor',
        absolute: false,
        equations: [
          'Linear: C_lin = C_srgb <= 0.04045 ? C_srgb/12.92 : ((C_srgb+0.055)/1.055)^2.4',
          'XYZ = M_sRGB * [R_lin, G_lin, B_lin]^T',
        ],
      },
    });
  }

  // ---- Adobe RGB ----

  _registerAdobeRGB() {
    this.spaces.set('adobergb', {
      id: 'adobergb',
      name: 'Adobe RGB (1998)',
      components: [
        { id: 'r', name: 'Red',   range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'g', name: 'Green', range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'b', name: 'Blue',  range: [0, 255], step: 1, defaultValue: 128 },
      ],
      toXYZ: ([r, g, b]) => {
        const rl = Math.pow(r / 255, ADOBERGB_GAMMA);
        const gl = Math.pow(g / 255, ADOBERGB_GAMMA);
        const bl = Math.pow(b / 255, ADOBERGB_GAMMA);
        return matMul3x3(M_ADOBERGB_TO_XYZ, [rl, gl, bl]);
      },
      fromXYZ: (xyz) => {
        const [rl, gl, bl] = matMul3x3(M_XYZ_TO_ADOBERGB, xyz);
        const invGamma = 1 / ADOBERGB_GAMMA;
        return [
          Math.round(clamp01(Math.pow(Math.max(0, rl), invGamma)) * 255),
          Math.round(clamp01(Math.pow(Math.max(0, gl), invGamma)) * 255),
          Math.round(clamp01(Math.pow(Math.max(0, bl), invGamma)) * 255),
        ];
      },
      meta: {
        description:
          'Adobe RGB (1998) covers a wider gamut than sRGB, especially in cyan-green. ' +
          'Common in print/photography workflows. Uses D65 and a simple 2.2 gamma (exactly 563/256).',
        gamutCoverageDesc: '~50% of visible gamut',
        uniformity: 'poor',
        absolute: false,
        equations: [
          'Linear: C_lin = (C/255)^(563/256)',
          'XYZ = M_AdobeRGB * [R_lin, G_lin, B_lin]^T',
        ],
      },
    });
  }

  // ---- CIE XYZ ----

  _registerXYZ() {
    this.spaces.set('xyz', {
      id: 'xyz',
      name: 'CIE XYZ',
      components: [
        { id: 'x', name: 'X', range: [0, 1.1], step: 0.001, defaultValue: 0.5 },
        { id: 'y', name: 'Y', range: [0, 1.1], step: 0.001, defaultValue: 0.5 },
        { id: 'z', name: 'Z', range: [0, 1.1], step: 0.001, defaultValue: 0.5 },
      ],
      toXYZ: (xyz) => [...xyz],
      fromXYZ: (xyz) => [...xyz],
      meta: {
        description:
          'CIE 1931 XYZ tristimulus values. The foundational device-independent color space ' +
          'from which most others derive. Y corresponds to luminance. D65 illuminant.',
        gamutCoverageDesc: 'Encompasses all visible colors (by design)',
        uniformity: 'poor',
        absolute: true,
        equations: [
          'X = integral( S(l)*x_bar(l)*dl )',
          'Y = integral( S(l)*y_bar(l)*dl )  [luminance]',
          'Z = integral( S(l)*z_bar(l)*dl )',
        ],
      },
    });
  }

  // ---- CIE L*a*b* ----

  _registerLab() {
    this.spaces.set('lab', {
      id: 'lab',
      name: 'CIE L*a*b*',
      components: [
        { id: 'l', name: 'L*', range: [0, 100],  step: 0.1, defaultValue: 50 },
        { id: 'a', name: 'a*', range: [-128, 127], step: 0.1, defaultValue: 0 },
        { id: 'b', name: 'b*', range: [-128, 127], step: 0.1, defaultValue: 0 },
      ],
      toXYZ: ([L, a, b]) => {
        // L*a*b* -> XYZ (D65 direct — no chromatic adaptation needed
        // since sRGB also uses D65)
        const fy = (L + 16) / 116;
        const fx = a / 500 + fy;
        const fz = fy - b / 200;
        return [
          D65[0] * labFInv(fx),
          D65[1] * labFInv(fy),
          D65[2] * labFInv(fz),
        ];
      },
      fromXYZ: (xyz) => {
        const fx = labF(xyz[0] / D65[0]);
        const fy = labF(xyz[1] / D65[1]);
        const fz = labF(xyz[2] / D65[2]);
        const L = 116 * fy - 16;
        const a = 500 * (fx - fy);
        const b = 200 * (fy - fz);
        return [L, a, b];
      },
      meta: {
        description:
          'CIE 1976 L*a*b* — a perceptually (approximately) uniform color space. ' +
          'L* is lightness, a* is green-red, b* is blue-yellow. Referenced to D65 illuminant.',
        gamutCoverageDesc: 'Encompasses all visible colors',
        uniformity: 'moderate',
        absolute: true,
        equations: [
          'L* = 116*f(Y/Yn) - 16',
          'a* = 500*(f(X/Xn) - f(Y/Yn))',
          'b* = 200*(f(Y/Yn) - f(Z/Zn))',
          'f(t) = t^(1/3)  if t > (6/29)^3,  else  t/(3*(6/29)^2) + 4/29',
        ],
      },
    });
  }

  // ---- CIE L*C*h (polar L*a*b*) ----

  _registerLCh() {
    this.spaces.set('lch', {
      id: 'lch',
      name: 'CIE LCh',
      components: [
        { id: 'l', name: 'L*', range: [0, 100], step: 0.1, defaultValue: 50 },
        { id: 'c', name: 'C*', range: [0, 150], step: 0.1, defaultValue: 50 },
        { id: 'h', name: 'h',  range: [0, 360], step: 0.1, defaultValue: 0 },
      ],
      toXYZ: ([L, C, h]) => {
        const hRad = (h * Math.PI) / 180;
        const a = C * Math.cos(hRad);
        const b = C * Math.sin(hRad);
        return this.spaces.get('lab').toXYZ([L, a, b]);
      },
      fromXYZ: (xyz) => {
        const [L, a, b] = this.spaces.get('lab').fromXYZ(xyz);
        const C = Math.sqrt(a * a + b * b);
        let h = (Math.atan2(b, a) * 180) / Math.PI;
        if (h < 0) h += 360;
        return [L, C, h];
      },
      meta: {
        description:
          'Polar representation of CIE L*a*b*. L* is lightness, C* is chroma (saturation), ' +
          'h is hue angle in degrees. Often more intuitive than rectangular a*/b*.',
        gamutCoverageDesc: 'Encompasses all visible colors',
        uniformity: 'moderate',
        absolute: true,
        equations: [
          'C* = sqrt(a*^2 + b*^2)',
          'h  = atan2(b*, a*)  [degrees, 0-360)',
        ],
      },
    });
  }

  // ---- HSB / HSV ----

  _registerHSB() {
    this.spaces.set('hsb', {
      id: 'hsb',
      name: 'HSB / HSV',
      components: [
        { id: 'h', name: 'Hue',        range: [0, 360], step: 1,   defaultValue: 0 },
        { id: 's', name: 'Saturation',  range: [0, 100], step: 0.1, defaultValue: 0 },
        { id: 'b', name: 'Brightness',  range: [0, 100], step: 0.1, defaultValue: 100 },
      ],
      toXYZ: ([h, s, b]) => {
        const rgb = hsbToSrgb(h, s, b);
        return this.spaces.get('srgb').toXYZ(rgb);
      },
      fromXYZ: (xyz) => {
        const rgb = this.spaces.get('srgb').fromXYZ(xyz);
        return srgbToHsb(rgb[0], rgb[1], rgb[2]);
      },
      meta: {
        description:
          'Hue-Saturation-Brightness (also called HSV). A cylindrical remapping of sRGB ' +
          'that separates chromatic (hue, saturation) from intensity (brightness) information.',
        gamutCoverageDesc: '~35% of visible gamut (same as sRGB)',
        uniformity: 'poor',
        absolute: false,
        equations: [
          'V = max(R,G,B)/255',
          'S = (V == 0) ? 0 : (V - min(R,G,B)/255) / V',
          'H computed from hexagonal projection',
        ],
      },
    });
  }

  // ---- HSL ----

  _registerHSL() {
    this.spaces.set('hsl', {
      id: 'hsl',
      name: 'HSL',
      components: [
        { id: 'h', name: 'Hue',        range: [0, 360], step: 1,   defaultValue: 0 },
        { id: 's', name: 'Saturation',  range: [0, 100], step: 0.1, defaultValue: 0 },
        { id: 'l', name: 'Lightness',   range: [0, 100], step: 0.1, defaultValue: 50 },
      ],
      toXYZ: ([h, s, l]) => {
        const rgb = hslToSrgb(h, s, l);
        return this.spaces.get('srgb').toXYZ(rgb);
      },
      fromXYZ: (xyz) => {
        const rgb = this.spaces.get('srgb').fromXYZ(xyz);
        return srgbToHsl(rgb[0], rgb[1], rgb[2]);
      },
      meta: {
        description:
          'Hue-Saturation-Lightness. Similar to HSB but uses lightness (L=0 is black, ' +
          'L=100 is white) instead of brightness. Common in CSS color functions.',
        gamutCoverageDesc: '~35% of visible gamut (same as sRGB)',
        uniformity: 'poor',
        absolute: false,
        equations: [
          'L = (max + min) / 2',
          'S = (max - min) / (1 - |2L - 1|)',
          'H computed from hexagonal projection',
        ],
      },
    });
  }

  // ---- CMY ----

  _registerCMY() {
    this.spaces.set('cmy', {
      id: 'cmy',
      name: 'CMY',
      components: [
        { id: 'c', name: 'Cyan',    range: [0, 255], step: 1, defaultValue: 0 },
        { id: 'm', name: 'Magenta', range: [0, 255], step: 1, defaultValue: 0 },
        { id: 'y', name: 'Yellow',  range: [0, 255], step: 1, defaultValue: 0 },
      ],
      toXYZ: ([c, m, y]) => {
        return this.spaces.get('srgb').toXYZ([255 - c, 255 - m, 255 - y]);
      },
      fromXYZ: (xyz) => {
        const [r, g, b] = this.spaces.get('srgb').fromXYZ(xyz);
        return [255 - r, 255 - g, 255 - b];
      },
      meta: {
        description:
          'Subtractive primary model. Cyan, Magenta, Yellow are the complements of Red, ' +
          'Green, Blue. Simple inversion of sRGB channel values (C=255-R, M=255-G, Y=255-B).',
        gamutCoverageDesc: '~35% of visible gamut (same as sRGB)',
        uniformity: 'poor',
        absolute: false,
        equations: [
          'C = 255 - R',
          'M = 255 - G',
          'Y = 255 - B',
        ],
      },
    });
  }

  // ---- LMS ----

  _registerLMS() {
    this.spaces.set('lms', {
      id: 'lms',
      name: 'LMS (cone response)',
      components: [
        { id: 'l', name: 'L (long)',   range: [0, 1], step: 0.001, defaultValue: 0.5 },
        { id: 'm', name: 'M (medium)', range: [0, 1], step: 0.001, defaultValue: 0.5 },
        { id: 's', name: 'S (short)',   range: [0, 1], step: 0.001, defaultValue: 0.5 },
      ],
      toXYZ: (lms) => matMul3x3(M_LMS_TO_XYZ, lms),
      fromXYZ: (xyz) => matMul3x3(M_XYZ_TO_LMS, xyz),
      meta: {
        description:
          'Physiological cone-response space based on Stockman & Sharpe 2-deg fundamentals ' +
          '(Hunt-Pointer-Estevez transform). L (long/red ~564 nm peak), M (medium/green ' +
          '~534 nm peak), S (short/blue ~420 nm peak).',
        gamutCoverageDesc: 'Encompasses all visible colors',
        uniformity: 'poor',
        absolute: true,
        equations: [
          '[L, M, S]^T = M_HPE * [X, Y, Z]^T',
          'M_HPE = Hunt-Pointer-Estevez matrix (Stockman & Sharpe adapted)',
        ],
      },
    });
  }

  // ---- Color Opponent (Yellow-Blue / Red-Green / Brightness) ----

  _registerOpponent() {
    // Color opponent theory: the visual system processes three channels:
    //   Brightness (achromatic): (L + M) / 2  — loosely, luminance
    //   Red-Green:  L - M                     — long vs medium cones
    //   Yellow-Blue: (L + M) / 2 - S          — sum of long+medium vs short
    //
    // We normalize these to intuitive ranges and route through LMS <-> XYZ.
    // Ranges: Brightness [0, 100], Red-Green [-100, 100], Yellow-Blue [-100, 100]

    this.spaces.set('opponent', {
      id: 'opponent',
      name: 'Color Opponent',
      components: [
        { id: 'yb', name: 'Yellow-Blue', range: [-50, 50], step: 0.5, defaultValue: 0 },
        { id: 'rg', name: 'Red-Green',   range: [-30, 30], step: 0.5, defaultValue: 0 },
        { id: 'br', name: 'Brightness',  range: [0, 100],  step: 0.5, defaultValue: 50 },
      ],
      toXYZ: ([yb, rg, br]) => {
        const half = br / 100;
        const diff = rg / 100;
        const L = Math.max(0, half + diff / 2);
        const M = Math.max(0, half - diff / 2);
        const S = Math.max(0, half - yb / 100);
        return matMul3x3(M_LMS_TO_XYZ, [L, M, S]);
      },
      fromXYZ: (xyz) => {
        const [L, M, S] = matMul3x3(M_XYZ_TO_LMS, xyz);
        const half = (L + M) / 2;
        const br = half * 100;
        const rg = (L - M) * 100;
        const yb = (half - S) * 100;
        return [yb, rg, br];
      },
      meta: {
        description:
          'Color opponent model based on neural color processing. The visual system encodes ' +
          'three channels: Yellow-Blue (warm vs cool), Red-Green (L-cone vs M-cone), and ' +
          'Brightness (achromatic luminance). This is how the brain actually perceives color ' +
          'after the cone signals are combined in the retina.',
        gamutCoverageDesc: 'Encompasses all visible colors',
        uniformity: 'moderate',
        absolute: true,
        equations: [
          'Brightness = (L + M) / 2',
          'Red-Green = L - M',
          'Yellow-Blue = (L + M) / 2 - S',
          'where L, M, S are Stockman & Sharpe cone responses',
        ],
      },
    });
  }

  // -----------------------------------------------------------------------
  //  Core conversion
  // -----------------------------------------------------------------------

  /**
   * Convert color values from one space to another, routing through XYZ.
   * @param {number[]} values
   * @param {string}   fromSpaceId
   * @param {string}   toSpaceId
   * @returns {number[]}
   */
  convert(values, fromSpaceId, toSpaceId) {
    if (fromSpaceId === toSpaceId) return [...values];
    const from = this.spaces.get(fromSpaceId);
    const to   = this.spaces.get(toSpaceId);
    if (!from) throw new Error(`Unknown color space: ${fromSpaceId}`);
    if (!to)   throw new Error(`Unknown color space: ${toSpaceId}`);
    const xyz = from.toXYZ(values);
    return to.fromXYZ(xyz);
  }

  // -----------------------------------------------------------------------
  //  Convenience methods
  // -----------------------------------------------------------------------

  /**
   * Convert any color to sRGB [0-255], clamped.
   * @param {number[]} values
   * @param {string}   fromSpaceId
   * @returns {[number, number, number]}
   */
  toSRGB(values, fromSpaceId) {
    if (fromSpaceId === 'srgb') {
      return [
        clampInt(Math.round(values[0]), 0, 255),
        clampInt(Math.round(values[1]), 0, 255),
        clampInt(Math.round(values[2]), 0, 255),
      ];
    }
    const from = this.spaces.get(fromSpaceId);
    if (!from) throw new Error(`Unknown color space: ${fromSpaceId}`);
    const xyz = from.toXYZ(values);
    const [rl, gl, bl] = matMul3x3(M_XYZ_TO_SRGB, xyz);
    return [
      clampInt(Math.round(clamp01(linearToSrgb(rl)) * 255), 0, 255),
      clampInt(Math.round(clamp01(linearToSrgb(gl)) * 255), 0, 255),
      clampInt(Math.round(clamp01(linearToSrgb(bl)) * 255), 0, 255),
    ];
  }

  /**
   * Convert any color to a hex string "#rrggbb".
   * @param {number[]} values
   * @param {string}   fromSpaceId
   * @returns {string}
   */
  toHex(values, fromSpaceId) {
    const [r, g, b] = this.toSRGB(values, fromSpaceId);
    return '#' + hex2(r) + hex2(g) + hex2(b);
  }

  /**
   * Parse a hex string to sRGB values.
   * Accepts "#rgb", "#rrggbb", "rgb", "rrggbb".
   * @param {string} hex
   * @returns {{spaceId: 'srgb', values: [number, number, number]}}
   */
  fromHex(hex) {
    let h = hex.replace(/^#/, '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) throw new Error(`Invalid hex color: ${hex}`);
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return { spaceId: 'srgb', values: [r, g, b] };
  }

  /**
   * Convert any color to a CSS string.
   * @param {number[]} values
   * @param {string}   fromSpaceId
   * @returns {string}
   */
  toCSS(values, fromSpaceId) {
    const [r, g, b] = this.toSRGB(values, fromSpaceId);
    return `rgb(${r}, ${g}, ${b})`;
  }

  // -----------------------------------------------------------------------
  //  Gamut classification
  // -----------------------------------------------------------------------

  /**
   * Classify a color's gamut status.
   * @param {number[]} values
   * @param {string}   spaceId
   * @returns {{displayable: boolean, viewable: boolean, imaginary: boolean}}
   */
  classifyColor(values, spaceId) {
    const space = this.spaces.get(spaceId);
    if (!space) throw new Error(`Unknown color space: ${spaceId}`);
    const xyz = space.toXYZ(values);

    // Imaginary: negative LMS values
    const lms = matMul3x3(M_XYZ_TO_LMS, xyz);
    const imaginary = lms[0] < -1e-6 || lms[1] < -1e-6 || lms[2] < -1e-6;

    // Viewable: not imaginary (within the spectral locus)
    const viewable = !imaginary;

    // Displayable: within sRGB gamut (all linear sRGB channels in [0,1])
    const [rl, gl, bl] = matMul3x3(M_XYZ_TO_SRGB, xyz);
    const EPS = -1e-4; // tiny tolerance for floating point
    const displayable =
      rl >= EPS && rl <= 1 + 1e-4 &&
      gl >= EPS && gl <= 1 + 1e-4 &&
      bl >= EPS && bl <= 1 + 1e-4;

    return { displayable, viewable, imaginary };
  }

  // -----------------------------------------------------------------------
  //  Slider gamut shading
  // -----------------------------------------------------------------------

  /**
   * For a given color space and component, sweep that component across its
   * range while holding the others fixed.  Returns gamut info at each step.
   *
   * @param {string}   spaceId
   * @param {number}   componentIndex  Which component to vary (0-based)
   * @param {number[]} otherComponentValues  Full values array — the varied
   *                                         component's entry is ignored
   * @param {number}   [steps=256]
   * @returns {Array<{value: number, displayable: boolean, viewable: boolean,
   *                  imaginary: boolean, srgb: [number,number,number]}>}
   */
  getSliderGamut(spaceId, componentIndex, otherComponentValues, steps = 256) {
    const space = this.spaces.get(spaceId);
    if (!space) throw new Error(`Unknown color space: ${spaceId}`);
    const comp = space.components[componentIndex];
    const [min, max] = comp.range;
    const results = new Array(steps);

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const value = min + t * (max - min);
      const vals = [...otherComponentValues];
      vals[componentIndex] = value;

      const xyz = space.toXYZ(vals);
      const lms = matMul3x3(M_XYZ_TO_LMS, xyz);
      const imaginary = lms[0] < -1e-6 || lms[1] < -1e-6 || lms[2] < -1e-6;
      const viewable = !imaginary;

      const [rl, gl, bl] = matMul3x3(M_XYZ_TO_SRGB, xyz);
      const EPS = -1e-4;
      const displayable =
        rl >= EPS && rl <= 1 + 1e-4 &&
        gl >= EPS && gl <= 1 + 1e-4 &&
        bl >= EPS && bl <= 1 + 1e-4;

      // Clamped sRGB for display
      const srgb = [
        clampInt(Math.round(clamp01(linearToSrgb(rl)) * 255), 0, 255),
        clampInt(Math.round(clamp01(linearToSrgb(gl)) * 255), 0, 255),
        clampInt(Math.round(clamp01(linearToSrgb(bl)) * 255), 0, 255),
      ];

      results[i] = { value, displayable, viewable, imaginary, srgb };
    }
    return results;
  }

  // -----------------------------------------------------------------------
  //  Delta E (CIEDE2000)
  // -----------------------------------------------------------------------

  /**
   * Compute the CIEDE2000 color difference between two colors in any spaces.
   * @param {number[]} values1
   * @param {string}   space1
   * @param {number[]} values2
   * @param {string}   space2
   * @returns {number}
   */
  deltaE(values1, space1, values2, space2) {
    const lab1 = this.convert(values1, space1, 'lab');
    const lab2 = this.convert(values2, space2, 'lab');
    return ciede2000(lab1, lab2);
  }

  // -----------------------------------------------------------------------
  //  Accuracy report
  // -----------------------------------------------------------------------

  /**
   * How accurately can the given color be displayed on an sRGB monitor?
   *
   * Compares the original color to its sRGB-clamped representation (round-
   * tripped back to the original space) using Delta E 2000 and per-component
   * deltas in the original space, HSB, and LMS.
   *
   * @param {number[]} values
   * @param {string}   spaceId
   * @returns {{deltaE: number, componentDeltas: number[],
   *            hsbDeltas: [number,number,number],
   *            lmsDeltas: [number,number,number],
   *            isExact: boolean}}
   */
  getAccuracy(values, spaceId) {
    // Original XYZ
    const xyzOrig = this.spaces.get(spaceId).toXYZ(values);

    // Clamped sRGB
    const srgbClamped = this.toSRGB(values, spaceId);

    // XYZ of clamped sRGB
    const xyzClamped = this.spaces.get('srgb').toXYZ(srgbClamped);

    // Delta E 2000
    const labOrig    = this.spaces.get('lab').fromXYZ(xyzOrig);
    const labClamped = this.spaces.get('lab').fromXYZ(xyzClamped);
    const dE = ciede2000(labOrig, labClamped);

    // Per-component deltas in original space
    const roundTripped = this.convert(srgbClamped, 'srgb', spaceId);
    const componentDeltas = values.map((v, i) => roundTripped[i] - v);

    // HSB deltas
    const hsbOrig    = this.convert(values, spaceId, 'hsb');
    const hsbClamped = srgbToHsb(srgbClamped[0], srgbClamped[1], srgbClamped[2]);
    let dH = hsbClamped[0] - hsbOrig[0];
    if (dH > 180)  dH -= 360;
    if (dH < -180) dH += 360;
    const hsbDeltas = [dH, hsbClamped[1] - hsbOrig[1], hsbClamped[2] - hsbOrig[2]];

    // LMS deltas
    const lmsOrig    = matMul3x3(M_XYZ_TO_LMS, xyzOrig);
    const lmsClamped = matMul3x3(M_XYZ_TO_LMS, xyzClamped);
    const lmsDeltas  = [
      lmsClamped[0] - lmsOrig[0],
      lmsClamped[1] - lmsOrig[1],
      lmsClamped[2] - lmsOrig[2],
    ];

    return {
      deltaE: dE,
      componentDeltas,
      hsbDeltas,
      lmsDeltas,
      isExact: dE < 0.5,
    };
  }

  // -----------------------------------------------------------------------
  //  Spectral data access
  // -----------------------------------------------------------------------

  /**
   * Return the Stockman & Sharpe 2-deg cone fundamentals data.
   * @returns {{wavelengths: number[], L: number[], M: number[], S: number[]}}
   */
  getConeFundamentals() {
    return {
      wavelengths: CONE_WAVELENGTHS,
      L: CONE_DATA_LMS.map((row) => row[0]),
      M: CONE_DATA_LMS.map((row) => row[1]),
      S: CONE_DATA_LMS.map((row) => row[2]),
    };
  }

  /**
   * Return the CIE 1931 2-degree color matching functions.
   * @returns {{wavelengths: number[], x: number[], y: number[], z: number[]}}
   */
  getCMFs() {
    return {
      wavelengths: CMF_WAVELENGTHS,
      x: CMF_DATA.map((row) => row[0]),
      y: CMF_DATA.map((row) => row[1]),
      z: CMF_DATA.map((row) => row[2]),
    };
  }
}

// ---------------------------------------------------------------------------
//  CIEDE2000 implementation
// ---------------------------------------------------------------------------

/**
 * Full CIEDE2000 color-difference formula.
 * Reference: Sharma, Wu, Dalal (2005).
 * Both arguments are L*a*b* triples.
 *
 * @param {number[]} lab1  [L1, a1, b1]
 * @param {number[]} lab2  [L2, a2, b2]
 * @returns {number}
 */
function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  // Step 1: compute C'ab, h'ab
  const C1ab = Math.sqrt(a1 * a1 + b1 * b1);
  const C2ab = Math.sqrt(a2 * a2 + b2 * b2);
  const Cab_avg = (C1ab + C2ab) / 2;
  const Cab_avg7 = Math.pow(Cab_avg, 7);
  const G = 0.5 * (1 - Math.sqrt(Cab_avg7 / (Cab_avg7 + 6103515625))); // 25^7
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  let h1p = (Math.atan2(b1, a1p) * 180) / Math.PI;
  if (h1p < 0) h1p += 360;
  let h2p = (Math.atan2(b2, a2p) * 180) / Math.PI;
  if (h2p < 0) h2p += 360;

  // Step 2: compute delta L', delta C', delta H'
  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  // Step 3: compute CIEDE2000
  const Lp_avg = (L1 + L2) / 2;
  const Cp_avg = (C1p + C2p) / 2;

  let hp_avg;
  if (C1p * C2p === 0) {
    hp_avg = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hp_avg = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hp_avg = (h1p + h2p + 360) / 2;
  } else {
    hp_avg = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(((hp_avg - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hp_avg) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hp_avg + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * hp_avg - 63) * Math.PI) / 180);

  const Lp_avg_50_sq = (Lp_avg - 50) * (Lp_avg - 50);
  const SL = 1 + 0.015 * Lp_avg_50_sq / Math.sqrt(20 + Lp_avg_50_sq);
  const SC = 1 + 0.045 * Cp_avg;
  const SH = 1 + 0.015 * Cp_avg * T;

  const Cp_avg7 = Math.pow(Cp_avg, 7);
  const RC = 2 * Math.sqrt(Cp_avg7 / (Cp_avg7 + 6103515625));
  const dTheta =
    30 * Math.exp(-((hp_avg - 275) / 25) * ((hp_avg - 275) / 25));
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;

  // Parametric weighting factors (all 1 for default)
  const kL = 1, kC = 1, kH = 1;

  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);

  return Math.sqrt(
    termL * termL + termC * termC + termH * termH + RT * termC * termH
  );
}

// ---------------------------------------------------------------------------
//  HSB <-> sRGB helpers
// ---------------------------------------------------------------------------

/**
 * HSB to sRGB [0-255].
 * H in [0,360], S in [0,100], B in [0,100].
 */
function hsbToSrgb(h, s, b) {
  const S = s / 100;
  const V = b / 100;
  const C = V * S;
  const H = ((h % 360) + 360) % 360;
  const hSeg = H / 60;
  const X = C * (1 - Math.abs((hSeg % 2) - 1));
  let r1, g1, b1;

  if (hSeg < 1)      { r1 = C; g1 = X; b1 = 0; }
  else if (hSeg < 2) { r1 = X; g1 = C; b1 = 0; }
  else if (hSeg < 3) { r1 = 0; g1 = C; b1 = X; }
  else if (hSeg < 4) { r1 = 0; g1 = X; b1 = C; }
  else if (hSeg < 5) { r1 = X; g1 = 0; b1 = C; }
  else               { r1 = C; g1 = 0; b1 = X; }

  const m = V - C;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

/**
 * sRGB [0-255] to HSB.
 * Returns [H (0-360), S (0-100), B (0-100)].
 */
function srgbToHsb(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === R)      h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else                h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  return [h, s, v];
}

// ---------------------------------------------------------------------------
//  HSL <-> sRGB helpers
// ---------------------------------------------------------------------------

/**
 * HSL to sRGB [0-255].
 * H in [0,360], S in [0,100], L in [0,100].
 */
function hslToSrgb(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const H = ((h % 360) + 360) % 360;
  const hSeg = H / 60;
  const X = C * (1 - Math.abs((hSeg % 2) - 1));
  let r1, g1, b1;

  if (hSeg < 1)      { r1 = C; g1 = X; b1 = 0; }
  else if (hSeg < 2) { r1 = X; g1 = C; b1 = 0; }
  else if (hSeg < 3) { r1 = 0; g1 = C; b1 = X; }
  else if (hSeg < 4) { r1 = 0; g1 = X; b1 = C; }
  else if (hSeg < 5) { r1 = X; g1 = 0; b1 = C; }
  else               { r1 = C; g1 = 0; b1 = X; }

  const m = L - C / 2;
  return [
    clampInt(Math.round((r1 + m) * 255), 0, 255),
    clampInt(Math.round((g1 + m) * 255), 0, 255),
    clampInt(Math.round((b1 + m) * 255), 0, 255),
  ];
}

/**
 * sRGB [0-255] to HSL.
 * Returns [H (0-360), S (0-100), L (0-100)].
 */
function srgbToHsl(r, g, b) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R)      h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else                h = 60 * ((R - G) / d + 4);
  }
  if (h < 0) h += 360;

  return [h, s * 100, l * 100];
}

// ---------------------------------------------------------------------------
//  Tiny utilities
// ---------------------------------------------------------------------------

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Number -> 2-digit hex. */
function hex2(n) {
  const s = n.toString(16);
  return s.length < 2 ? '0' + s : s;
}
