/**
 * ui-output.js — CSS color format output, nearest named color, WCAG contrast
 *
 * Shows the current color in multiple CSS formats with click-to-copy,
 * identifies the nearest CSS named color, and shows WCAG contrast ratios.
 */

import { ColorEngine } from './color-engine.js';
import { AppState } from './state.js';

// ---------------------------------------------------------------------------
//  CSS named colors for nearest-color matching (subset: the 148 CSS colors)
// ---------------------------------------------------------------------------

export const CSS_NAMED = {
  aliceblue:[240,248,255],antiquewhite:[250,235,215],aqua:[0,255,255],aquamarine:[127,255,212],
  azure:[240,255,255],beige:[245,245,220],bisque:[255,228,196],black:[0,0,0],
  blanchedalmond:[255,235,205],blue:[0,0,255],blueviolet:[138,43,226],brown:[165,42,42],
  burlywood:[222,184,135],cadetblue:[95,158,160],chartreuse:[127,255,0],chocolate:[210,105,30],
  coral:[255,127,80],cornflowerblue:[100,149,237],cornsilk:[255,248,220],crimson:[220,20,60],
  cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgoldenrod:[184,134,11],
  darkgray:[169,169,169],darkgreen:[0,100,0],darkkhaki:[189,183,107],darkmagenta:[139,0,139],
  darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],
  darksalmon:[233,150,122],darkseagreen:[143,188,143],darkslateblue:[72,61,139],
  darkslategray:[47,79,79],darkturquoise:[0,206,209],darkviolet:[148,0,211],
  deeppink:[255,20,147],deepskyblue:[0,191,255],dimgray:[105,105,105],dodgerblue:[30,144,255],
  firebrick:[178,34,34],floralwhite:[255,250,240],forestgreen:[34,139,34],fuchsia:[255,0,255],
  gainsboro:[220,220,220],ghostwhite:[248,248,255],gold:[255,215,0],goldenrod:[218,165,32],
  gray:[128,128,128],green:[0,128,0],greenyellow:[173,255,47],honeydew:[240,255,240],
  hotpink:[255,105,180],indianred:[205,92,92],indigo:[75,0,130],ivory:[255,255,240],
  khaki:[240,230,140],lavender:[230,230,250],lavenderblush:[255,240,245],lawngreen:[124,252,0],
  lemonchiffon:[255,250,205],lightblue:[173,216,230],lightcoral:[240,128,128],
  lightcyan:[224,255,255],lightgoldenrodyellow:[250,250,210],lightgray:[211,211,211],
  lightgreen:[144,238,144],lightpink:[255,182,193],lightsalmon:[255,160,122],
  lightseagreen:[32,178,170],lightskyblue:[135,206,250],lightslategray:[119,136,153],
  lightsteelblue:[176,196,222],lightyellow:[255,255,224],lime:[0,255,0],limegreen:[50,205,50],
  linen:[250,240,230],magenta:[255,0,255],maroon:[128,0,0],mediumaquamarine:[102,205,170],
  mediumblue:[0,0,205],mediumorchid:[186,85,211],mediumpurple:[147,112,219],
  mediumseagreen:[60,179,113],mediumslateblue:[123,104,238],mediumspringgreen:[0,250,154],
  mediumturquoise:[72,209,204],mediumvioletred:[199,21,133],midnightblue:[25,25,112],
  mintcream:[245,255,250],mistyrose:[255,228,225],moccasin:[255,228,181],navajowhite:[255,222,173],
  navy:[0,0,128],oldlace:[253,245,230],olive:[128,128,0],olivedrab:[107,142,35],
  orange:[255,165,0],orangered:[255,69,0],orchid:[218,112,214],palegoldenrod:[238,232,170],
  palegreen:[152,251,152],paleturquoise:[175,238,238],palevioletred:[219,112,147],
  papayawhip:[255,239,213],peachpuff:[255,218,185],peru:[205,133,63],pink:[255,192,203],
  plum:[221,160,221],powderblue:[176,224,230],purple:[128,0,128],rebeccapurple:[102,51,153],
  red:[255,0,0],rosybrown:[188,143,143],royalblue:[65,105,225],saddlebrown:[139,69,19],
  salmon:[250,128,114],sandybrown:[244,164,96],seagreen:[46,139,87],seashell:[255,245,238],
  sienna:[160,82,45],silver:[192,192,192],skyblue:[135,206,235],slateblue:[106,90,205],
  slategray:[112,128,144],snow:[255,250,250],springgreen:[0,255,127],steelblue:[70,130,180],
  tan:[210,180,140],teal:[0,128,128],thistle:[216,191,216],tomato:[255,99,71],
  turquoise:[64,224,208],violet:[238,130,238],wheat:[245,222,179],white:[255,255,255],
  whitesmoke:[245,245,245],yellow:[255,255,0],yellowgreen:[154,205,50],
};

