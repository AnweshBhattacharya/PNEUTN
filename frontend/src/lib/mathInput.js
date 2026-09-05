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
  // Multiplication: U+2217 (∗), U+00D7 (×), U+00B7 (·), U+22C5 (⋅), U+2062 (invisible times)
  expression = expression.replace(/[\u2217\u00d7\u00b7\u22c5\u2062]/g, '*')
  // Minus: U+2212 (−), U+2013 (–), U+2014 (—)
  expression = expression.replace(/[\u2212\u2013\u2014]/g, '-')
  // Division: U+00F7 (÷)
  expression = expression.replace(/\u00f7/g, '/')

  // 2. MathLive AsciiMath uses `**` for asterisk multiplication or `xx` for \times
  expression = expression.replace(/\s*\*\*\s*/g, ' * ')
  expression = expression.replace(/\bxx\b/g, '*')
  expression = expression.replace(/\\cdot|\\times/g, '*')

  // 3. MathLive can serialize manually typed function names as `s i n(x)`.
  // Rejoin only supported function names immediately before an opening
  // parenthesis, leaving legitimate implicit multiplication untouched.
  for (const name of FUNCTION_NAMES) {
    const spacedName = name.split('').join('\\s*')
    expression = expression.replace(new RegExp(`${spacedName}\\s*(?=\\()`, 'gi'), name)
  }

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
