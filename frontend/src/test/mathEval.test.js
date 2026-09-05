import { describe, it, expect } from 'vitest'
import { compileExpr, evalAt, sample1D, sample2DGrid } from '../lib/mathEval'

describe('mathEval', () => {
  describe('compileExpr & evalAt', () => {
    it('compiles and evaluates basic polynomial', () => {
      const compiled = compileExpr('x^2 + 2*x + 1')
      expect(compiled).not.toBeNull()
      expect(evalAt(compiled, { x: 3 })).toBe(16)
      expect(evalAt(compiled, { x: 0 })).toBe(1)
    })

    it('evaluates trig and exponential functions', () => {
      const compiled = compileExpr('sin(x) + exp(x)')
      expect(compiled).not.toBeNull()
      const val = evalAt(compiled, { x: 0 })
      expect(val).toBeCloseTo(1, 5) // sin(0)=0, exp(0)=1
    })

    it('returns null for invalid expressions or evaluation errors', () => {
      const invalid = compileExpr('+++ invalid expression %%%')
      expect(invalid).toBeNull()
      expect(evalAt(null, { x: 1 })).toBeNull()
    })

    it('returns null for non-finite values', () => {
      const divZero = compileExpr('1 / x')
      expect(evalAt(divZero, { x: 0 })).toBeNull()
    })

    it('rejects expression-language mutation and parsing functions', () => {
      expect(compileExpr('import("foo")')).toBeNull()
      expect(compileExpr('createUnit("x")')).toBeNull()
      expect(compileExpr('evaluate("2 + 2")')).toBeNull()
      expect(compileExpr('a = 2')).toBeNull()
    })

    it('keeps supported spaced function input and graph parameters working', () => {
      const trig = compileExpr('s i n(x)')
      expect(evalAt(trig, { x: Math.PI / 2 })).toBeCloseTo(1, 5)

      const parameterized = compileExpr('a * x')
      expect(evalAt(parameterized, { x: 3, a: 2 })).toBe(6)

      // MathLive U+2217 asterisk serialization
      const unicodeCompiled = compileExpr('a\u2217x^2 + b\u2217x + c')
      expect(unicodeCompiled).not.toBeNull()
      expect(evalAt(unicodeCompiled, { x: 2, a: 3, b: 4, c: 5 })).toBe(25)
    })
  })

  describe('sample1D', () => {
    it('samples polynomial at requested point count', () => {
      const pts = sample1D('x^2', -2, 2, 5)
      expect(pts.length).toBe(5)
      expect(pts[0].x).toBeCloseTo(-2)
      expect(pts[0].y).toBeCloseTo(4)
      expect(pts[2].x).toBeCloseTo(0)
      expect(pts[2].y).toBeCloseTo(0)
      expect(pts[4].x).toBeCloseTo(2)
      expect(pts[4].y).toBeCloseTo(4)
    })

    it('handles nPoints = 1 and edge cases gracefully', () => {
      const onePt = sample1D('x^2', 3, 3, 1)
      expect(onePt.length).toBe(1)
      expect(onePt[0].x).toBe(3)
      expect(onePt[0].y).toBe(9)

      const zeroPt = sample1D('x^2', 0, 1, 0)
      expect(zeroPt).toEqual([])
    })

    it('handles invalid expression string gracefully', () => {
      const pts = sample1D('invalid syntax', -2, 2, 10)
      expect(pts).toEqual([])
    })

    it('supports extra variable bindings', () => {
      const pts = sample1D('a * x^2', 1, 1, 1, { a: 5 })
      expect(pts[0].y).toBe(5)
    })
  })

  describe('sample2DGrid', () => {
    it('samples 2D grid correctly into Float32Array', () => {
      const segments = 10
      const grid = sample2DGrid('x + y', -1, 1, -1, 1, segments)
      expect(grid).toBeInstanceOf(Float32Array)
      expect(grid.length).toBe((segments + 1) * (segments + 1))
      // Bottom-left: x=-1, y=-1 -> z=-2
      expect(grid[0]).toBeCloseTo(-2)
      // Top-right: x=1, y=1 -> z=2
      expect(grid[grid.length - 1]).toBeCloseTo(2)
    })

    it('clamps values within [-10, 10] range', () => {
      const grid = sample2DGrid('100 * x', 1, 1, 0, 0, 1)
      expect(grid[0]).toBe(10)
    })

    it('returns empty/zero array on invalid expression', () => {
      const grid = sample2DGrid('bad @ expression', -1, 1, -1, 1, 2)
      expect(grid.length).toBe(9)
      expect(Array.from(grid)).toEqual(new Array(9).fill(0))
    })
  })
})
