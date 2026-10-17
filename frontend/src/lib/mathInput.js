/**
 * Convert MathLive ASCII-math output to the expression format accepted by
 * SymPy and math.js.
 */
const FUNCTION_NAMES = [
  'asinh', 'acosh', 'atanh',
  'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'exp', 'log', 'ln', 'Abs', 'sign',
]

export function normaliseMathExpression(value) {
  if (!value || typeof value !== 'string') return ''
  let expression = value

  // 1. Normalize Unicode symbols
  expression = expression.replace(/[\u2217\u00d7\u00b7\u22c5\u2022\u2219\u2218\u2299\u2062]/g, '*')
  expression = expression.replace(/[\u2212\u2013\u2014\u2015]/g, '-')
  expression = expression.replace(/\u00f7/g, '/')

  // 1b. Normalize Unicode superscripts -> ^N
  const superscripts = {
    '⁰': '^0', '¹': '^1', '²': '^2', '³': '^3', '⁴': '^4',
    '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9',
  }
  for (const [sup, rep] of Object.entries(superscripts)) {
    expression = expression.replaceAll(sup, rep)
  }

  // 2. Normalize Unicode greek letters to ascii names (from MathLive ascii-math output)
  expression = expression.replace(/π/g, 'pi')
  expression = expression.replace(/φ/g, 'phi')
  expression = expression.replace(/θ/g, 'theta')
  expression = expression.replace(/∞/g, 'oo')
  expression = expression.replace(/√/g, 'sqrt')

  // 3. MathLive AsciiMath uses `**` for asterisk multiplication or `xx` for \times
  expression = expression.replace(/\s*\*\*\s*/g, ' * ')
  expression = expression.replace(/\bxx\b/g, '*')
  expression = expression.replace(/\\cdot|\\times|\bcdot\b|\bc\s*d\s*o\s*t\b/gi, '*')
  expression = expression.replace(/\\(?:left|right)\b/g, '')
  expression = expression.replace(/\b(?:left|right)\b/gi, '')
  expression = expression.replace(/l\s*e\s*f\s*t\s*\(/gi, '(')
  expression = expression.replace(/r\s*i\s*g\s*h\s*t\s*\)/gi, ')')

  // 3b. Convert braces and brackets to parentheses
  expression = expression.replace(/[{[]/g, '(')
  expression = expression.replace(/[}\]]/g, ')')

  // 3c. Collapse spaced decimals (e.g. 0 . 2 5 -> 0.25)
  expression = expression.replace(/\b(\d+)\s*\.\s*([\d\s]+)\b/g, match => match.replace(/\s+/g, ''))

  // 4. MathLive can serialize manually typed function names spaced out, e.g. `l o g _ e`, `s i n ^ 3`.
  for (const name of FUNCTION_NAMES) {
    const spacedName = name.split('').join('\\s*')
    expression = expression.replace(new RegExp(`\\b${spacedName}(?=[(_^\\s\\d]|[a-zA-Z]|$)`, 'gi'), name)
  }

  // 4b. Collapse spaces around _ and ^ following function names (e.g. "log _e" -> "log_e", "sin ^3" -> "sin^3")
  const funcs = FUNCTION_NAMES.join('|')
  expression = expression.replace(new RegExp(`\\b(${funcs})\\s*([_^])\\s*([a-zA-Z0-9]+)`, 'gi'), '$1$2$3')
  expression = expression.replace(new RegExp(`\\b(${funcs})\\s*\\(`, 'gi'), '$1(')

  // 4c. Clean up log_(base) -> log_base and fn^(pwr) -> fn^pwr
  expression = expression.replace(/\blog_\(([a-zA-Z0-9]+)\)/g, 'log_$1')
  expression = expression.replace(/\b([a-zA-Z]+)\^\(([0-9]+)\)/g, '$1^$2')

  // 5. Clean up empty fractions `(())/(())` to a more readable placeholder like `?/?`
  expression = expression.replace(/\(\(\)\)\/\(\(\)\)/g, '?/?')
  // Also clean up partially empty fractions `(a)/(())` or `(())/(b)`
  expression = expression.replace(/\(\(\)\)/g, '?')

  return expression.trim()
}

export function extractVariables(exprStr) {
  if (!exprStr || typeof exprStr !== 'string') return ['x']
  const reserved = new Set([
    'e', 'pi', 'i',
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'asinh', 'acosh', 'atanh',
    'exp', 'log', 'ln', 'sqrt', 'abs', 'sign', 'd', 'dx', 'dy', 'dz', 'dt'
  ])
  const matches = exprStr.match(/[a-zA-Z]+/g) || []
  const vars = []
  for (const m of matches) {
    const lower = m.toLowerCase()
    if (m.length === 1 && !reserved.has(lower) && !vars.includes(lower)) {
      vars.push(lower)
    }
  }
  return vars.length > 0 ? vars : ['x']
}
