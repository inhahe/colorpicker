# Ultimate Color Picker — Feature Reference

## Color Models (9 active + XYZ hub)

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
| Color Opponent | YB, RG, Br | -100..100, -100..100, 0-100 | Neural opponent channels (Yellow-Blue, Red-Green, Brightness) |
| CIE XYZ | X, Y, Z | ~0-1.1 | Internal hub space (1931 2-deg observer) |

All conversions route through XYZ. The 2D picker and sliders work with every model.

## 2D Color Picker

- **GPU-accelerated** via WebGL fragment shaders (CPU fallback if WebGL unavailable)
- **Auto-reconfigures** when you drag a slider: the dragged component becomes the depth axis, the other two become X and Y
- **Axis controls**: dropdown selectors for X/Y/excluded, swap, reverse, rotate buttons
- **Crosshair** tracks the current color position
- Keyboard: **R** to rotate axes

## Color Sliders (Left Panel)

- Shows all 8 color models simultaneously with gradient canvases
- Each slider has a draggable thumb, number input, and quick-value buttons
- Add/remove models via the "+" button and toggle dialog
- Sliders auto-update when the color changes from any source

## Current Color Display (Bottom Bar)

- **Swatch** — split diagonally: top-left = displayed sRGB, bottom-right = intended color
- **Hex input** — type or paste hex values (#RGB or #RRGGBB)
- **Copy/Paste buttons** — clipboard integration
- **Quick color buttons** — black, white, R, G, B, Y, M, C

## CSS Color Formats (Bottom Bar)

Shows the current color in multiple CSS-ready formats, each click-to-copy:
- **HEX** — `#4A90D9`
- **RGB** — `rgb(74, 144, 217)`
- **HSL** — `hsl(211, 68%, 57%)`
- **LAB** — `lab(59.6% -5.2 -38.4)`

Clicking any format copies it to the clipboard with a green flash.

## WCAG Contrast Checker (Bottom Bar)

Shows contrast ratios for the current color against white and black text:
- Displays sample "Aa" text on the color background
- Shows the contrast ratio (e.g., `4.5:1`)
- WCAG level: **AAA** (7:1+), **AA** (4.5:1+), **AA Large** (3:1+), or **Fail**

## Nearest Named Color (Bottom Bar)

Shows the closest CSS named color to the current selection (e.g., "~steelblue") with a small swatch. Exact matches drop the tilde.

## Saved Colors

- Click **"+ Save"** to save the current color
- Click a saved color to select it
- **Ctrl+click** to delete
- **Right-click** for context menu (use, copy hex, rename, delete)
- **Drag to reorder**
- Persists across sessions via localStorage
- Saved colors store exact values in the original color model

## Standard Collections

Dropdown with 7 built-in collections:
- CSS Named Colors (148)
- Web-Safe 216
- Material Design (190)
- RAL Classic
- Pastels (24)
- Visible Spectrum (81 wavelength samples)
- Grayscale (32 steps)

Click any swatch to select that color.

## Color Harmony (Right Panel)

Shows harmony suggestions that update live:
- **Complementary** — hue + 180deg
- **Split Complementary** — hue +/- 150deg
- **Triadic** — hue + 120deg / 240deg
- **Tetradic Square** — hue + 90deg / 180deg / 270deg
- **Tetradic Rectangular** — hue + 60deg / 180deg / 240deg
- **Analogous** — hue +/- 30deg / 60deg

Each swatch is clickable and draggable. "Save All" adds all harmony colors to saved colors.

## Two-Color Gradient

Toggle via **Gradient** button in toolbar or **G** key.
- Click each endpoint swatch to set from the current color
- Gradient is interpolated in L\*a\*b\* for perceptual uniformity
- Click anywhere on the gradient bar to pick an intermediate color

## Three-Color Triangle

Toggle via **Triangle** button in toolbar or **T** key.
- Click each corner swatch to set from the current color
- Triangle uses barycentric interpolation in L\*a\*b\*
- Click inside the triangle to pick a color

## Info Panel (Right Panel)

- **Color model info**: description, key equations (monospace), gamut coverage, uniformity rating
- **CIE xy chromaticity diagram**: spectral locus, gamut triangles, current color marker
- **Cone response chart**: L/M/S sensitivity curves (380-780nm)
- **Accuracy meters**: Delta E 2000 display with 3 switchable meter groups (Original, HSB, LMS)

## Gamut Shading on Sliders

Each color slider in the left panel shows visual markers at gamut boundaries:
- **Green dashed line** — transition from undisplayable to displayable
- **Orange dashed line** — transition from displayable to undisplayable
- **Red solid line** — imaginary color boundary (negative cone response)
- Undisplayable regions are subtly dimmed, imaginary regions are red-tinted

## Saved Picker Views

- **Save View** button saves the current 2D picker configuration (space, axes, excluded value)
- **Saved Views dropdown** lets you quickly restore any saved configuration
- Views persist in localStorage across sessions

## Drag and Drop

Drag colors between any UI areas:

**Drag from:**
- 2D picker canvas (drags the current color)
- Any color slider canvas
- Saved color swatches
- Standard collection swatches
- Color harmony swatches

**Drop onto:**
- Current color swatch (sets the color)
- Saved colors strip (adds to saved)
- Palette editor canvas (adds a control point at the drop position)

Visual feedback: drop targets highlight with a dashed blue outline during drag.

**Drop onto 2D picker**: changes the excluded dimension to match the dropped color, so the 2D picker shows a slice containing that color.

## Eyedropper

Click the **Eyedropper** button or press **I**. Uses the EyeDropper API (Chrome/Edge only).

## Palette Editor

Toggle via **Palette Editor** button in toolbar.

### Creating Palettes
- **New** — cycles through presets: Rainbow, Grayscale, Heat, Cool, Random
- **From Image** — median cut quantization (Heckbert 1982) extracts 256 representative colors
- **Random** — generates a random palette with a configurable number of control points (3-32). Each click produces a unique palette.
- **From Saved** — creates a palette from saved colors via spline interpolation
- **Curves** — draw individual R/G/B (or H/S/B) curves in a curves dialog, like a photo editor. Click to add control points, drag to reshape, right-click to remove. Catmull-Rom interpolation between points.
- **Preview Image** — loads an image and maps it to palette indices for cycling preview

### Editing
- **Control points** — right-click to add, shift+click to remove, drag to reposition
- **Spline modes** — Catmull-Rom (smooth), Linear, Bezier (dropdown selector)
- All interpolation done in L\*a\*b\* for perceptual uniformity
- **Selection mode** — click "Select" button, then click+drag on the palette to highlight a range (shown in blue). Then use Cut/Copy/Paste buttons to manipulate the selection. Paste resamples if the destination is a different size.

### Shape Drawing on 2D Picker
Dropdown with 5 shape modes for creating palettes from the 2D color picker:
- **Freehand** — draw freely, colors sampled along the path
- **Line** — click two points, colors sampled along the line
- **Rectangle** — click two corners, colors sampled around the perimeter
- **Ellipse** — click center + drag radius, colors sampled around circumference
- **Polygon** — click vertices, double-click to close, colors sampled along edges
All shapes show a live preview overlay. Press Escape to cancel.

### Adjustments
- **Hue shift** (+/- 30deg) — rotates hue in HSB space
- **Saturation** (+/- 15) — adjusts saturation in HSB space
- **Brightness** (+/- 10 L\*) — adjusts lightness in L\*a\*b\*
- **Reverse** — reverses palette order
- **Smooth** — averages neighboring colors
- **Channel Mix** — 3x3 RGB matrix with presets (Identity, Grayscale, Sepia, Swap R/B, Invert). Clip or normalize modes.

### Blending
- **Blend** — pick two saved palettes and slide between them (interpolated in L\*a\*b\*)
- Preview image updates live during blend

### Animation
- **Rotate** slider (0-255) — shifts the palette display
- **Animate** slider — continuous rotation at adjustable speed
- With a preview image loaded, this creates classic palette cycling animation

### Draw on Picker
Click **"Draw on Picker"** to enter drawing mode:
- Draw a freehand path on the 2D color picker with the mouse
- The path is visualized as a white line with green (start) and red (end) markers
- On mouse-up, the path is sampled at 256 equal arc-length intervals
- Each sample becomes one palette entry — the color at that position on the 2D picker
- Creates 12 control points for further editing
- Click the button again (now labeled "Stop Drawing") to cancel

### Import/Export
- **Save/Load** palettes by name (persisted in localStorage)
- **Export** as PNG, JPEG, BMP (256x32 image), JSON, or GIMP Palette (.gpl)
- BMP export builds the file byte-by-byte (no canvas dependency)

## 3D Color Space Viewer (Right Panel)

Interactive WebGL visualization of any color space:
- **Point cloud** of sample colors showing the shape of the space
- **Density slider** — adjust point count (8-28 grid steps)
- **Size slider** — adjust point radius (1-8 pixels)
- Out-of-gamut points drawn smaller and dimmer
- **Current color marker** shown as a larger white point
- **Palette trace** drawn as a colored line strip through 3D space
- **Wireframe**: cube for rectangular spaces, **cylinder** for HSB/HSL/LCh (hue = angle)
- Cylindrical view uses area-compensated sampling (no radial spoke artifacts)
- **Axis labels**: component names for cubes, cardinal hue angles (0/90/180/270deg) for cylinders
- **Drag** to rotate, **scroll** to zoom
- **Dropdown** to switch which color space is visualized
- **Stereo 3D modes** (dropdown): Mono, Red/Cyan, Blue/Yellow, Magenta/Green, Cross-eyed, Parallel
- **Palette trace** button shows the current 256-color palette as a 3D line through any color space
- **Dual-space view** checkbox renders two color spaces side by side for comparison
- **Image button** — load any image to show its color distribution as a 3D point cloud. See where an image's colors live in any color space.

## Color History (Bottom Bar)

Tracks the last 30 colors you've picked as tiny swatches:
- Records on mouse-up (end of drag), not during slider movement
- Click any history swatch to restore that color
- **x** button to clear the history

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+C | Copy hex to clipboard |
| Ctrl+V | Paste hex from clipboard |
| I | Eyedropper |
| S | Save current color |
| G | Toggle two-color gradient |
| T | Toggle three-color triangle |
| R | Rotate picker axes |

## State Persistence

- All settings, saved colors, and palettes persist via localStorage
- **Clean Slate** resets to defaults but preserves saved colors and palettes
- **Undo/Redo** stack (max 100 entries) for color and picker changes

## Technical

- 10,000+ lines of pure HTML/CSS/JS — zero dependencies, no build tools
- ES modules loaded natively by the browser
- WebGL fragment shaders for GPU-accelerated 2D picker rendering
- All 9 color space conversions implemented in both JavaScript and GLSL
- Full CIEDE2000 Delta E implementation
- Stockman & Sharpe cone fundamentals (89 data points, 390-830nm)
- CIE 1931 color matching functions (81 data points, 380-780nm)
- Responsive layout (1000px and 600px breakpoints)
- Dark theme with CSS custom properties
