// Reserved identifiers — not free parameters
const RESERVED = new Set([
  'x', 'y', 'z', 't', 'e', 'E', 'i', 'I', 'pi', 'PI', 'inf', 'Infinity', 'true', 'false',
  // known math.js single-letter function aliases
  'n', 'o', 'p', 'q', 'r', 's', 'u', 'v', 'w',
])

/**
 * Extract free parameter names from a math expression string.
 * A free parameter is a single-letter identifier that is:
 *   - not the wrt variable
 *   - not in RESERVED
 *   - not immediately followed by '(' (so it's not a function call)
 *
 * @param {string} expr  — math.js expression string
 * @param {string} wrt   — differentiation / integration variable
 * @returns {string[]}   — sorted array of free parameter names
 */
export function detectFreeParams(expr, wrt) {
  if (!expr) return []
  // Match single-letter identifiers NOT immediately followed by '('
  const identifiers = new Set(
    [...expr.matchAll(/\b([a-zA-Z])\b(?!\s*\()/g)].map(m => m[1])
  )
  return [...identifiers]
    .filter(id => id !== wrt && !RESERVED.has(id))
    .sort()
}
