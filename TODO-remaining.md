# Remaining Features to Implement

## Not Yet Built

1. ~~**ICC Profile Support**~~ ✅ DONE
   - Parses ICC binary, extracts matrix + TRC, registers as color space

2. ~~**Arbitrary Coordinate System Rotation**~~ ✅ DONE
   - Two rotation sliders tilt the 2D picker's slice plane through 3D color space
   - CPU-rendered on overlay canvas at 128x128, mouse picking with inverse rotation

3. ~~**RBF-based 2D Gradient Extrapolation**~~ ✅ DONE
   - Thin-plate spline RBF, Gaussian elimination solver, overlay rendering

4. **Palette Drawing with Scroll-Wheel Exhaustion** (todo line 55) — Medium
   - When drawing a palette onto the 2D picker, scroll wheel modulates exhaustion rate
   - Faster turning = faster palette index consumption
   - Reverse turning = reverse exhaustion
   - Show a floating logarithmic slider near the mouse showing current rate
   - Note: core drawing already works (freehand + 5 shape modes), this is an enhancement

5. ~~**Color Preview Image During Palette Blend**~~ ✅ DONE (already worked)

6. ~~**Blue/Amber (ColorCode) Anaglyph**~~ ✅ DONE

7. ~~**Drag Colors FROM Palette Strip**~~ ✅ DONE (Alt+click)

8. **Six-Dimension Color Opponent Model** (todo line 118) — Medium
   - R, B, W, K, Y, G as six dimensions without requiring orthogonality
   - "preferred model" per the todo
