/**
 * Convert MathLive ASCII-math output to the expression format accepted by
 * SymPy and math.js.
 */
const FUNCTION_NAMES = [
  'asinh', 'acosh', 'atanh',
  'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'sin', 'cos', 'tan', 'exp', 'log', 'Abs', 'sign',
]

export function normaliseMathExpression(value) {
  if (!value || typeof value !== 'string') return ''
  let expression = value

  // 1. Normalize Unicode symbols
  expression = expression.replace(/[\u2217\u00d7\u00b7\u22c5\u2062]/g, '*')
  expression = expression.replace(/[\u2212\u2013\u2014]/g, '-')
  expression = expression.replace(/\u00f7/g, '/')

  // 2. Normalize Unicode greek letters to ascii names (from MathLive ascii-math output)
  // MathLive ascii-math serializes π → "pi", φ → "phi", etc. already.
  // But sometimes it outputs raw Unicode characters.
  expression = expression.replace(/π/g, 'pi')
  expression = expression.replace(/φ/g, 'phi')
  expression = expression.replace(/θ/g, 'theta')
  expression = expression.replace(/∞/g, 'oo')
  expression = expression.replace(/√/g, 'sqrt')

  // 3. MathLive AsciiMath uses `**` for asterisk multiplication or `xx` for \times
  expression = expression.replace(/\s*\*\*\s*/g, ' * ')
  expression = expression.replace(/\bxx\b/g, '*')
  expression = expression.replace(/\\cdot|\\times/g, '*')

  // 4. MathLive can serialize manually typed function names as `s i n(x)`.
  for (const name of FUNCTION_NAMES) {
    const spacedName = name.split('').join('\\s*')
    expression = expression.replace(new RegExp(`${spacedName}\\s*(?=\\()`, 'gi'), name)
  }

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
