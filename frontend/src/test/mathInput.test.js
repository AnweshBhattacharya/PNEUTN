import { describe, expect, it } from 'vitest'
import { normaliseMathExpression, extractVariables } from '../lib/mathInput'

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

describe('extractVariables', () => {
  it('extracts unique single letter variables from math expressions', () => {
    expect(extractVariables('x^2')).toEqual(['x'])
    expect(extractVariables('x^2 * y^3')).toEqual(['x', 'y'])
    expect(extractVariables('sin(x) + cos(y) * exp(t)')).toEqual(['x', 'y', 't'])
    expect(extractVariables('5')).toEqual(['x'])
  })

  it('ignores function names and mathematical constants', () => {
    expect(extractVariables('sin(pi * x) + exp(E)')).toEqual(['x'])
    expect(extractVariables('log(x) + sqrt(y)')).toEqual(['x', 'y'])
  })
})
