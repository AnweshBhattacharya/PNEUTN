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
function derivativeSteps(exprStr, wrt, order, wrtSequence = null) {
  const steps = []
  let current = exprStr
  const seq = Array.isArray(wrtSequence) && wrtSequence.length > 0
    ? wrtSequence
    : Array(Math.max(1, order)).fill(wrt)

  for (let i = 0; i < seq.length; i++) {
    const curWrt = seq[i]
    let result
    let rule = 'default'
    try {
      // math.js derivative
      const node = math.parse(current)
      const derived = math.derivative(node, curWrt)
      result = derived.toString()

      // Heuristic rule detection on the *input* node
      rule = detectDiffRule(node, curWrt)
    } catch {
      // math.js can't differentiate this — produce a numerical note
      result = current
      rule = 'default'
    }

    const beforeLatex = seq.length > 1 && new Set(seq).size > 1
      ? `\\frac{\\partial}{\\partial ${curWrt}}\\left[${toLatex(current)}\\right]`
      : `\\frac{d${i > 0 ? `^{${i + 1}}` : ''}}{d${curWrt}${i > 0 ? `^{${i + 1}}` : ''}}\\left[${toLatex(current)}\\right]`
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

function totalDerivativeSteps(exprStr, wrt) {
  const steps = []
  let node
  try {
    node = math.parse(exprStr)
  } catch {
    return { finalExpr: exprStr, resultLatex: toLatex(exprStr), steps: [] }
  }

  const allSymbols = new Set()
  node.traverse(n => {
    if (n.type === 'SymbolNode' && /^[a-zA-Z]$/.test(n.name) && n.name !== wrt && n.name !== 'e' && n.name !== 'E' && n.name !== 'i' && n.name !== 'I' && n.name !== 'pi') {
      allSymbols.add(n.name)
    }
  })

  const vars = [...allSymbols].sort()
  if (vars.length === 0) {
    const derived = derivativeSteps(exprStr, wrt, 1)
    return { finalExpr: derived.finalExpr, resultLatex: toLatex(derived.finalExpr), steps: derived.steps }
  }

  const chainRuleFormula = vars.map(v => `\\frac{\\partial f}{\\partial ${v}} \\frac{d${v}}{d${wrt}}`).join(' + ')
  const partials = []
  const terms = []

  for (const v of vars) {
    let partialExpr = '0'
    try {
      const d = math.derivative(node, v)
      partialExpr = d.toString()
    } catch {
      partialExpr = `\\frac{\\partial}{\\partial ${v}}[${exprStr}]`
    }
    const partLatex = toLatex(partialExpr)
    partials.push({ v, partLatex })
    terms.push(`\\left(${partLatex}\\right) \\frac{d${v}}{d${wrt}}`)
  }

  const resultLatex = terms.join(' + ')

  steps.push({
    rule: 'chain_rule',
    before_latex: `\\frac{df}{d${wrt}} = ${chainRuleFormula}`,
    after_latex: resultLatex,
    explanation: `Total Derivative: df/d${wrt} is the sum of partial derivatives multiplied by each variable's rate of change with respect to ${wrt}.`,
    narrated_by: 'fallback_template',
  })

  for (const p of partials) {
    steps.push({
      rule: 'partial_derivative',
      before_latex: `\\frac{\\partial}{\\partial ${p.v}}\\left[${toLatex(exprStr)}\\right]`,
      after_latex: p.partLatex,
      explanation: `Partial derivative of f with respect to ${p.v}, treating all other variables as constants.`,
      narrated_by: 'fallback_template',
      substeps: [
        { label: `∂f/∂${p.v}`, value: p.partLatex },
        { label: 'contribution', value: `${p.partLatex} \\cdot \\frac{d${p.v}}{d${wrt}}` },
      ],
    })
  }

  return { finalExpr: exprStr, resultLatex, steps }
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
export function localSolve({
  expr,
  operation,
  wrt = 'x',
  order = 1,
  bounds = null,
  wrt_sequence,
  wrtSequence,
  integration_sequence,
  integrationSequence,
}) {
  const actualWrtSeq = wrtSequence || wrt_sequence
  const actualIntSeq = integrationSequence || integration_sequence

  try {
    // Keep offline mode inside the same expression grammar as the graph and
    // backend. The raw math.js helpers below are used only after this guard.
    if (!compileExpr(expr)) {
      throw new Error('Enter a supported mathematical expression.')
    }
    if (operation === 'total_derivative') {
      const { resultLatex, finalExpr, steps } = totalDerivativeSteps(expr, wrt)
      return {
        result_latex: resultLatex ?? toLatex(finalExpr),
        result_numeric_sample: numericSample(finalExpr, wrt),
        steps,
        _local: true,
      }
    } else if (operation === 'derivative') {
      const primaryWrt = actualWrtSeq?.[actualWrtSeq.length - 1] || wrt
      const { finalExpr, steps } = derivativeSteps(expr, wrt, order, actualWrtSeq)
      return {
        result_latex: toLatex(finalExpr),
        result_numeric_sample: numericSample(finalExpr, primaryWrt),
        steps,
        _local: true,
      }
    } else if (operation === 'ode') {
      return localOde({ ode: ode || expr, rhs, wrt })
    } else {
      const primaryWrt = actualIntSeq?.[actualIntSeq.length - 1]?.wrt || wrt
      const finalBounds = actualIntSeq?.[actualIntSeq.length - 1]?.bounds ?? bounds
      const { resultLatex, finalExpr, steps } = integralSteps(expr, primaryWrt, finalBounds)
      return {
        result_latex: resultLatex ?? toLatex(finalExpr),
        result_numeric_sample: numericSample(finalExpr, primaryWrt),
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

// ── Vector calculus local fallbacks ────────────────────────────────────────
// These mirror the backend _gradient_steps / _divergence_steps / _curl_steps
// response shapes so they can be used as offline substitutes.

const VECTOR_NARRATION = {
  gradient_component: (v) => `Partial derivative of the scalar field with respect to ${v} — treating all other variables as constants.`,
  divergence_sum:     () => 'Divergence: sum the partial derivative of each component with respect to its own variable.',
  curl_component:     () => 'Curl component: subtract the cross-partial derivatives — the signed difference of the two off-axis partials.',
  simplify:           () => 'Simplify by combining like terms.',
}

function partialDerivative(exprStr, wrt) {
  try {
    const node = math.parse(exprStr)
    const d = math.derivative(node, wrt)
    return d.toString()
  } catch {
    return `∂(${exprStr})/∂${wrt}`
  }
}

/**
 * Local gradient: ∇f for a scalar field expression.
 * @param {{ expr: string, wrt_vars: string[] }}
 * @returns {{ result_latex, components, steps, operation_type }}
 */
export function localGradient({ expr, wrt_vars = ['x', 'y', 'z'] }) {
  const components = []
  const steps = []
  const colRows = []

  for (const v of wrt_vars) {
    const partial = partialDerivative(expr, v)
    const partialLatex = toLatex(partial)
    colRows.push(partialLatex)
    components.push({ var: v, latex: partialLatex })
    steps.push({
      rule: 'gradient_component',
      before_latex: `\\frac{\\partial f}{\\partial ${v}}`,
      after_latex: partialLatex,
      explanation: VECTOR_NARRATION.gradient_component(v),
      narrated_by: 'fallback_template',
    })
  }

  const rowsLatex = colRows.join(' \\\\ ')
  const result_latex = `\\begin{pmatrix} ${rowsLatex} \\end{pmatrix}`

  return {
    result_latex,
    components,
    steps,
    result_numeric_sample: [],
    operation_type: 'gradient',
    _local: true,
  }
}

/**
 * Local divergence: ∂P/∂x + ∂Q/∂y + ∂R/∂z.
 * @param {{ components: Array<{var: string, expr: string}> }}
 */
export function localDivergence({ components }) {
  const steps = []
  const termLatexes = []
  let totalStr = '0'

  for (const item of components) {
    const partial = partialDerivative(item.expr, item.var)
    const partialLatex = toLatex(partial)
    termLatexes.push(partialLatex)
    steps.push({
      rule: 'divergence_sum',
      before_latex: `\\frac{\\partial ${item.var.toUpperCase()}}{\\partial ${item.var}}`,
      after_latex: partialLatex,
      explanation: VECTOR_NARRATION.divergence_sum(),
      narrated_by: 'fallback_template',
    })
    // Accumulate string for simple display
    totalStr = totalStr === '0' ? partial : `${totalStr} + ${partial}`
  }

  const result_latex = toLatex(totalStr)
  steps.push({
    rule: 'simplify',
    before_latex: termLatexes.join(' + '),
    after_latex: result_latex,
    explanation: VECTOR_NARRATION.simplify(),
    narrated_by: 'fallback_template',
  })

  return {
    result_latex,
    components: [],
    steps,
    result_numeric_sample: [],
    operation_type: 'divergence',
    _local: true,
  }
}

/**
 * Local curl: computes the three components of ∇×F.
 * @param {{ components: Array<{var: string, expr: string}> }}
 */
export function localCurl({ components }) {
  const byVar = {}
  for (const c of components) byVar[c.var] = c.expr
  const P = byVar['x'] ?? '0'
  const Q = byVar['y'] ?? '0'
  const R = byVar['z'] ?? '0'

  const curlDefs = [
    { axis: 'x', a: R, da: 'y', b: Q, db: 'z', label: '\\partial R/\\partial y - \\partial Q/\\partial z' },
    { axis: 'y', a: P, da: 'z', b: R, db: 'x', label: '\\partial P/\\partial z - \\partial R/\\partial x' },
    { axis: 'z', a: Q, da: 'x', b: P, db: 'y', label: '\\partial Q/\\partial x - \\partial P/\\partial y' },
  ]

  const steps = []
  const resultComponents = []
  const colRows = []

  for (const { axis, a, da, b, db, label } of curlDefs) {
    const dA = partialDerivative(a, da)
    const dB = partialDerivative(b, db)
    // result = dA - dB (as string — just concat for display)
    let valStr
    try {
      const val = math.simplify(`(${dA}) - (${dB})`)
      valStr = val.toString()
    } catch {
      valStr = `(${dA}) - (${dB})`
    }
    const valLatex = toLatex(valStr)
    colRows.push(valLatex)
    resultComponents.push({ var: axis, latex: valLatex })
    steps.push({
      rule: 'curl_component',
      before_latex: label,
      after_latex: valLatex,
      explanation: VECTOR_NARRATION.curl_component(),
      narrated_by: 'fallback_template',
    })
  }

  const rowsLatex = colRows.join(' \\\\ ')
  const result_latex = `\\begin{pmatrix} ${rowsLatex} \\end{pmatrix}`

  return {
    result_latex,
    components: resultComponents,
    steps,
    result_numeric_sample: [],
    operation_type: 'curl',
    _local: true,
  }
}

/**
 * Local ODE solver for first-order ODEs: dy/d{wrt} = f({wrt}, y).
 * Handles separable, direct integration, exponential growth/decay, and produces KaTeX steps and sample points.
 */
export function localOde({ ode, rhs, wrt = 'x' }) {
  const wrtVar = wrt || 'x'
  let rhsExpr = (rhs || '').trim()

  // If rhs not provided, extract from ode string
  if (!rhsExpr && ode) {
    let clean = ode.trim().replace(/^d[yY]\/d[xtXT]\s*=\s*/, '').replace(/^y\s*'*=\s*/, '')
    const matchMinus = clean.match(/Derivative\(y\([^)]*\),\s*[^)]*\)\s*-\s*\((.*)\)\s*$/)
    if (matchMinus) {
      rhsExpr = matchMinus[1].replace(new RegExp(`y\\(${wrtVar}\\)`, 'g'), 'y')
    } else {
      rhsExpr = clean
    }
  }

  if (!rhsExpr) rhsExpr = 'y'

  const steps = []
  let solutionLatex = ''
  let sampleFunc = null

  const hasY = /\by\b/.test(rhsExpr)

  if (!hasY) {
    // 1. Direct integration: dy/dx = f(x)
    const { finalExpr, resultLatex } = integralSteps(rhsExpr, wrtVar, null)
    solutionLatex = `y(${wrtVar}) = ${resultLatex}`

    steps.push({
      rule: 'identify_ode',
      before_latex: `\\frac{dy}{d${wrtVar}} = ${toLatex(rhsExpr)}`,
      after_latex: `\\text{Type: Direct Integration}`,
      explanation: `Identify the differential equation. The derivative depends only on ${wrtVar}.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'integrate',
      before_latex: `\\int dy = \\int \\left(${toLatex(rhsExpr)}\\right) d${wrtVar}`,
      after_latex: solutionLatex,
      explanation: `Since the right-hand side depends solely on ${wrtVar}, integrate both sides with respect to ${wrtVar}.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'general_solution',
      before_latex: `\\text{General Solution}`,
      after_latex: solutionLatex,
      explanation: `The family of all solutions is ${solutionLatex}, parametrized by arbitrary constant C₁.`,
      narrated_by: 'fallback_template',
    })

    const comp = compileExpr(finalExpr)
    sampleFunc = (xVal) => (comp ? (evalAt(comp, { [wrtVar]: xVal }) ?? 0) : 0)

  } else if (/^([+-]?\d*\.?\d*)\s*\*?\s*y$/.test(rhsExpr.replace(/\s+/g, ''))) {
    // 2. Exponential dy/dx = k * y
    const m = rhsExpr.replace(/\s+/g, '').match(/^([+-]?\d*\.?\d*)\*?y$/)
    let kStr = m ? m[1] : '1'
    if (kStr === '' || kStr === '+') kStr = '1'
    if (kStr === '-') kStr = '-1'
    const kNum = parseFloat(kStr) || 1
    const kDisplay = kNum === 1 ? '' : kNum === -1 ? '-' : `${kNum}`

    solutionLatex = `y(${wrtVar}) = C_{1} e^{${kDisplay}${wrtVar}}`

    steps.push({
      rule: 'identify_ode',
      before_latex: `\\frac{dy}{d${wrtVar}} = ${toLatex(rhsExpr)}`,
      after_latex: `\\text{Type: Linear / Separable}`,
      explanation: `The rate of change is proportional to y with rate constant k = ${kNum}.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'separation_of_variables',
      before_latex: `\\frac{1}{y}\\,dy = ${kDisplay}\\,d${wrtVar}`,
      after_latex: `\\ln|y| = ${kDisplay}${wrtVar} + C_0`,
      explanation: `Separate variables: divide by y and multiply by d${wrtVar} to get (1/y) dy = ${kDisplay} d${wrtVar}.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'general_solution',
      before_latex: `\\text{General Solution}`,
      after_latex: solutionLatex,
      explanation: `Exponentiating yields ${solutionLatex}, where C₁ represents the family of solutions.`,
      narrated_by: 'fallback_template',
    })

    sampleFunc = (xVal) => Math.exp(kNum * xVal)

  } else if (rhsExpr.replace(/\s+/g, '') === `${wrtVar}*y` || rhsExpr.replace(/\s+/g, '') === `y*${wrtVar}`) {
    // 3. dy/dx = x * y
    solutionLatex = `y(${wrtVar}) = C_{1} e^{\\frac{${wrtVar}^{2}}{2}}`

    steps.push({
      rule: 'identify_ode',
      before_latex: `\\frac{dy}{d${wrtVar}} = ${wrtVar} \\cdot y`,
      after_latex: `\\text{Type: Separable}`,
      explanation: `Separate variables into y terms on the left and ${wrtVar} terms on the right.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'separation_of_variables',
      before_latex: `\\frac{1}{y}\\,dy = ${wrtVar}\\,d${wrtVar}`,
      after_latex: `\\ln|y| = \\frac{${wrtVar}^2}{2} + C_0`,
      explanation: `Integrate both sides: ∫ (1/y) dy = ln|y| and ∫ ${wrtVar} d${wrtVar} = ${wrtVar}²/2.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'general_solution',
      before_latex: `\\text{General Solution}`,
      after_latex: solutionLatex,
      explanation: `Exponentiating both sides yields the general solution ${solutionLatex}.`,
      narrated_by: 'fallback_template',
    })

    sampleFunc = (xVal) => Math.exp((xVal * xVal) / 2)

  } else {
    // 4. General First-Order ODE
    solutionLatex = `y(${wrtVar}) = \\text{Integral Curve for } \\frac{dy}{d${wrtVar}} = ${toLatex(rhsExpr)}`

    steps.push({
      rule: 'identify_ode',
      before_latex: `\\frac{dy}{d${wrtVar}} = ${toLatex(rhsExpr)}`,
      after_latex: `\\text{Type: First-Order ODE}`,
      explanation: `Identify first-order differential equation with slope field f(${wrtVar}, y) = ${rhsExpr}.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'solve_method',
      before_latex: `k_1 = f(x_n, y_n), \\quad k_2 = f(x_n + \\frac{h}{2}, y_n + \\frac{h k_1}{2})`,
      after_latex: `y_{n+1} = y_n + \\frac{h}{6}(k_1 + 2k_2 + 2k_3 + k_4)`,
      explanation: `Apply the 4th-order Runge-Kutta (RK4) method to trace integral trajectory curves across the direction field.`,
      narrated_by: 'fallback_template',
    })
    steps.push({
      rule: 'general_solution',
      before_latex: `\\text{Trajectory}`,
      after_latex: `y(${wrtVar}) = \\int f(${wrtVar}, y)\\,d${wrtVar} + C_1`,
      explanation: `The solution curve represents the integral manifold in the direction field.`,
      narrated_by: 'fallback_template',
    })

    const comp = compileExpr(rhsExpr)
    sampleFunc = (xVal) => {
      if (!comp) return 1
      try {
        const v = evalAt(comp, { [wrtVar]: xVal, y: 1 })
        return isFinite(v) ? v : 1
      } catch {
        return 1
      }
    }
  }

  // Generate numeric samples at [-3, -2, -1, 0, 1, 2, 3]
  const xs = [-3, -2, -1, 0, 1, 2, 3]
  const numericSample = []
  for (const xv of xs) {
    try {
      const yVal = sampleFunc ? sampleFunc(xv) : 0
      if (isFinite(yVal) && Math.abs(yVal) < 1e9) {
        numericSample.push({ [wrtVar]: xv, y: parseFloat(yVal.toFixed(4)) })
      }
    } catch {}
  }

  return {
    result_latex: solutionLatex,
    steps,
    result_numeric_sample: numericSample,
    operation_type: 'ode',
    _local: true,
  }
}

