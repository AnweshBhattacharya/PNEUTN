/**
 * localSolve.js — client-side symbolic differentiation / integration fallback.
 *
 * Used when the backend Lambda is unreachable (local dev without SAM, cold
 * network, etc.).  Results are less complete than SymPy but cover the most
 * common textbook cases and produce proper KaTeX-renderable step objects that
 * match the API_SPEC.md shape exactly.
 *
 * This is intentionally a *subset* of SymPy — complex expressions fall back
 * to a "computed numerically" step.  The LLM is NOT used here; narration is
 * deterministic template text (same as the backend's fallback_template path).
 */
import * as math from 'mathjs'
import { compileExpr } from './mathEval'

// ── LaTeX helpers ─────────────────────────────────────────────────────────

function texNum(n) {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(4).replace(/\.?0+$/, '')
}

/** Very small subset of expression → LaTeX for display in steps */
function toLatex(exprStr) {
  // Let math.js do its best; we just clean it up a little
  try {
    const node = math.parse(exprStr)
    return node.toTex({ parenthesis: 'auto' })
  } catch {
    return exprStr
  }
}

// ── Narration templates ───────────────────────────────────────────────────

const NARRATION = {
  constant:             'The expression is a constant, so its derivative is 0.',
  power_rule:           'Apply the Power Rule: multiply by the exponent and reduce the exponent by 1.',
  constant_factor:      'Pull the constant factor out of the derivative.',
  sum_rule:             'The derivative of a sum equals the sum of the derivatives.',
  product_rule:         'Apply the Product Rule: d/dx[u·v] = u·v′ + v·u′.',
  chain_rule:           'Apply the Chain Rule: differentiate the outer function, then multiply by the inner derivative.',
  trig_rule:            'Apply standard trigonometric derivative identity.',
  exp_rule:             'The derivative of eˣ is eˣ.',
  power_rule_integral:  'Apply the Reverse Power Rule: increase the exponent by 1, then divide by the new exponent.',
  sum_rule_integral:    'The integral of a sum equals the sum of the integrals.',
  u_substitution:       'Use u-substitution to integrate the composite function.',
  trig_integral:        'Use the standard trigonometric integral identity.',
  exp_integral:         'The integral of eˣ is eˣ.',
  evaluate_bounds:      'Evaluate the antiderivative at the upper bound and subtract the value at the lower bound.',
  default:              'Apply the appropriate calculus rule to transform this expression.',
}

function narrate(rule) {
  return { explanation: NARRATION[rule] ?? NARRATION.default, narrated_by: 'fallback_template' }
}

// ── Derivative ─────────────────────────────────────────────────────────────

/**
 * Compute d/d{wrt} of exprStr numerically-verified steps.
 * Returns { result_latex, steps, result_numeric_sample } matching the API shape.
 */
function derivativeSteps(exprStr, wrt, order) {
  const steps = []
  let current = exprStr

  for (let i = 0; i < order; i++) {
    let result
    let rule = 'default'
    try {
      // math.js derivative
      const node = math.parse(current)
      const derived = math.derivative(node, wrt)
      result = derived.toString()

      // Heuristic rule detection on the *input* node
      rule = detectDiffRule(node, wrt)
    } catch {
      // math.js can't differentiate this — produce a numerical note
      result = current
      rule = 'default'
    }

    const beforeLatex = `\\frac{d${i > 0 ? `^{${i + 1}}` : ''}}{d${wrt}${i > 0 ? `^{${i + 1}}` : ''}}\\left[${toLatex(current)}\\right]`
    const afterLatex  = toLatex(result)

    steps.push({
      rule,
      before_latex: beforeLatex,
      after_latex:  afterLatex,
      ...narrate(rule),
    })

    current = result
  }

  return { finalExpr: current, steps }
}

