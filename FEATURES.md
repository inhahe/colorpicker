# Ultimate Color Picker — Feature Reference

## Color Models (10 active + XYZ hub)

| Model | Components | Range | Notes |
|-------|-----------|-------|-------|
| sRGB | R, G, B | 0-255 | IEC 61966-2-1, proper piecewise gamma |
| HSB/HSV | H, S, B | 0-360, 0-100, 0-100 | Hexagonal model |
| HSL | H, S, L | 0-360, 0-100, 0-100 | Hexagonal model |
| CIE L\*a\*b\* | L\*, a\*, b\* | 0-100, -128-127, -128-127 | D65 illuminant, perceptually uniform |
| CIE LCh | L\*, C\*, h | 0-100, 0-150, 0-360 | Polar form of L\*a\*b\* |
| Adobe RGB | R, G, B | 0-255 | Wider gamut (~50% of visible) |
| CMY | C, M, Y | 0-255 | Subtractive primaries |
| LMS | L, M, S | 0-1 | Stockman & Sharpe 2-deg cone fundamentals |
| Color Opponent | YB, RG, Br | -50..50, -30..30, 0-100 | Neural opponent channels (Yellow-Blue, Red-Green, Brightness) |
| CIE XYZ | X, Y, Z | ~0-1.1 | Internal hub space (1931 2-deg observer) |

All conversions route through XYZ. The 2D picker and sliders work with every model. Multi-column layout when the panel is wide enough.

### 6D Color Opponent Sliders
Six uni-polar sliders decomposing the 3-channel opponent model into intuitive dimensions:
- **Red** / **Green** — linked pair (increasing one decreases the other)
- **Yellow** / **Blue** — linked pair
- **White** / **Black** — linked pair (strict complements: W + K = 100)
- Gradient canvases show the actual color at each slider position

## 2D Color Picker

- **GPU-accelerated** via WebGL fragment shaders (CPU fallback if WebGL unavailable)
- **Auto-reconfigures** when you drag a slider: the dragged component becomes the depth axis, the other two become X and Y
- **Axis controls**: dropdown selectors for X/Y/excluded, swap, reverse, rotate buttons
- **Crosshair** tracks the current color position
- **Square aspect ratio** maintained, auto-resizes to fit panel
- **Coordinate rotation** — two sliders (Rot1, Rot2) tilt the slice plane through 3D color space to see diagonal cross-sections that don't exist on axis-aligned slices
  - **Line tool**: click "Line" and drag on the 2D picker to set rotation from a visual axis
  - **2 Colors tool**: click "2 Colors", then pick two colors — the rotation aligns the slice to both
  - **Reset**: clears rotation back to axis-aligned
  - Slider gradients update in real time to reflect the rotated axes (★ marks affected components)
  - **Shift+drag in the 3D viewer** also rotates the slice plane interactively
  - The 3D viewer shows a **semi-transparent slice plane** visualization (tessellated for cylindrical spaces like HSB/HSL/LCh)
- **RBF gradient mode** — click "RBF" to place arbitrary color points, the entire 2D surface is filled via thin-plate spline radial basis function interpolation
  - **Save/Load** RBF gradient configurations (stores control points + picker config, persists in localStorage)
- Keyboard: **R** to rotate axes

## Hexagonal Color Picker

A flat-top hexagonal grid of color swatches in its own panel:
- **Resolution slider** (4-32) — controls hex grid density
- Uses the same color space and axis configuration as the 2D picker
- Click any hexagon to select that color
- Hover highlights hexagons, current color gets a white border
- Auto-resizes with its panel

## Color Sliders

- Shows all 10 color models simultaneously with gradient canvases
- Each slider has a draggable thumb, number input, and quick-value buttons
- Add/remove models via the "+" button and toggle dialog
- Sliders auto-update when the color changes from any source
- Multi-column layout — wraps into 2-3 columns when the panel is wide

## Color / Hex / CSS Panel