// ---------------------------------------------------------------------------
//  Color vision deficiency simulation (Brettel/Viénot)
//
//  Each matrix transforms linear sRGB to simulate how the color appears
//  to someone lacking one cone type.
// ---------------------------------------------------------------------------

/** Protanopia — no L (long-wave / red) cones. */
const CVD_PROTAN = [
  [0.152286, 1.052583, -0.204868],
  [0.114503, 0.786281,  0.099216],
  [-0.003882, -0.048116, 1.051998],
];
/** Deuteranopia — no M (medium-wave / green) cones. */
const CVD_DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501,  0.047413],
  [-0.011820, 0.042940, 0.968881],
];
/** Tritanopia — no S (short-wave / blue) cones. */
const CVD_TRITAN = [
  [1.255528, -0.076749, -0.178779],
  [-0.078411, 0.930809, 0.147602],
  [0.004733, 0.691367, 0.303900],
];

function simulateCVD(r, g, b, matrix) {
  // sRGB -> linear
  const lin = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  // Apply CVD matrix
  const out = [
    matrix[0][0] * lin[0] + matrix[0][1] * lin[1] + matrix[0][2] * lin[2],
    matrix[1][0] * lin[0] + matrix[1][1] * lin[1] + matrix[1][2] * lin[2],
    matrix[2][0] * lin[0] + matrix[2][1] * lin[1] + matrix[2][2] * lin[2],
  ];
  // linear -> sRGB
  return out.map(c => {
    c = Math.max(0, Math.min(1, c));
    return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  });
}

