import { describe, expect, it } from 'vitest'
import { normaliseMathExpression } from '../lib/mathInput'

describe('normaliseMathExpression', () => {
  it('rejoins MathLive-spaced function names', () => {
    expect(normaliseMathExpression('s i n(x)')).toBe('sin(x)')
    expect(normaliseMathExpression('s q r t(x ^ 2 + 1)')).toBe('sqrt(x ^ 2 + 1)')
    expect(normaliseMathExpression('a s i n(x) + c o s h(x)')).toBe('asin(x) + cosh(x)')
  })

  it('preserves implicit multiplication and trims whitespace', () => {
    expect(normaliseMathExpression('  2 x + y  ')).toBe('2 x + y')
  })
})
