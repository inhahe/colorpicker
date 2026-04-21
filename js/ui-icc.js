/**
 * ui-icc.js -- ICC/ICM profile loading, parsing, and color-space registration
 *
 * Supports matrix-based RGB profiles (display 'mntr' and scanner 'scnr'
 * device classes with 'RGB ' color space).  Parses rXYZ/gXYZ/bXYZ matrix
 * columns and rTRC/gTRC/bTRC tone response curves (gamma, parametric, LUT).
 *
 * Exports: ICCManager
 */

import { ColorEngine } from './color-engine.js';

// ---------------------------------------------------------------------------
//  Linear algebra (delegate to ColorEngine statics)
// ---------------------------------------------------------------------------

const matMul3x3      = ColorEngine.matMul3x3;
const invertMatrix3x3 = ColorEngine.invertMatrix3x3;

// ---------------------------------------------------------------------------
//  ICCProfile -- binary parser for matrix-based ICC/ICM profiles
// ---------------------------------------------------------------------------

class ICCProfile {
  /**
   * @param {ArrayBuffer} arrayBuffer  Raw .icc/.icm file contents
   */
  constructor(arrayBuffer) {
    if (arrayBuffer.byteLength < 132) {
      throw new Error('File too small to be a valid ICC profile');
    }

    const view = new DataView(arrayBuffer);

    // -- Header (128 bytes) --------------------------------------------------
    this.size        = view.getUint32(0);
    this.version     = view.getUint8(8) + '.' + view.getUint8(9);
    this.deviceClass = this._readSig(arrayBuffer, 12);
    this.colorSpace  = this._readSig(arrayBuffer, 16).trim();
    this.pcs         = this._readSig(arrayBuffer, 20).trim();

    // Profile description (will be overwritten if 'desc' tag exists)
    this.name = this.deviceClass + '-' + this.colorSpace;

    // -- Tag table -----------------------------------------------------------
    const tagCount = view.getUint32(128);
    this.tags = {};
    for (let i = 0; i < tagCount; i++) {
      const off = 132 + i * 12;
      if (off + 12 > arrayBuffer.byteLength) break;
      const sig       = this._readSig(arrayBuffer, off);
      const tagOffset = view.getUint32(off + 4);
      const tagSize   = view.getUint32(off + 8);
      this.tags[sig] = { offset: tagOffset, size: tagSize };
    }

    // -- Validate: must be RGB matrix profile --------------------------------
    if (this.colorSpace !== 'RGB') {
      throw new Error(
        `Unsupported color space "${this.colorSpace}". Only RGB profiles are supported.`
      );
    }
    const validClasses = ['mntr', 'scnr', 'spac', 'prtr'];
    if (!validClasses.includes(this.deviceClass)) {
      throw new Error(
        `Unsupported device class "${this.deviceClass}". ` +
        'Only monitor (mntr), scanner (scnr), color space (spac), and printer (prtr) profiles are supported.'
      );
    }
    if (!this.tags['rXYZ'] || !this.tags['gXYZ'] || !this.tags['bXYZ']) {
      throw new Error(
        'Profile does not contain rXYZ/gXYZ/bXYZ tags. LUT-based profiles are not supported.'
      );
    }

    // -- Extract transforms --------------------------------------------------
    this.matrix     = this._parseMatrix(arrayBuffer, view);
    this.trc        = this._parseTRCs(arrayBuffer, view);
    this.whitePoint = this._parseXYZ(arrayBuffer, view, 'wtpt');

    // Inverse matrix for fromXYZ conversion (compute once)
    this.inverseMatrix = invertMatrix3x3(this.matrix);

    // Try to read 'desc' tag for a human-readable name
    this._readDescription(arrayBuffer, view);
  }

  // -- Helpers ---------------------------------------------------------------

  _readSig(buf, offset) {
    return String.fromCharCode(
      ...new Uint8Array(buf, offset, 4)
    );
  }

  /** Parse an XYZType tag -> [X, Y, Z] as s15Fixed16Number values. */
  _parseXYZ(buf, view, tag) {
    const t = this.tags[tag];
    if (!t) return null;
    // XYZType layout: 'XYZ ' (4) + reserved (4) + X + Y + Z (each s15Fixed16 = 4 bytes)
    return [
      view.getInt32(t.offset + 8) / 65536,
      view.getInt32(t.offset + 12) / 65536,
      view.getInt32(t.offset + 16) / 65536,
    ];
  }

