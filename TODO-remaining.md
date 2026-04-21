# Remaining Features to Implement

## Not Yet Built

1. ~~**ICC Profile Support**~~ ✅ DONE
   - Parses ICC binary, extracts matrix + TRC, registers as color space

2. ~~**Arbitrary Coordinate System Rotation**~~ ✅ DONE
   - Two rotation sliders tilt the 2D picker's slice plane through 3D color space
   - CPU-rendered on overlay canvas at 128x128, mouse picking with inverse rotation

3. ~~**RBF-based 2D Gradient Extrapolation**~~ ✅ DONE
   - Thin-plate spline RBF, Gaussian elimination solver, overlay rendering

4. ~~**Palette Drawing with Scroll-Wheel Exhaustion**~~ ✅ DONE
   - Scroll wheel during freehand drawing modulates exhaustion rate (×0.01 to ×100)
   - Floating indicator near cursor shows current rate
   - Palette entries filled in real-time as mouse moves

5. ~~**Color Preview Image During Palette Blend**~~ ✅ DONE (already worked)

6. ~~**Blue/Amber (ColorCode) Anaglyph**~~ ✅ DONE

7. ~~**Drag Colors FROM Palette Strip**~~ ✅ DONE (Alt+click)

8. ~~**Six-Dimension Color Opponent Model**~~ ✅ DONE
   - 6 uni-polar sliders: Red, Green, Yellow, Blue, White, Black
   - Linked pairs: R↔G, Y↔B, W↔K mapped to 3-channel opponent model