// ---------------------------------------------------------------------------
//  WCAG relative luminance and contrast ratio
// ---------------------------------------------------------------------------

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function wcagLevel(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

// ---------------------------------------------------------------------------
//  Correlated Color Temperature (McCamy 1992)
// ---------------------------------------------------------------------------

/**
 * Approximate correlated color temperature (CCT) in Kelvin from CIE XYZ.
 * Uses McCamy's cubic approximation (1992) from CIE xy chromaticity.
 * Returns null if the color is too far from the Planckian locus.
 */
function approximateCCT(X, Y, Z) {
  const sum = X + Y + Z;
  if (sum < 1e-6) return null;
  const x = X / sum;
  const y = Y / sum;
  // McCamy's approximation: n = (x - 0.3320) / (0.1858 - y)
  const n = (x - 0.3320) / (0.1858 - y);
  const cct = 449 * n * n * n + 3525 * n * n + 6823.3 * n + 5520.33;
  // Only valid roughly 1000K - 40000K and near the Planckian locus
  if (cct < 1000 || cct > 40000) return null;
  return Math.round(cct);
}

// ---------------------------------------------------------------------------
//  ColorOutput class
// ---------------------------------------------------------------------------

export class ColorOutput {
  #formatsEl;
  #contrastEl;
  #nameEl;
  #cvdEl;
  #tempEl;
  #state;
  #engine;
  #unsubs = [];
  #rafId = 0;

  constructor(formatsEl, contrastEl, nameEl, state, engine, cvdEl, tempEl) {
    this.#formatsEl = formatsEl;
    this.#contrastEl = contrastEl;
    this.#nameEl = nameEl;
    this.#cvdEl = cvdEl || null;
    this.#tempEl = tempEl || null;
    this.#state = state;
    this.#engine = engine;

    this.#unsubs.push(
      state.subscribe('currentColor', () => {
        if (!this.#rafId) {
          this.#rafId = requestAnimationFrame(() => {
            this.#rafId = 0;
            this.render();
          });
        }
      })
    );
    this.render();
  }

  render() {
    const color = this.#state.get('currentColor');
    if (!color) return;

    const [r, g, b] = this.#engine.toSRGB(color.sourceValues, color.sourceSpace);
    const hex = this.#engine.toHex(color.sourceValues, color.sourceSpace).toUpperCase();

    let hsb, hsl, lab;
    try {
      hsb = this.#engine.convert(color.xyz, 'xyz', 'hsb');
      hsl = this.#engine.convert(color.xyz, 'xyz', 'hsl');
      lab = this.#engine.convert(color.xyz, 'xyz', 'lab');
    } catch {
      hsb = [0, 0, 0]; hsl = [0, 0, 0]; lab = [0, 0, 0];
    }

    let lch;
    try { lch = this.#engine.convert(color.xyz, 'xyz', 'lch'); } catch { lch = [0, 0, 0]; }

    // --- CSS Formats ---
    const formats = [
      { label: 'HEX', value: hex },
      { label: 'RGB', value: `rgb(${r}, ${g}, ${b})` },
      { label: 'HSL', value: `hsl(${Math.round(hsl[0])}, ${Math.round(hsl[1])}%, ${Math.round(hsl[2])}%)` },
      { label: 'HSB', value: `hsb(${Math.round(hsb[0])}, ${Math.round(hsb[1])}%, ${Math.round(hsb[2])}%)` },
      { label: 'LAB', value: `lab(${lab[0].toFixed(1)}% ${lab[1].toFixed(1)} ${lab[2].toFixed(1)})` },
      { label: 'LCH', value: `lch(${lch[0].toFixed(1)}% ${lch[1].toFixed(1)} ${Math.round(lch[2])})` },
    ];

    this.#formatsEl.innerHTML = formats.map(f =>
      `<span class="css-format" title="Click to copy" data-value="${f.value}">` +
      `<span class="css-format-label">${f.label}</span> ${f.value}</span>`
    ).join('');

    // Click to copy
    this.#formatsEl.querySelectorAll('.css-format').forEach(el => {
      el.addEventListener('click', () => {
        navigator.clipboard?.writeText(el.dataset.value);
        el.classList.add('copied');
        setTimeout(() => el.classList.remove('copied'), 600);
      });
    });

    // --- Contrast info ---
    const lum = relativeLuminance(r, g, b);
    const ratioBlack = contrastRatio(lum, 0);
    const ratioWhite = contrastRatio(lum, 1);
    const levelBlack = wcagLevel(ratioBlack);
    const levelWhite = wcagLevel(ratioWhite);

    this.#contrastEl.innerHTML =
      `<span class="contrast-item" title="Contrast vs white text">` +
      `<span class="contrast-sample" style="background:${hex};color:#fff;">Aa</span> ` +
      `${ratioWhite.toFixed(1)}:1 <span class="contrast-level ${levelWhite === 'Fail' ? 'fail' : 'pass'}">${levelWhite}</span></span>` +
      `<span class="contrast-item" title="Contrast vs black text">` +
      `<span class="contrast-sample" style="background:${hex};color:#000;">Aa</span> ` +
      `${ratioBlack.toFixed(1)}:1 <span class="contrast-level ${levelBlack === 'Fail' ? 'fail' : 'pass'}">${levelBlack}</span></span>`;

    // --- Nearest named color ---
    let bestName = '';
    let bestDist = Infinity;
    for (const [name, rgb2] of Object.entries(CSS_NAMED)) {
      const dr = r - rgb2[0], dg = g - rgb2[1], db = b - rgb2[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestName = name;
      }
    }
    const exact = bestDist === 0;
    const nearestRgb = CSS_NAMED[bestName];
    const nearestHex = '#' + nearestRgb.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
    this.#nameEl.innerHTML =
      `<span class="nearest-swatch" style="background:${nearestHex};" title="${nearestHex}"></span>` +
      `<span class="nearest-label">${exact ? '' : '~'}${bestName}</span>`;

    // --- Color temperature ---
    if (this.#tempEl) {
      const cct = approximateCCT(color.xyz[0], color.xyz[1], color.xyz[2]);
      if (cct !== null) {
        const warmCool = cct < 3500 ? 'Warm' : cct < 5000 ? 'Neutral' : 'Cool';
        const warmClass = cct < 3500 ? 'warm' : cct < 5000 ? 'neutral' : 'cool';
        this.#tempEl.innerHTML = `<span class="cct-${warmClass}">${cct}K</span> <span style="color:var(--text-dim)">${warmCool}</span>`;
      } else {
        this.#tempEl.textContent = '';
      }
    }

    // --- Color Vision Deficiency simulation ---
    if (this.#cvdEl) {
      const sims = [
        { label: 'Protan', matrix: CVD_PROTAN, desc: 'No red cones' },
        { label: 'Deutan', matrix: CVD_DEUTAN, desc: 'No green cones' },
        { label: 'Tritan', matrix: CVD_TRITAN, desc: 'No blue cones' },
      ];
      this.#cvdEl.innerHTML = sims.map(s => {
        const [sr, sg, sb] = simulateCVD(r, g, b, s.matrix);
        const sHex = '#' + [sr, sg, sb].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
        return `<span class="cvd-item" title="${s.desc}">` +
          `<span class="cvd-swatch" style="background:${sHex};"></span>` +
          `<span class="cvd-label">${s.label}</span></span>`;
      }).join('');
    }
  }
}