  /** Build the 3x3 RGB-to-XYZ matrix from rXYZ, gXYZ, bXYZ columns. */
  _parseMatrix(buf, view) {
    const rXYZ = this._parseXYZ(buf, view, 'rXYZ');
    const gXYZ = this._parseXYZ(buf, view, 'gXYZ');
    const bXYZ = this._parseXYZ(buf, view, 'bXYZ');
    // Each primary is a column of the matrix; rows are X, Y, Z
    return [
      [rXYZ[0], gXYZ[0], bXYZ[0]],
      [rXYZ[1], gXYZ[1], bXYZ[1]],
      [rXYZ[2], gXYZ[2], bXYZ[2]],
    ];
  }

  /** Parse rTRC, gTRC, bTRC tags into an array of 3 TRC descriptors. */
  _parseTRCs(buf, view) {
    return ['rTRC', 'gTRC', 'bTRC'].map(tag => {
      const t = this.tags[tag];
      if (!t) return { type: 'gamma', value: 2.2 }; // fallback

      const typeSig = this._readSig(buf, t.offset);

      if (typeSig === 'curv') {
        const count = view.getUint32(t.offset + 8);
        if (count === 0) return { type: 'gamma', value: 1.0 };            // identity
        if (count === 1) return { type: 'gamma', value: view.getUint16(t.offset + 12) / 256 };
        // Multi-entry LUT
        const lut = new Float64Array(count);
        for (let i = 0; i < count; i++) {
          lut[i] = view.getUint16(t.offset + 12 + i * 2) / 65535;
        }
        return { type: 'lut', values: lut };
      }

      if (typeSig === 'para') {
        // parametricCurveType -- we only use the gamma from funcType 0
        const gamma = view.getInt32(t.offset + 12) / 65536;
        return { type: 'gamma', value: gamma };
      }

      return { type: 'gamma', value: 2.2 }; // unknown type, safe fallback
    });
  }

  /** Try to extract a human name from the 'desc' tag. */
  _readDescription(buf, view) {
    const t = this.tags['desc'];
    if (!t) return;
    try {
      const typeSig = this._readSig(buf, t.offset);
      if (typeSig === 'desc') {
        // textDescriptionType: sig(4) + reserved(4) + ascii_count(4) + ascii_string
        const asciiLen = view.getUint32(t.offset + 8);
        if (asciiLen > 0 && asciiLen < 256) {
          const bytes = new Uint8Array(buf, t.offset + 12, asciiLen - 1); // exclude trailing null
          this.name = new TextDecoder('ascii').decode(bytes).trim();
        }
      } else if (typeSig === 'mluc') {
        // multiLocalizedUnicodeType (v4): sig(4)+reserved(4)+count(4)+recordSize(4)+records...
        const recCount = view.getUint32(t.offset + 8);
        if (recCount > 0) {
          const strLen   = view.getUint32(t.offset + 20);      // first record length (bytes)
          const strOff   = view.getUint32(t.offset + 24);      // first record offset from tag start
          const strBytes = new Uint8Array(buf, t.offset + strOff, strLen);
          // UTF-16BE
          const chars = [];
          for (let i = 0; i + 1 < strBytes.length; i += 2) {
            const code = (strBytes[i] << 8) | strBytes[i + 1];
            if (code === 0) break;
            chars.push(String.fromCharCode(code));
          }
          const decoded = chars.join('').trim();
          if (decoded.length > 0) this.name = decoded;
        }
      }
    } catch { /* description parsing is best-effort */ }
  }

  // -- TRC application -------------------------------------------------------

  /** Apply TRC (linearize): map non-linear [0,1] -> linear [0,1]. */
  linearize(channel, value) {
    const trc = this.trc[channel];
    if (trc.type === 'gamma') {
      return Math.pow(Math.max(0, value), trc.value);
    }
    // LUT interpolation
    const lut = trc.values;
    const idx = value * (lut.length - 1);
    const lo  = Math.floor(idx);
    const hi  = Math.min(lo + 1, lut.length - 1);
    const t   = idx - lo;
    return lut[lo] * (1 - t) + lut[hi] * t;
  }

