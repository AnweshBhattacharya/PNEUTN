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
    // Bullet \u2022 and bullet operator \u2219
    expect(normaliseMathExpression('x \u2022 y + z \u2219 w')).toBe('x * y + z * w')
  })

  it('normalizes braces, spaced functions with subscripts/powers, and spaced decimals', () => {
    expect(normaliseMathExpression('l o g _ e(x)')).toBe('log_e(x)')
    expect(normaliseMathExpression('s i n ^ 3(x)')).toBe('sin^3(x)')
    expect(normaliseMathExpression('s e c ^ 2 2x')).toBe('sec^2 2x')
    expect(normaliseMathExpression('(x+1)^{2}')).toBe('(x+1)^(2)')
    expect(normaliseMathExpression('log_{e}(x)')).toBe('log_e(x)')
    expect(normaliseMathExpression('(x^3+5x)^0 . 2 5')).toBe('(x^3+5x)^0.25')
  })

  it('normalizes user complex expression', () => {
    const input = 'log _e((sin ^3(e^(x^2+2xy)) + (x^3+5x)^0.25)/(sec ^2 2x · (xy)^e))'
    const norm = normaliseMathExpression(input)
    expect(norm).toContain('log_e(')
    expect(norm).toContain('sin^3(')
    expect(norm).toContain('sec^2 2x * (xy)^e')
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
