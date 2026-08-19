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
