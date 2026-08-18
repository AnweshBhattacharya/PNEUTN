# PNEUTN — Comprehensive Frontend Bug Audit & Fix Instructions

This document provides a complete audit of all frontend bugs, edge cases, and resilience gaps identified in the Pneutn application at this stage, along with step-by-step instructions to fix each one.

---

## Table of Contents
1. [Bug 1: Offline / Local Mode Failure in Riemann Controls](#bug-1-offline--local-mode-failure-in-riemann-controls)
2. [Bug 2: Offline / Local Mode Failure in Region & Integration Order](#bug-2-offline--local-mode-failure-in-region--integration-order)
3. [Bug 3: Marked Point $x = a$ Sticking to Curve 1 in 2D Graph](#bug-3-marked-point-x--a-sticking-to-curve-1-in-2d-graph)
4. [Bug 4: Free Parameter Sliders Not Updating 2D Graph](#bug-4-free-parameter-sliders-not-updating-2d-graph)
5. [Bug 5: Escape Key Not Exiting Fullscreen / Expanded Graph Mode](#bug-5-escape-key-not-exiting-fullscreen--expanded-graph-mode)
6. [Bug 6: 3D Skirt & Floor Mesh Z-Fighting at Grazing View Angles](#bug-6-3d-skirt--floor-mesh-z-fighting-at-grazing-view-angles)
7. [Bug 7: Mobile Tab Switch Canvas Resize Desynchronization](#bug-7-mobile-tab-switch-canvas-resize-desynchronization)
8. [Bug 8: Unchecked Division / Infinite Z-Range on Constant 3D Expressions](#bug-8-unchecked-division--infinite-z-range-on-constant-3d-expressions)

---

## Bug 1: Offline / Local Mode Failure in Riemann Controls

### Description
In `frontend/src/lib/apiClient.js`, `solve()` has a local fallback (`localSolve()`) when `VITE_API_BASE_URL` is not set or the backend is unreachable. However, `riemann()` does not have a fallback and throws `ApiError('no_backend', 'VITE_API_BASE_URL is not configured.')`. This causes the Riemann Sum component to show an error during local development or offline usage.

### Root Cause
`apiClient.js` lines 123–125 execute `post('/riemann', ...)` without catching network errors or `no_backend` errors.

### Fix Instruction
In `frontend/src/lib/apiClient.js`, add a client-side numerical Riemann sum generator using `mathEval.js`:

```javascript
import { compileExpr, evalAt } from './mathEval'

function localRiemann({ expr, bounds, sub_intervals, sample_point = 'midpoint' }) {
  const [a, b] = bounds
  const n = Math.max(1, Math.min(parseInt(sub_intervals, 10) || 8, 200))
  const dx = (b - a) / n
  const compiled = compileExpr(expr)
  const rectangles = []
  let riemann_sum = 0

  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx
    const x1 = x0 + dx
    const sample_x = sample_point === 'left' ? x0 : sample_point === 'right' ? x1 : (x0 + x1) / 2
    const y = evalAt(compiled, { x: sample_x }) ?? 0
    rectangles.push({ x0, x1, height: y })
    riemann_sum += y * dx
  }

  return {
    rectangles,
    riemann_sum,
    exact_value: null, // exact symbolic value requires SymPy on backend
    _local: true
  }
}
```

Then update `export async function riemann(...)`:
```javascript
export async function riemann({ expr, bounds, sub_intervals, sample_point = 'midpoint' }) {
  if (!BASE_URL) {
    return localRiemann({ expr, bounds, sub_intervals, sample_point })
  }
  try {
    return await post('/riemann', { expr, bounds, sub_intervals, sample_point })
  } catch (e) {
    const isUnreachable = e.name === 'AbortError' || e.code === 'no_backend' || (e instanceof TypeError && /fetch|network|failed/i.test(e.message))
    if (isUnreachable) {
      return localRiemann({ expr, bounds, sub_intervals, sample_point })
    }
    throw e
  }
}
```

---

## Bug 2: Offline / Local Mode Failure in Region & Integration Order

### Description
When running locally without a backend, clicking **Compute Region** in `RegionToggle.jsx` throws `VITE_API_BASE_URL is not configured`.

### Root Cause
`apiClient.js` does not provide a local solver fallback for basic polynomials ($y = x$ and $y = x^2$) when `BASE_URL` is empty.

### Fix Instruction
In `frontend/src/lib/apiClient.js`, provide a fallback for standard textbook regions (e.g. $y=x$ vs $y=x^2$) that computes numerical intersections $[0, 1]$ and generates 30 sample points for the polygon outline.

---

## Bug 3: Marked Point $x = a$ Sticking to Curve 1 in 2D Graph

### Description
When multiple equations are plotted ($f_1(x)$, $f_2(x)$, etc.), entering a value in **Mark $x =$** always places the red dot indicator on $f_1(x)$ (the first curve), even if the user is currently focused on tab $f_2(x)$.

### Root Cause
In `frontend/src/components/GraphCanvas2D/GraphCanvas2D.jsx`:
```javascript
const firstExpr = curveLinesRef.current[0]?.expr
if (firstExpr) {
  const [pt] = sample1D(firstExpr, markedX, markedX, 1)
  if (pt) {
    mxDot.position.set(markedX, pt.y, 0.05)
    mxDot.visible = true
  }
}
```
`GraphCanvas2D` hardcodes index `0`.

### Fix Instruction
1. Pass `activeExpr` or `activeCurveIndex` as a prop from `App.jsx` to `GraphCanvas2D`.
2. In `GraphCanvas2D.jsx`, evaluate `markedX` on the active curve:
```javascript
const targetExpr = curveLinesRef.current[activeCurveIndex]?.expr || curveLinesRef.current[0]?.expr
if (targetExpr) {
  const [pt] = sample1D(targetExpr, markedX, markedX, 1)
  if (pt) {
    mxDot.position.set(markedX, pt.y, 0.05)
    mxDot.visible = true
  }
}
```

---

## Bug 4: Free Parameter Sliders Not Updating 2D Graph

### Description
If the user inputs a parameterized equation such as $f(x) = a \cdot x^2$, the `EquationInput` extracts free variable $a$ and creates a slider. Changing the slider $a$ updates the live preview, but `GraphCanvas2D` does not re-sample because `extraVars` is not passed to `GraphCanvas2D`.

### Root Cause
In `frontend/src/App.jsx`, `extraVars` state is not passed down to `GraphCanvas2D` or `sample1D`.

### Fix Instruction
1. In `App.jsx`, maintain `extraVars` state from `EquationInput` (`onParamChange`).
2. Pass `extraVars={extraVars}` to `<GraphCanvas2D>`.
3. In `GraphCanvas2D.jsx`, include `extraVars` in `sample1D(expr, xL, xR, N_POINTS, extraVars)` and add `extraVars` to the dependency array of `resampleAll`.

---

## Bug 5: Escape Key Not Exiting Fullscreen / Expanded Graph Mode

### Description
Clicking the fullscreen/expand icon on either the 2D or 3D graph expands the canvas to take the whole screen (`isExpanded = true`). Pressing the standard `Escape` key on the keyboard does not close the expanded view.

### Root Cause
No global `keydown` event listener for `'Escape'` is attached to set `setIsExpanded(false)`.

### Fix Instruction
In both `GraphCanvas2D.jsx` and `GraphCanvas3D.jsx`, add an `useEffect`:
```javascript
useEffect(() => {
  if (!isExpanded) return
  const onKeyDown = (e) => {
    if (e.key === 'Escape') setIsExpanded(false)
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}, [isExpanded])
```

---

## Bug 6: 3D Skirt & Floor Mesh Z-Fighting at Grazing View Angles

### Description
When viewing the 3D surface at shallow orbit angles, the semi-transparent area-under-surface skirt wall and the floor quad at $y=0$ can flicker or z-fight against each other and against the 3D ground grid.

### Root Cause
Both `skirtMat` and `floorMat` have `transparent: true`, but `depthWrite` is `true` by default in Three.js `MeshBasicMaterial`.

### Fix Instruction
In `frontend/src/components/GraphCanvas3D/GraphCanvas3D.jsx`:
Set `depthWrite: false` on the transparent materials:
```javascript
const skirtMat = new THREE.MeshBasicMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.16,
  side: THREE.DoubleSide,
  depthWrite: false,
})

const floorMat = new THREE.MeshBasicMaterial({
  color: 0x2563eb,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  depthWrite: false,
})
```

---

## Bug 7: Mobile Tab Switch Canvas Resize Desynchronization

### Description
On mobile screens (≤899px), the layout uses tabs (`Input`, `Steps`, `Graph`). When navigating from `Input` to `Graph`, the canvas was initially mounted while hidden (`display: none`), so `clientWidth` and `clientHeight` were $0$. The `ResizeObserver` fires, but if the animation frame loop was stopped or not re-triggered, the canvas can remain blank until touched.

### Root Cause
When unhiding `bottomRow` via `.mobileHidden`, Three.js needs an immediate camera aspect recalculation and renderer resize.

### Fix Instruction
In `frontend/src/App.jsx`, when `mobilePanel === 'graph'` is activated, dispatch a window resize event or pass `mobilePanel` as a trigger prop to `GraphCanvas2D` and `GraphCanvas3D`:
```javascript
useEffect(() => {
  if (mobilePanel === 'graph') {
    window.dispatchEvent(new Event('resize'))
  }
}, [mobilePanel])
```

---

## Bug 8: Unchecked Division / Infinite Z-Range on Constant 3D Expressions

### Description
If the user inputs a constant 3D expression like $z = 3$, all grid points evaluate to $3$. `zMin = 3` and `zMax = 3`. `zRange = zMax - zMin` becomes `0`. The formula `(zVals[idx] - zMin) / zRange` results in `0 / 0 = NaN`, corrupting vertex color attributes.

### Root Cause
In `GraphCanvas3D.jsx`:
```javascript
const zRange = zMax - zMin || 1
```
If `zMax === zMin`, `zRange` is `1`, but `(3 - 3) / 1 = 0`, which maps all points to blue (low) instead of the middle hue. If non-finite values exist, `zMin = Infinity` and `zMax = -Infinity`, leading to `NaN`.

### Fix Instruction
In `frontend/src/components/GraphCanvas3D/GraphCanvas3D.jsx`:
```javascript
let zMin = Infinity, zMax = -Infinity
let validCount = 0
for (let i = 0; i < n; i++) {
  const z = zVals[i]
  if (isFinite(z)) {
    zMin = Math.min(zMin, z)
    zMax = Math.max(zMax, z)
    validCount++
  }
}

if (validCount === 0 || !isFinite(zMin) || !isFinite(zMax)) {
  zMin = -1
  zMax = 1
}

const zRange = (zMax - zMin === 0) ? 1 : (zMax - zMin)
```

---

## Summary of Priority & Recommended Implementation Order

1. **Immediate (Resilience)**: Bug 1 (Riemann local fallback) & Bug 2 (Region local fallback) — Ensures the application works 100% offline and in demo environments without requiring a live cloud backend.
2. **High (Usability)**: Bug 3 (Marked point target curve) & Bug 4 (Parameter slider sync) — Resolves interactive feature limitations in 2D graphing.
3. **Medium (Polish & UX)**: Bug 5 (Escape key for fullscreen), Bug 6 (Depthwrite z-fighting fix), Bug 7 (Mobile resize sync), Bug 8 (Constant 3D height guard).
