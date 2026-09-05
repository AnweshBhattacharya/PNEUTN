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
  let expression = value

  // MathLive can serialize manually typed function names as `s i n(x)`.
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
