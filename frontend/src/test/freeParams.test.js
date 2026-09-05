import { describe, it, expect } from 'vitest'
import { detectFreeParams } from '../lib/freeParams'

describe('detectFreeParams', () => {
  it('detects free single-letter parameter symbols', () => {
    expect(detectFreeParams('a * x^2 + b * x + c', 'x')).toEqual(['a', 'b', 'c'])
  })

  it('excludes the wrt variable', () => {
    expect(detectFreeParams('k * x', 'x')).toEqual(['k'])
    expect(detectFreeParams('k * t', 't')).toEqual(['k'])
  })

  it('excludes function names followed by opening parenthesis', () => {
    expect(detectFreeParams('sin(x) + cos(y)', 'x')).toEqual([])
  })

  it('excludes reserved identifiers like e, pi, inf', () => {
    expect(detectFreeParams('pi * r^2', 'x')).toEqual([])
    expect(detectFreeParams('E^x + I', 'x')).toEqual([])
  })

  it('handles empty or null inputs', () => {
    expect(detectFreeParams('', 'x')).toEqual([])
    expect(detectFreeParams(null, 'x')).toEqual([])
  })
})
