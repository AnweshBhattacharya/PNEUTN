import { describe, it, expect } from 'vitest'
import { getSuggestions, lastToken, checkBalance, validateExpr, autoCorrectExpr, suggestFix } from '../lib/smartSyntax'

describe('smartSyntax', () => {
  describe('getSuggestions', () => {
    it('returns empty array for short or empty input', () => {
      expect(getSuggestions('')).toEqual([])
      expect(getSuggestions('s')).toEqual([])
    })

    it('suggests trigonometric functions on prefix', () => {
      const res = getSuggestions('si')
      expect(res.some(r => r.trigger === 'sin')).toBe(true)
      expect(res.find(r => r.trigger === 'sin').completion).toBe('sin()')
    })

    it('suggests exp and log functions', () => {
      const expRes = getSuggestions('ex')
      expect(expRes.some(r => r.trigger === 'exp')).toBe(true)
      const sqrtRes = getSuggestions('sq')
      expect(sqrtRes.some(r => r.trigger === 'sqrt')).toBe(true)
    })

    it('respects maxResults limit', () => {
      const res = getSuggestions('c', 2)
      expect(res.length).toBeLessThanOrEqual(2)
    })
  })

  describe('lastToken', () => {
    it('extracts identifier at end of expression', () => {
      expect(lastToken('x^2 + si')).toBe('si')
      expect(lastToken('exp(x) + co')).toBe('co')
      expect(lastToken('3*x + 5')).toBe('')
      expect(lastToken('')).toBe('')
    })
  })

  describe('checkBalance', () => {
    it('detects balanced parentheses', () => {
      expect(checkBalance('sin(x) + cos(x)').balanced).toBe(true)
      expect(checkBalance('(x + 1) * (x - 1)').balanced).toBe(true)
      expect(checkBalance('x^2').balanced).toBe(true)
    })

    it('detects unclosed parentheses', () => {
      const res = checkBalance('sin(x')
      expect(res.balanced).toBe(false)
      expect(res.depth).toBe(1)
      expect(res.message).toMatch(/1 unclosed parenthesis/)
    })

    it('detects multiple unclosed parentheses', () => {
      const res = checkBalance('((x + 1)')
      expect(res.balanced).toBe(false)
      expect(res.depth).toBe(1)
    })

    it('detects unmatched closing parentheses', () => {
      const res = checkBalance('x) + 1')
      expect(res.balanced).toBe(false)
      expect(res.message).toMatch(/Unmatched closing parenthesis/)
    })
  })

  describe('validateExpr', () => {
    it('rejects empty input', () => {
      expect(validateExpr('')).toMatch(/Enter a math expression/)
      expect(validateExpr('   ')).toMatch(/Enter a math expression/)
    })

    it('rejects expressions exceeding length limit', () => {
      const longExpr = 'x+'.repeat(300)
      expect(validateExpr(longExpr)).toMatch(/Expression too long/)
    })

    it('rejects unbalanced expressions', () => {
      expect(validateExpr('sin(x')).toBeTruthy()
    })

    it('rejects injection attempts', () => {
      expect(validateExpr('__import__("os")')).toMatch(/Invalid expression/)
      expect(validateExpr('eval("1+1")')).toMatch(/Invalid expression/)
      expect(validateExpr('exec("1+1")')).toMatch(/Invalid expression/)
    })

    it('accepts valid math expressions', () => {
      expect(validateExpr('x^2 + 2*x + 1')).toBeNull()
      expect(validateExpr('sin(x) * exp(-x)')).toBeNull()
      expect(validateExpr('sqrt(x^2 + 1)')).toBeNull()
    })
  })

  describe('autoCorrectExpr & suggestFix', () => {
    it('corrects variable directly before parentheses: x(x+1) -> x*(x+1)', () => {
      expect(autoCorrectExpr('x(x+1)')).toBe('x*(x+1)')
      expect(autoCorrectExpr('2x(x+1)')).toBe('2*x*(x+1)')
    })

    it('strips equation prefixes', () => {
      expect(autoCorrectExpr('y = x^2 + 1')).toBe('x^2 + 1')
      expect(autoCorrectExpr('f(x) = 3*x + 2')).toBe('3*x + 2')
      expect(autoCorrectExpr('x^2 - 4 = 0')).toBe('x^2 - 4')
    })

    it('inserts implicit multiplication between adjacent parentheses', () => {
      expect(autoCorrectExpr('(x+1)(x+2)')).toBe('(x+1)*(x+2)')
      expect(autoCorrectExpr('(x+1)sin(x)')).toBe('(x+1)*sin(x)')
    })

    it('auto-balances trailing unclosed parentheses', () => {
      expect(autoCorrectExpr('3*(x^2 + 1')).toBe('3*(x^2 + 1)')
    })

    it('converts function without parentheses: sin x -> sin(x)', () => {
      expect(autoCorrectExpr('sin x + cos x')).toBe('sin(x) + cos(x)')
    })

    it('strips leading unicode integral symbols (∬, ∭, ∫)', () => {
      expect(autoCorrectExpr('∬ x*y')).toBe('x*y')
      expect(autoCorrectExpr('∭ x*y*z')).toBe('x*y*z')
      expect(autoCorrectExpr('∫ x^2')).toBe('x^2')
    })

    it('suggests fix when expression can be corrected', () => {
      const fix = suggestFix('x(x+1)')
      expect(fix).not.toBeNull()
      expect(fix.fixedExpr).toBe('x*(x+1)')
    })

    it('returns null when expression is already clean', () => {
      expect(suggestFix('x^2 + 2*x + 1')).toBeNull()
    })
  })
})
