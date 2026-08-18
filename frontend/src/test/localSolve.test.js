import { describe, it, expect } from 'vitest'
import { localSolve } from '../lib/localSolve'

describe('localSolve', () => {
  describe('derivative', () => {
    it('computes 1st order derivative of x^2', () => {
      const res = localSolve({ expr: 'x^2', operation: 'derivative', wrt: 'x', order: 1 })
      expect(res._local).toBe(true)
      expect(res.steps.length).toBe(1)
      expect(res.steps[0].rule).toBe('power_rule')
      expect(res.result_latex).toContain('2')
    })

    it('computes higher order derivative (order 2)', () => {
      const res = localSolve({ expr: 'x^3', operation: 'derivative', wrt: 'x', order: 2 })
      expect(res.steps.length).toBe(2)
      expect(res.result_latex).toContain('6')
    })

    it('computes derivative of trigonometric functions', () => {
      const res = localSolve({ expr: 'sin(x)', operation: 'derivative', wrt: 'x', order: 1 })
      expect(res.result_latex).toContain('cos')
    })

    it('computes derivative of constant to 0', () => {
      const res = localSolve({ expr: '42', operation: 'derivative', wrt: 'x', order: 1 })
      expect(res.steps[0].rule).toBe('constant')
    })
  })

  describe('integral', () => {
    it('computes indefinite integral of power rule', () => {
      const res = localSolve({ expr: 'x^2', operation: 'integral', wrt: 'x', bounds: null })
      expect(res._local).toBe(true)
      expect(res.result_latex).toContain('C')
      expect(res.steps.length).toBeGreaterThanOrEqual(1)
    })

    it('computes definite integral with numerical evaluation', () => {
      const res = localSolve({ expr: 'x^2', operation: 'integral', wrt: 'x', bounds: [0, 3] })
      expect(res._local).toBe(true)
      // integral of x^2 from 0 to 3 is 3^3/3 - 0 = 9
      expect(res.result_latex).toBe('9')
      expect(res.steps.some(s => s.rule === 'evaluate_bounds')).toBe(true)
    })

    it('handles trigonometric integrals', () => {
      const res = localSolve({ expr: 'sin(x)', operation: 'integral', wrt: 'x' })
      expect(res.result_latex).toContain('cos')
    })

    it('handles exponential integrals', () => {
      const res = localSolve({ expr: 'exp(x)', operation: 'integral', wrt: 'x' })
      expect(res.result_latex).toContain('exp')
    })
  })

  describe('error handling', () => {
    it('catches invalid syntax and returns safe error structure', () => {
      const res = localSolve({ expr: '((((x+', operation: 'derivative', wrt: 'x' })
      expect(res._local).toBe(true)
      expect(res.steps.length).toBeGreaterThan(0)
    })
  })
})
