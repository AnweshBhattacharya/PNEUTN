/**
 * mathEval.js — math.js wrapper for client-side live evaluation.
 *
 * Used by GraphCanvas2D/3D to sample a function at many x (and optionally y)
 * values on slider drag, so redraws never need a network call.
 *
 * math.js is loaded lazily to avoid blocking the initial render.
 */
import { all, create } from 'mathjs'
import { normaliseMathExpression } from './mathInput'

// The graph compiler receives user input, so do not expose the whole math.js
// expression language. This follows math.js's security guidance while keeping
// the calculus syntax supported by the backend and graph controls.
const math = create(all)
const parseExpression = math.parse

math.import({
  import: () => { throw new Error('Function import is disabled') },
  createUnit: () => { throw new Error('Function createUnit is disabled') },
  reviver: () => { throw new Error('Function reviver is disabled') },
  evaluate: () => { throw new Error('Function evaluate is disabled') },
  parse: () => { throw new Error('Function parse is disabled') },
  simplify: () => { throw new Error('Function simplify is disabled') },
  derivative: () => { throw new Error('Function derivative is disabled') },
  resolve: () => { throw new Error('Function resolve is disabled') },
}, { override: true })

const SAFE_CHARACTERS = /^[0-9a-zA-Z\s+\-*/^().,]+$/
const ALLOWED_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'exp', 'log', 'sqrt',
  'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'asinh', 'acosh', 'atanh', 'abs', 'sign',
])
const ALLOWED_OPERATORS = new Set(['+', '-', '*', '/', '^'])

function normaliseForEvaluation(exprStr) {
  return normaliseMathExpression(exprStr)
    .replace(/\bAbs\s*(?=\()/g, 'abs')
}

function isAllowedSymbol(name) {
  // Single-letter variables retain support for graph parameter sliders, while
  // blocking math.js namespace names such as `import` and `createUnit`.
  return /^[a-zA-Z]$/.test(name) || name === 'pi' || name === 'E'
}

function validateNode(node) {
  switch (node.type) {
    case 'ConstantNode':
      return
    case 'SymbolNode':
      if (!isAllowedSymbol(node.name)) throw new Error('Disallowed symbol')
      return
    case 'ParenthesisNode':
      validateNode(node.content)
      return
    case 'OperatorNode':
      if (!ALLOWED_OPERATORS.has(node.op)) throw new Error('Disallowed operator')
      node.args.forEach(validateNode)
      return
    case 'FunctionNode':
      if (!ALLOWED_FUNCTIONS.has(node.name)) throw new Error('Disallowed function')
      node.args.forEach(validateNode)
      return
    default:
      // Assignment, accessors, matrices, ranges, blocks, and function
      // definitions are outside the calculator grammar and are rejected.
      throw new Error(`Disallowed expression node: ${node.type}`)
  }
}

function parseSafeExpression(exprStr) {
  if (typeof exprStr !== 'string' || exprStr.length > 200 || !SAFE_CHARACTERS.test(exprStr)) {
    throw new Error('Invalid expression')
  }
  const node = parseExpression(normaliseForEvaluation(exprStr))
  validateNode(node)
  return node
}

/** Compile a math expression string once, returns a reusable evaluator. */
export function compileExpr(exprStr) {
  try {
    return parseSafeExpression(exprStr).compile()
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
    const safeScope = new Map(Object.entries(scope || {}))
    safeScope.set('pi', Math.PI)
    safeScope.set('E', Math.E)
    const result = compiled.evaluate(safeScope)
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