- **Swatch** — split diagonally: top-left = displayed sRGB, bottom-right = intended color. Draggable as a color source.
- **Hex input** — type or paste hex values (#RGB or #RRGGBB)
- **Copy/Paste buttons** — clipboard integration (Ctrl+V also accepts images for palette extraction)
- **Quick color buttons** — black, white, R, G, B, Y, M, C (clickable and draggable)
- **CSS formats** — HEX, RGB, HSL, HSB, LAB, LCH — each click-to-copy with green flash
- **WCAG contrast checker** — contrast ratios against white and black text with AAA/AA/Fail ratings
- **Nearest named color** — closest CSS named color with swatch
- **Color name search** — type a color name (e.g. "coral", "darkblue") with browser autocomplete from all 148 CSS named colors
- **Color vision deficiency simulation** — shows how the current color appears to people with protanopia (no red cones), deuteranopia (no green cones), and tritanopia (no blue cones), using Brettel/Viénot simulation matrices
- **Correlated Color Temperature** — McCamy's approximation showing CCT in Kelvin with Warm/Neutral/Cool classification

## Saved Colors / History / Collections Panel

- **Saved colors**: click "+ Save", click to select, Ctrl+click to delete, right-click context menu, drag to reorder, draggable to other targets
- **Color history**: last 30 colors, recorded on mouse-up, click to restore, draggable, x to clear
- **Standard collections**: CSS Named (148), Web-Safe 216, Material Design (190), RAL Classic, Pastels, Visible Spectrum, Grayscale

## Color Harmony

Shows harmony suggestions that update live (9 types):
- Complementary, Split Complementary, Triadic, Tetradic Square, Tetradic Rectangular, Analogous, Split-Complement, Square, Double-Complement
- Each swatch is clickable and draggable. "Save All" adds all to saved colors.

## Two-Color Gradient

Toggle via **Gradient** button or **G** key. Interpolated in L\*a\*b\*.

## Three-Color Triangle

Toggle via **Triangle** button or **T** key. Barycentric interpolation in L\*a\*b\*.

## Color Info Panel

- Color model description, key equations, gamut coverage, uniformity rating
- Space label synced with the 2D picker (all panels share one model selector)
- CIE xy chromaticity diagram with gamut triangles
- Cone response chart (L/M/S curves, 380-780nm)
- Display accuracy meters (Delta E 2000, HSB, LMS groups)

## Saved Picker Views

- **Save View** saves the current 2D picker configuration (space, axes, excluded value)
- **Saved Views dropdown** restores any saved configuration
- Persists in localStorage

## Drag and Drop

**Drag from:** current color swatch, saved colors, history swatches, quick color buttons, collection swatches, harmony swatches

**Drop onto:**
- Current color swatch — sets the color
- Saved colors strip — adds to saved
- Palette editor canvas — adds a control point at the drop position
- 2D picker — changes the excluded dimension to match the dropped color

Visual feedback: drop targets highlight with a dashed blue outline.

## Eyedropper

Click the **Eyedropper** button or press **I**. Uses the EyeDropper API (Chrome/Edge only).

## Palette Editor

Toggle via **Palette Editor** button in toolbar. Hovering over the palette strip shows a tooltip with the palette index and RGB values.

### Creating Palettes
- **New** — cycles through presets: Rainbow, Grayscale, Heat, Cool, Random
- **Random** — configurable number of random control points (3-32)
- **From Image** — median cut quantization (Heckbert 1982) extracts 256 representative colors
- **From Saved** — creates a palette from saved colors via spline interpolation
- **Curves** — draw R/G/B or H/S/B curves in a curves dialog with control points
- **Preview Image** — loads an image and maps it to palette indices for cycling preview; **click any pixel** to pick that color

### Shape Drawing on 2D Picker
Dropdown with 5 shape modes:
- **Freehand** — draw freely on the 2D picker, palette entries filled in real-time
  - **Scroll wheel** directly advances/retreats through palette indices — faster scrolling = faster advancement, reverse scrolling = go backward
  - Mouse position determines what color gets written; scroll wheel controls which palette index
  - Floating indicator near cursor shows current position (e.g. "42/256")
- **Line** — click two points, colors sampled along the line
- **Rectangle** — click two corners, colors sampled around the perimeter
- **Ellipse** — click center + drag radius, colors sampled around circumference
- **Polygon** — click vertices, double-click to close, colors sampled along edges
All shapes show a live preview overlay. Press Escape to cancel.

### Editing
- **Control points** — right-click to add, shift+click to remove, drag to reposition
- **Spline modes** — Catmull-Rom (smooth), Linear, Bezier
- All interpolation in L\*a\*b\* for perceptual uniformity
- **Selection mode** — click+drag to select a range, then Cut/Copy/Paste

### Adjustments
- **Hue shift** (+/- 30deg), **Saturation** (+/- 15), **Brightness** (+/- 10 L\*)
- **Reverse**, **Smooth**, **Channel Mix** (3x3 RGB matrix with presets)

### Blending
- **Blend** — slide between two saved palettes (interpolated in L\*a\*b\*)

### Animation
- **Rotate** slider (0-255) + **Animate** slider for continuous rotation
- With a preview image loaded, creates classic palette cycling animation
- Preview image shows with x button to dismiss

### Import/Export
- **Save/Load** palettes by name (persisted in localStorage)
- **Export** as PNG, JPEG, BMP (256x32 image), JSON, or GIMP Palette (.gpl)
- BMP export builds the file byte-by-byte (no canvas dependency)

## ICC Profile Support

Load ICC/ICM profile files to add custom color spaces:
- Parses ICC binary format (header, tag table, matrix, TRC)
- Supports matrix-based RGB profiles (monitors, scanners)
- Handles curv (gamma, LUT) and para (parametric) tone response curves
- Loaded profile registers as a new color space with sliders, 2D picker, 3D viewer
- **ICC Profile** button in toolbar opens file picker

## 3D Color Space Viewer

Interactive WebGL visualization of any color space:
- **Point cloud** with adjustable density (8-28) and point size (1-8)
- **Wireframe**: cube for rectangular spaces, **cylinder** for HSB/HSL/LCh (hue = angle)
- Cylindrical view uses Fibonacci spiral sampling (no radial spoke artifacts)
- **Axis labels**: component names for cubes, cardinal hue angles for cylinders
- **Current color marker** (glowing white point)
- **Drag** to rotate, **scroll** to zoom
- **Space label** shows current color model (synced with 2D picker — all panels share one model selector)
- **Palette** button — shows current palette as a 3D trace
- **History** button — shows a trace of the last 200 picked colors as a continuous line through color space (re-projects when space changes)
- **Image** button — load an image to show its color distribution (persists across space changes, x to clear)
- **Dual** checkbox — renders two color spaces side by side with labels
- **Perspective slider** — smoothly blends between orthographic (0) and perspective (1) projection
- **Shift+drag** — rotates the 2D picker's slice plane angles interactively
- **Slice plane visualization** — semi-transparent blue quad showing the current 2D picker slice; tessellated for cylindrical spaces so it follows the surface curvature
- **sRGB gamut boundary** — when viewing wide-gamut spaces (Lab, LCh, XYZ, LMS, Opponent), a dim orange wireframe shows the sRGB gamut edges so you can see which colors are displayable
- **Stereo 3D modes**: Mono, Red/Cyan, Blue/Yellow, Magenta/Green, Blue/Amber, Cross-eyed, Parallel

## Panel Layout

- **Draggable panels** — grab title bar to move, drop above/below any panel or past edges to create new columns
- **Resizable** — drag dividers between columns, drag row dividers between stacked panels, right-edge handles on every column, left-edge handle with margin
- **Layout persists** in localStorage
- **Reset Layout** button restores default arrangement
- **Export Layout** downloads positions as JSON

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | Copy hex to clipboard |
| Ctrl+V | Paste hex from clipboard, or paste image to extract palette |
| I / E | Eyedropper (pick color from screen) |
| S | Save current color |
| C | Complement color (hue + 180°) |
| N | Random color |
| X | Swap X and Y axes |
| V | Invert color (255-R, 255-G, 255-B) |
| D | Desaturate to grayscale |
| L | Lighter (+10 brightness) |
| K | Darker (-10 brightness) |
| G | Toggle two-color gradient |
| T | Toggle three-color triangle |
| R | Rotate picker axes |

## State Persistence

- All settings, saved colors, and palettes persist via localStorage
- **Clean Slate** resets to defaults but preserves saved colors and palettes
- **Undo/Redo** stack (max 100 entries) for color and picker changes
- **Export Session** — download the entire session as a JSON file
- **Import Session** — restore a previously exported session from JSON
- Corrupted state (zero XYZ) auto-detected and reset on load

## Technical

- **21,000+ lines** of pure HTML/CSS/JS — zero external dependencies, no build tools
- 16 ES modules: app, color-engine, state, gl-renderer, ui-picker-v2, ui-3d-v2, ui-palette, ui-harmony, ui-hex-picker, ui-rbf-gradient, ui-icc, ui-info, ui-output, collections
- ES modules loaded natively by the browser
- WebGL fragment shaders for GPU-accelerated 2D picker and slider rendering
- All 10 color space conversions implemented in both JavaScript and GLSL
- Full CIEDE2000 Delta E implementation
- Brettel/Viénot color vision deficiency simulation matrices
- McCamy's correlated color temperature approximation
- Stockman & Sharpe cone fundamentals (89 data points, 390-830nm)
- CIE 1931 color matching functions (81 data points, 380-780nm)
- Median cut quantization (Heckbert 1982) for image palette extraction
- Thin-plate spline RBF for 2D gradient extrapolation
- Custom drag-and-drop panel layout system (no framework)
- No-cache development server (server.py)
- Dark theme with CSS custom properties
