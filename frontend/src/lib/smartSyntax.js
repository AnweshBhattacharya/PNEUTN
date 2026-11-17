/**
 * smartSyntax.js — deterministic client-side autocomplete engine.
 *
 * No LLM, no network calls, no per-token billing.
 * Uses a simple regex-driven rule table + bracket balance check.
 *
 * See ARCHITECTURE.md §1 ("Smart Syntax Engine") and FRONTEND_SPEC.md.
 *
 * Usage:
 *   import { getSuggestions, checkBalance } from './smartSyntax'
 *   const suggestions = getSuggestions('sin')
 *   // => [{ trigger: 'sin', completion: 'sin()', description: 'Sine function' }]
 */

/** Completion rules: each rule has a trigger (what the user typed) and a completion. */
const COMPLETION_RULES = [
  // Trig
  { trigger: 'sin',  completion: 'sin()',  description: 'Sine function',         insertOffset: -1 },
  { trigger: 'cos',  completion: 'cos()',  description: 'Cosine function',        insertOffset: -1 },
  { trigger: 'tan',  completion: 'tan()',  description: 'Tangent function',       insertOffset: -1 },
  { trigger: 'asin', completion: 'asin()', description: 'Inverse sine (arcsin)',  insertOffset: -1 },
  { trigger: 'acos', completion: 'acos()', description: 'Inverse cosine (arccos)',insertOffset: -1 },
  { trigger: 'atan', completion: 'atan()', description: 'Inverse tangent (arctan)',insertOffset: -1 },
  { trigger: 'sinh', completion: 'sinh()', description: 'Hyperbolic sine',        insertOffset: -1 },
  { trigger: 'cosh', completion: 'cosh()', description: 'Hyperbolic cosine',      insertOffset: -1 },
  { trigger: 'tanh', completion: 'tanh()', description: 'Hyperbolic tangent',     insertOffset: -1 },

  // Exp / log / sqrt
  { trigger: 'exp',  completion: 'exp()',  description: 'Exponential e^x',        insertOffset: -1 },
  { trigger: 'log',  completion: 'log()',  description: 'Natural logarithm',       insertOffset: -1 },
  { trigger: 'sqrt', completion: 'sqrt()', description: 'Square root',             insertOffset: -1 },

  // Integral / derivative shorthand (UI-only hints, not sent to backend)
  { trigger: 'int',  completion: 'integrate()', description: 'Integrate expression', insertOffset: -1 },
  { trigger: 'diff', completion: 'diff()',      description: 'Differentiate expression', insertOffset: -1 },
  { trigger: 'der',  completion: 'diff()',      description: 'Differentiate expression', insertOffset: -1 },

  // Constants
  { trigger: 'pi',   completion: 'pi',   description: 'π ≈ 3.14159',  insertOffset: 0 },
  { trigger: 'inf',  completion: 'oo',   description: 'Infinity (∞)', insertOffset: 0 },
  { trigger: 'e',    completion: 'exp(1)',description: "Euler's number e ≈ 2.718", insertOffset: 0 },
]

/**
 * Get autocomplete suggestions for the current input fragment.
 *
 * @param {string} fragment  — the last token the user is typing, e.g. "sin"
 * @param {number} maxResults — max suggestions to return
 * @returns {Array<{ trigger, completion, description, insertOffset }>}
 */
export function getSuggestions(fragment, maxResults = 4) {
  if (!fragment || fragment.length < 2) return []

  const lower = fragment.toLowerCase()
  return COMPLETION_RULES
    .filter(rule => rule.trigger.startsWith(lower) && rule.trigger !== lower)
    .slice(0, maxResults)
}

/**
 * Extract the last "word" (potential function name) being typed.
 * Used to feed getSuggestions from a full expression string.
 *
 * @param {string} expr  — full expression string, e.g. "x^2 + si"
 * @returns {string}     — last identifier fragment, e.g. "si"
 */
export function lastToken(expr) {
  const match = expr.match(/([a-zA-Z]+)$/)
  return match ? match[1] : ''
}

/**
 * Check bracket balance in an expression string.
 *
 * @param {string} expr
 * @returns {{ balanced: boolean, depth: number, message: string|null }}
 */
export function checkBalance(expr) {
  let depth = 0
  let firstUnmatched = -1

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') {
      depth++
    } else if (expr[i] === ')') {
      depth--
      if (depth < 0) {
        firstUnmatched = i
        break
      }
    }
  }

  if (depth < 0 || firstUnmatched >= 0) {
    return { balanced: false, depth, message: 'Unmatched closing parenthesis.' }
  }
  if (depth > 0) {
    return { balanced: false, depth, message: `${depth} unclosed parenthes${depth === 1 ? 'is' : 'es'}.` }
  }
  return { balanced: true, depth: 0, message: null }
}

/**
 * Auto-correct common syntax mistakes and normalise input:
 * - Unclosed parentheses (auto-balanced at the end)
 * - Implicit multiplication: 2x -> 2*x, x(x+1) -> x*(x+1), (x+1)(x+2) -> (x+1)*(x+2)
 * - Assignment prefixes: y =, f(x) =, dy/dx =, and trailing = 0
 * - Functions without parens: sin x -> sin(x), cos x -> cos(x), ln x -> log(x)
 * - Redundant consecutive operators: ++, +-, --, //
 * - Unicode symbols: ·, ×, −, superscripts ², ³, π, √
 * - LaTeX artifacts: \frac{a}{b} -> ((a)/(b)), \cdot -> *
 *
 * @param {string} expr
 * @returns {string}
 */