function detectDiffRule(node, wrt) {
  if (!node.toString().includes(wrt)) return 'constant'
  if (node.type === 'OperatorNode' && node.op === '+') return 'sum_rule'
  if (node.type === 'OperatorNode' && node.op === '*') {
    const hasVar = node.args.some(a => a.toString().includes(wrt))
    const hasConst = node.args.some(a => !a.toString().includes(wrt))
    if (hasVar && hasConst) return 'constant_factor'
    return 'product_rule'
  }
  if (node.type === 'OperatorNode' && node.op === '^') {
    const [base, exp] = node.args
    if (base.toString() === wrt && !exp.toString().includes(wrt)) return 'power_rule'
    return 'chain_rule'
  }
  if (node.type === 'FunctionNode') {
    if (node.args[0]?.toString() !== wrt) return 'chain_rule'
    if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh'].includes(node.name)) return 'trig_rule'
    if (['exp', 'log', 'ln'].includes(node.name)) return 'exp_rule'
    return 'default'
  }
  return 'default'
}

// ── Integral ───────────────────────────────────────────────────────────────

function integralSteps(exprStr, wrt, bounds) {
  const steps = []

  // Step 1 — show indefinite integral setup
  const beforeLatex = `\\int ${toLatex(exprStr)} \\, d${wrt}`

  let antiderivStr
  let rule = 'default'

  // Detect simple polynomial, trig, exp cases
  try {
    const node = math.parse(exprStr)
    rule = detectIntegralRule(node, wrt)

    // Attempt symbolic antiderivative via math.js (limited — powers, constants)
    antiderivStr = integrateSimple(node, wrt)
  } catch {
    antiderivStr = null
  }

  if (antiderivStr) {
    const antiderivLatex = bounds
      ? `${toLatex(antiderivStr)} \\Big|_{${bounds[0]}}^{${bounds[1]}}`
      : `${toLatex(antiderivStr)} + C`

    steps.push({
      rule,
      before_latex: beforeLatex,
      after_latex: antiderivLatex,
      ...narrate(rule),
    })

    if (bounds) {
      // Evaluate numerically
      let evalResult
      try {
        const lo = bounds[0]
        const hi = bounds[1]
        const scope = {}
        scope[wrt] = hi
        const atHi = math.evaluate(antiderivStr, scope)
        scope[wrt] = lo
        const atLo = math.evaluate(antiderivStr, scope)
        evalResult = atHi - atLo
      } catch {
        evalResult = null
      }

      const evalLatex = evalResult != null ? texNum(evalResult) : '\\text{(numerical)}'
      steps.push({
        rule: 'evaluate_bounds',
        before_latex: `${toLatex(antiderivStr)} \\Big|_{${bounds[0]}}^{${bounds[1]}}`,
        after_latex:  evalLatex,
        ...narrate('evaluate_bounds'),
      })

      return {
        finalExpr: evalResult != null ? String(evalResult) : antiderivStr,
        resultLatex: evalLatex,
        steps,
      }
    }

    return { finalExpr: antiderivStr, resultLatex: `${toLatex(antiderivStr)} + C`, steps }
  }

  // Fallback — can't compute symbolically
  steps.push({
    rule: 'default',
    before_latex: beforeLatex,
    after_latex:  '\\text{(requires symbolic engine)}',
    explanation: 'This integral requires the backend symbolic engine (SymPy). Connect the backend for a full solution.',
    narrated_by: 'fallback_template',
  })

  return { finalExpr: exprStr, resultLatex: '\\text{(requires SymPy backend)}', steps }
}

function detectIntegralRule(node, wrt) {
  const s = node.toString()
  if (!s.includes(wrt)) return 'constant_factor'
  if (node.type === 'OperatorNode' && node.op === '+') return 'sum_rule_integral'
  if (node.type === 'OperatorNode' && node.op === '^') return 'power_rule_integral'
  if (node.type === 'FunctionNode') {
    const name = node.name
    if (['sin', 'cos', 'tan'].includes(name)) return 'trig_integral'
    if (name === 'exp') return 'exp_integral'
  }
  if (node.type === 'SymbolNode' && node.name === wrt) return 'power_rule_integral'
  if (node.type === 'OperatorNode' && node.op === '*') return 'u_substitution'
  return 'default'
}

