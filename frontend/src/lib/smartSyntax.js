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
  if (expr.length > 200) {
    return 'Expression too long (max 200 characters).'
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
