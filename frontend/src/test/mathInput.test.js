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

  it('normalizes Unicode math operators and AsciiMath multiplication', () => {
    // Unicode asterisk U+2217 (∗)
    expect(normaliseMathExpression('a\u2217x^2 + b\u2217x + c')).toBe('a*x^2 + b*x + c')
    // Unicode multiplication sign U+00D7 (×) and middle dot U+00B7 (·)
    expect(normaliseMathExpression('2 \u00d7 x + 3 \u00b7 y')).toBe('2 * x + 3 * y')
    // Unicode minus U+2212 (−) and division U+00F7 (÷)
    expect(normaliseMathExpression('x \u2212 5 \u00f7 2')).toBe('x - 5 / 2')
    // AsciiMath ** multiplication
    expect(normaliseMathExpression('a ** x^2 + b ** x + c')).toBe('a * x^2 + b * x + c')
    // LaTeX \cdot and \times
    expect(normaliseMathExpression('a \\cdot x + b \\times y')).toBe('a * x + b * y')
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