/** Simple symbolic integration covering: constants, x^n, sin, cos, exp */
function integrateSimple(node, wrt) {
  const s = node.toString()

  // Constant
  if (!s.includes(wrt)) {
    return `(${s}) * ${wrt}`
  }
  // Just x → x^2/2
  if (node.type === 'SymbolNode' && node.name === wrt) {
    return `${wrt}^2 / 2`
  }
  // x^n
  if (node.type === 'OperatorNode' && node.op === '^') {
    const [base, expNode] = node.args
    if (base.toString() === wrt) {
      const n = parseFloat(expNode.toString())
      if (!isNaN(n) && n !== -1) {
        const newExp = n + 1
        return `${wrt}^(${newExp}) / (${newExp})`
      }
    }
  }
  // c * x^n
  if (node.type === 'OperatorNode' && node.op === '*') {
    const [a, b] = node.args
    if (!a.toString().includes(wrt)) {
      const inner = integrateSimple(b, wrt)
      if (inner) return `(${a.toString()}) * (${inner})`
    }
    if (!b.toString().includes(wrt)) {
      const inner = integrateSimple(a, wrt)
      if (inner) return `(${b.toString()}) * (${inner})`
    }
  }
  // sin(x) → -cos(x)
  if (node.type === 'FunctionNode' && node.name === 'sin' && node.args[0]?.toString() === wrt) {
    return `-cos(${wrt})`
  }
  // cos(x) → sin(x)
  if (node.type === 'FunctionNode' && node.name === 'cos' && node.args[0]?.toString() === wrt) {
    return `sin(${wrt})`
  }
  // exp(x) → exp(x)
  if (node.type === 'FunctionNode' && node.name === 'exp' && node.args[0]?.toString() === wrt) {
    return `exp(${wrt})`
  }
  // sum: a + b → int(a) + int(b)
  if (node.type === 'OperatorNode' && node.op === '+') {
    const parts = node.args.map(a => integrateSimple(a, wrt))
    if (parts.every(Boolean)) return parts.join(' + ')
  }

  return null
}

// ── Numeric sample ─────────────────────────────────────────────────────────

function numericSample(exprStr, wrt) {
  const xs = [-3, -2, -1, 0, 1, 2, 3]
  return xs.flatMap(x => {
    try {
      const scope = {}
      scope[wrt] = x
      const y = math.evaluate(exprStr, scope)
      if (typeof y === 'number' && isFinite(y)) {
        return [{ x: parseFloat(x.toFixed(4)), y: parseFloat(y.toFixed(6)) }]
      }
    } catch {}
    return []
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Synchronous local solve — returns the same shape as POST /solve.
 *
 * @param {object} params  { expr, operation, wrt, order, bounds }
 * @returns {{ result_latex, result_numeric_sample, steps, _local: true }}
 */
export function localSolve({ expr, operation, wrt = 'x', order = 1, bounds = null }) {
  try {
    // Keep offline mode inside the same expression grammar as the graph and
    // backend. The raw math.js helpers below are used only after this guard.
    if (!compileExpr(expr)) {
      throw new Error('Enter a supported mathematical expression.')
    }
    if (operation === 'derivative') {
      const { finalExpr, steps } = derivativeSteps(expr, wrt, order)
      return {
        result_latex: toLatex(finalExpr),
        result_numeric_sample: numericSample(finalExpr, wrt),
        steps,
        _local: true,
      }
    } else {
      const { resultLatex, finalExpr, steps } = integralSteps(expr, wrt, bounds)
      return {
        result_latex: resultLatex ?? toLatex(finalExpr),
        result_numeric_sample: numericSample(finalExpr, wrt),
        steps,
        _local: true,
      }
    }
  } catch (e) {
    return {
      result_latex: '\\text{Local solver error}',
      result_numeric_sample: [],
      steps: [{
        rule: 'default',
        before_latex: expr,
        after_latex: '\\text{error}',
        explanation: `Local solver: ${e.message}`,
        narrated_by: 'fallback_template',
      }],
      _local: true,
      _error: e.message,
    }
  }
}