  /** Inverse TRC (delinearize): map linear [0,1] -> non-linear [0,1]. */
  delinearize(channel, value) {
    const trc = this.trc[channel];
    if (trc.type === 'gamma') {
      return Math.pow(Math.max(0, value), 1 / trc.value);
    }
    // Binary search in LUT
    const lut = trc.values;
    let lo = 0, hi = lut.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (lut[mid] < value) lo = mid; else hi = mid;
    }
    const denom = lut[hi] - lut[lo];
    const t = denom > 1e-12 ? (value - lut[lo]) / denom : 0;
    return (lo + t) / (lut.length - 1);
  }

  // -- Conversion ------------------------------------------------------------

  /** Convert profile RGB [0-1] to PCS XYZ. */
  toXYZ(rgb) {
    const lin = [
      this.linearize(0, rgb[0]),
      this.linearize(1, rgb[1]),
      this.linearize(2, rgb[2]),
    ];
    return matMul3x3(this.matrix, lin);
  }

  /** Convert PCS XYZ to profile RGB [0-1]. */
  fromXYZ(xyz) {
    const lin = matMul3x3(this.inverseMatrix, xyz);
    return [
      this.delinearize(0, Math.max(0, Math.min(1, lin[0]))),
      this.delinearize(1, Math.max(0, Math.min(1, lin[1]))),
      this.delinearize(2, Math.max(0, Math.min(1, lin[2]))),
    ];
  }
}

// ---------------------------------------------------------------------------
//  ICCManager -- UI integration: file picker, space registration
// ---------------------------------------------------------------------------

export class ICCManager {
  /**
   * @param {import('./state.js').AppState} state
   * @param {ColorEngine} engine
   */
  constructor(state, engine) {
    this.state   = state;
    this.engine  = engine;
    /** @type {Map<string, ICCProfile>} loaded profiles by space id */
    this.profiles = new Map();

    this._initUI();
  }

  _initUI() {
    const btn = document.getElementById('btn-load-icc');
    if (!btn) return;

    // Hidden file input (reusable)
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = '.icc,.icm';
    this._fileInput.style.display = 'none';
    document.body.appendChild(this._fileInput);

    btn.addEventListener('click', () => this._fileInput.click());

    this._fileInput.addEventListener('change', async () => {
      const file = this._fileInput.files[0];
      if (!file) return;
      this._fileInput.value = ''; // allow re-selecting the same file
      try {
        await this._loadProfile(file);
      } catch (err) {
        console.error('[ICC] Failed to load profile:', err);
        alert('ICC profile error: ' + err.message);
      }
    });
  }

  /**
   * Load and register an ICC profile from a File object.
   * @param {File} file
   */
  async _loadProfile(file) {
    const buf     = await file.arrayBuffer();
    const profile = new ICCProfile(buf);

    // Derive a unique space id
    const baseId = 'icc-' + profile.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    let spaceId  = baseId;
    let n = 2;
    while (this.engine.spaces.has(spaceId)) {
      spaceId = baseId + '_' + n++;
    }

    // Register as a color space in the engine
    this.engine.spaces.set(spaceId, {
      id: spaceId,
      name: profile.name,
      components: [
        { id: 'r', name: 'R', range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'g', name: 'G', range: [0, 255], step: 1, defaultValue: 128 },
        { id: 'b', name: 'B', range: [0, 255], step: 1, defaultValue: 128 },
      ],
      toXYZ: (values) => profile.toXYZ([values[0] / 255, values[1] / 255, values[2] / 255]),
      fromXYZ: (xyz) => {
        const rgb = profile.fromXYZ(xyz);
        return [
          Math.round(Math.max(0, Math.min(255, rgb[0] * 255))),
          Math.round(Math.max(0, Math.min(255, rgb[1] * 255))),
          Math.round(Math.max(0, Math.min(255, rgb[2] * 255))),
        ];
      },
      meta: {
        description: `ICC profile: ${profile.name}. Device class: ${profile.deviceClass}, ` +
                     `version ${profile.version}. PCS: ${profile.pcs}.`,
        gamutCoverageDesc: 'Defined by profile',
        uniformity: 'device-dependent',
        absolute: true,
        equations: [
          'RGB_linear = TRC(RGB / 255)',
          'XYZ = M_profile * RGB_linear',
        ],
      },
    });

    this.profiles.set(spaceId, profile);

    // Add to active & available spaces
    const available = this.state.get('availableSpaces') || [];
    const active    = this.state.get('activeSpaces') || [];
    this.state.batch({
      availableSpaces: [...available, spaceId],
      activeSpaces:    [...active, spaceId],
    });

    // Update button tooltip
    const btn = document.getElementById('btn-load-icc');
    if (btn) {
      btn.title = `Loaded: ${profile.name} (${spaceId}). Click to load another.`;
    }

    console.log(`[ICC] Registered profile "${profile.name}" as space "${spaceId}"`);
  }
}