export function autoCorrectExpr(expr) {
  if (!expr || typeof expr !== 'string') return ''
  let s = expr.trim()

  // 1. Strip equation assignment prefix: e.g. y =, f(x) =, z =, dy/dx =
  s = s.replace(/^(?:[a-zA-Z](?:\([a-zA-Z\s,]+\))?|d[a-zA-Z]\/d[a-zA-Z])\s*=\s*/, '')
  // Strip trailing = 0
  s = s.replace(/\s*=\s*0\s*$/, '')

  // 2. Normalize unicode operators & superscripts
  s = s.replace(/[\u00b7\u22c5\u2022\u2219\u2218\u2299\u00d7\u2217\u2062]/g, '*')
  s = s.replace(/[\u2212\u2013\u2014\u2015]/g, '-')
  s = s.replace(/[\u00f7]/g, '/')
  const superscripts = {
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
    '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
  }
  for (const [sup, rep] of Object.entries(superscripts)) {
    s = s.replaceAll(sup, rep)
  }
  s = s.replace(/π/g, 'pi').replace(/φ/g, 'phi').replace(/θ/g, 'theta').replace(/√/g, 'sqrt').replace(/∞/g, 'oo')
  s = s.replace(/^[∬∭∫]+\s*/, '')

  // LaTeX fractions \frac{a}{b} -> ((a)/(b))
  while (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
  }
  s = s.replace(/\\(?:cdot|times)\b/g, '*')
  s = s.replace(/\\(?:left|right)\b/g, '')
  s = s.replace(/\{/g, '(').replace(/\}/g, ')')
  s = s.replace(/\[/g, '(').replace(/\]/g, ')')

  // 3. Known functions set
  const funcList = [
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'asin', 'acos', 'atan',
    'exp', 'log', 'ln', 'sqrt', 'abs', 'sign',
  ]
  const funcPattern = funcList.join('|')

  // Normalise ln(...) -> log(...)
  s = s.replace(/\bln\s*\(/g, 'log(')

  // Consecutive operators cleanup: e.g. ++ -> +, +- -> -, -- -> +
  s = s.replace(/\+\+/g, '+').replace(/\+\-/g, '-').replace(/\-\-/g, '+').replace(/\/\//g, '/')

  // Insert * between number and letter: 2x -> 2*x, 3sin -> 3*sin
  s = s.replace(/(\d)\s*([a-zA-Z])/g, '$1*$2')

  // Insert * between ')' and '(': (x+1)(x+2) -> (x+1)*(x+2)
  s = s.replace(/\)\s*\(/g, ')*(')

  // Insert * between ')' and variable/number: (x+1)x -> (x+1)*x, (x+1)2 -> (x+1)*2
  s = s.replace(/\)\s*([a-zA-Z0-9])/g, ')*$1')

  // Insert * between ')' and function name: (x+1)sin(x) -> (x+1)*sin(x)
  s = s.replace(new RegExp(`\\)\\s*(${funcPattern})\\b`, 'gi'), ')*$1')

  // Insert * between variable and '(' when variable is NOT a math function:
  // e.g. x(x+1) -> x*(x+1), y(1-y) -> y*(1-y)
  s = s.replace(/([a-zA-Z0-9_]+)\s*\(/g, (m, ident) => {
    if (funcList.includes(ident.toLowerCase())) return `${ident}(`
    return `${ident}*(`
  })

  // Function without parentheses followed by simple variable/number:
  // e.g. sin x -> sin(x), cos 2x -> cos(2*x), ln x -> log(x), sqrt x -> sqrt(x)
  s = s.replace(new RegExp(`\\b(${funcPattern})\\s+([0-9a-zA-Z]+)(?!\\s*\\()`, 'gi'), (m, fn, arg) => {
    const normFn = fn.toLowerCase() === 'ln' ? 'log' : fn
    return `${normFn}(${arg})`
  })

  // 4. Auto-balance parentheses
  let openCount = 0
  let closeCount = 0
  for (const ch of s) {
    if (ch === '(') openCount++
    if (ch === ')') closeCount++
  }
  if (openCount > closeCount) {
    s += ')'.repeat(openCount - closeCount)
  } else if (closeCount > openCount) {
    s = '('.repeat(closeCount - openCount) + s
  }

  return s
}

/**
 * Check if an expression has actionable auto-fix suggestions.
 * Returns { fixedExpr, reason } or null.
 *
 * @param {string} expr
 * @returns {{ fixedExpr: string, reason: string } | null}
 */
export function suggestFix(expr) {
  if (!expr || typeof expr !== 'string') return null
  const cleaned = expr.trim()
  if (!cleaned) return null
  const corrected = autoCorrectExpr(cleaned)
  if (corrected && corrected !== cleaned) {
    return {
      original: cleaned,
      fixedExpr: corrected,
      reason: 'Auto-correct syntax & missing operators',
    }
  }
  return null
}

/**
 * Validate an expression string before sending to the backend.
 * Returns a human-readable error string, or null if it looks OK.
 *
 * @param {string} expr
 * @returns {string|null}
 */
export function validateExpr(expr) {
  if (!expr || expr.trim().length === 0) {
    return 'Enter a math expression.'
  }
  if (expr.length > 500) {
    return 'Expression too long (max 500 characters).'
  }
  const balance = checkBalance(expr)
  if (!balance.balanced) {
    return balance.message
  }
  // Reject obvious injection attempts (extra safety — backend has the real check)
  if (/__|import|exec|eval|__builtins__/i.test(expr)) {
    return 'Invalid expression.'
  }
  return null
}
