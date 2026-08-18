/**
 * mathEval.js — math.js wrapper for client-side live evaluation.
 *
 * Used by GraphCanvas2D/3D to sample a function at many x (and optionally y)
 * values on slider drag, so redraws never need a network call.
 *
 * math.js is loaded lazily to avoid blocking the initial render.
 */
import * as mathjs from 'mathjs'

/** Compile a math expression string once, returns a reusable evaluator. */
export function compileExpr(exprStr) {
  try {
    return mathjs.compile(exprStr)
  } catch {
    return null
  }
}

/**
 * Evaluate expr at a single point.
 * @param {Object} compiled  — result of compileExpr()
 * @param {Object} scope     — variable bindings, e.g. { x: 1.5, y: 2.0 }
 * @returns {number|null}
 */
export function evalAt(compiled, scope) {
  if (!compiled) return null
  try {
    const result = compiled.evaluate(scope)
    if (typeof result !== 'number' || !isFinite(result)) return null
    return result
  } catch {
    return null
  }
}

/**
 * Sample a 1D function f(x) over [xMin, xMax] at nPoints.
 * Returns an array of { x, y } objects, skipping non-finite values.
 *
 * @param {string} exprStr   — e.g. "x^2 * sin(x)"
 * @param {number} xMin
 * @param {number} xMax
 * @param {number} nPoints   — default 200
 * @param {Object} extraVars — extra variable bindings (e.g. { a: 2 } for sliders)
 * @returns {{ x: number, y: number }[]}
 */
export function sample1D(exprStr, xMin, xMax, nPoints = 200, extraVars = {}) {
  const compiled = compileExpr(exprStr)
  if (!compiled) return []

  // Guard: nPoints ≤ 0 → empty; nPoints === 1 → single sample at xMin (no division)
  if (nPoints <= 0) return []
  if (nPoints === 1) {
    const y = evalAt(compiled, { x: xMin, ...extraVars })
    return y !== null ? [{ x: xMin, y }] : []
  }

  const points = []
  const step = (xMax - xMin) / (nPoints - 1)

  for (let i = 0; i < nPoints; i++) {
    const x = xMin + i * step
    const y = evalAt(compiled, { x, ...extraVars })
    if (y !== null) {
      points.push({ x, y })
    }
  }

  return points
}

/**
 * Sample a 2D surface f(x, y) over a grid.
 * Returns a flat Float32Array of z-values in row-major order (for Three.js).
 *
 * @param {string} exprStr
 * @param {number} xMin
 * @param {number} xMax
 * @param {number} yMin
 * @param {number} yMax
 * @param {number} segments — grid segments per axis (segments+1 vertices per side)
 * @param {Object} extraVars
 * @returns {Float32Array}
 */
export function sample2DGrid(exprStr, xMin, xMax, yMin, yMax, segments = 40, extraVars = {}) {
  const compiled = compileExpr(exprStr)
  const count = (segments + 1) * (segments + 1)
  const zValues = new Float32Array(count)

  if (!compiled) return zValues

  const xStep = (xMax - xMin) / segments
  const yStep = (yMax - yMin) / segments
  let idx = 0

  for (let j = 0; j <= segments; j++) {
    const y = yMin + j * yStep
    for (let i = 0; i <= segments; i++) {
      const x = xMin + i * xStep
      const z = evalAt(compiled, { x, y, ...extraVars })
      zValues[idx++] = z !== null ? Math.max(-10, Math.min(10, z)) : 0
    }
  }

  return zValues
}
