/**
 * ruleBreakdown.js — calculus theorem templates and color-coded token mappings.
 *
 * Provides color-coded KaTeX formulas and maps extracted substeps (u, v, du, dv,
 * outer, inner) to distinct colors for high-contrast legible step explanations.
 */

export const RULE_BREAKDOWNS = {
  product_rule: {
    title: 'Product Rule',
    formula: '\\frac{d}{dx}\\left[{\\color{#60a5fa} u} \\cdot {\\color{#f59e0b} v}\\right] = {\\color{#60a5fa} u} \\cdot {\\color{#f59e0b} v\'} + {\\color{#f59e0b} v} \\cdot {\\color{#60a5fa} u\'}',
    desc: 'The derivative of a product is the first factor times the derivative of the second, plus the second factor times the derivative of the first.',
    tokens: [
      { key: 'u',  symbol: 'u',  color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa', label: 'First factor' },
      { key: 'v',  symbol: 'v',  color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: 'Second factor' },
      { key: 'du', symbol: "u'", color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: "d/dx[u]" },
      { key: 'dv', symbol: "v'", color: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)', border: '#fb923c', label: "d/dx[v]" },
    ],
  },
  quotient_rule: {
    title: 'Quotient Rule',
    formula: '\\frac{d}{dx}\\left[\\frac{{\\color{#60a5fa} u}}{{\\color{#f43f5e} v}}\\right] = \\frac{{\\color{#f43f5e} v} \\cdot {\\color{#60a5fa} u\'} - {\\color{#60a5fa} u} \\cdot {\\color{#f43f5e} v\'}}{{\\color{#f43f5e} v}^2}',
    desc: 'Low d-high minus high d-low, all over the square of what is below.',
    tokens: [
      { key: 'u',  symbol: 'u',  color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa', label: 'Numerator' },
      { key: 'v',  symbol: 'v',  color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)', border: '#f43f5e', label: 'Denominator' },
      { key: 'du', symbol: "u'", color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: "d/dx[u]" },
      { key: 'dv', symbol: "v'", color: '#fb7185', bg: 'rgba(251, 113, 133, 0.12)', border: '#fb7185', label: "d/dx[v]" },
    ],
  },
  chain_rule: {
    title: 'Chain Rule',
    formula: '\\frac{d}{dx}\\left[{\\color{#c084fc} f}({\\color{#4ade80} g(x)})\\right] = {\\color{#c084fc} f\'}({\\color{#4ade80} g(x)}) \\cdot {\\color{#4ade80} g\'(x)}',
    desc: 'Differentiate the outer function evaluated at the inner function, then multiply by the derivative of the inner function.',
    tokens: [
      { key: 'outer',   symbol: 'f(u)',  color: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', border: '#c084fc', label: 'Outer function' },
      { key: 'inner',   symbol: 'g(x)',  color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)', border: '#4ade80', label: 'Inner function' },
      { key: 'd_outer', symbol: "f'(u)", color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)', border: '#a855f7', label: 'Outer derivative' },
      { key: 'd_inner', symbol: "g'(x)", color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)', border: '#22c55e', label: 'Inner derivative' },
    ],
  },
  integration_by_parts: {
    title: 'Integration by Parts',
    formula: '\\int {\\color{#60a5fa} u} \\, {\\color{#4ade80} dv} = {\\color{#60a5fa} u} \\cdot {\\color{#4ade80} v} - \\int {\\color{#4ade80} v} \\, {\\color{#60a5fa} du}',
    desc: 'Transform the integral of a product into simpler terms by differentiating u and integrating dv.',
    tokens: [
      { key: 'u',  symbol: 'u',  color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa', label: 'u (differentiate)' },
      { key: 'dv', symbol: 'dv', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)', border: '#4ade80', label: 'dv (integrate)' },
      { key: 'du', symbol: 'du', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: 'du = u\' dx' },
      { key: 'v',  symbol: 'v',  color: '#86efac', bg: 'rgba(134, 239, 172, 0.12)', border: '#86efac', label: 'v = ∫ dv' },
    ],
  },
  u_substitution: {
    title: 'u-Substitution',
    formula: '\\int f({\\color{#60a5fa} g(x)}) \\cdot {\\color{#38bdf8} g\'(x) \\, dx} = \\int f({\\color{#60a5fa} u}) \\, {\\color{#38bdf8} du}',
    desc: 'Substitute an inner composite expression with u to convert the integrand into a standard integral form.',
    tokens: [
      { key: 'u',  symbol: 'u',  color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa', label: 'u = g(x)' },
      { key: 'du', symbol: 'du', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: "du = g'(x) dx" },
    ],
  },
  power_rule: {
    title: 'Power Rule',
    formula: '\\frac{d}{dx}\\left[x^{\\color{#f59e0b} n}\\right] = {\\color{#f59e0b} n} \\cdot x^{{\\color{#f59e0b} n}-1}',
    desc: 'Bring the exponent down as a multiplicative coefficient, then reduce the exponent by 1.',
    tokens: [
      { key: 'n', symbol: 'n', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: 'Power exponent' },
    ],
  },
  power_rule_integral: {
    title: 'Reverse Power Rule',
    formula: '\\int x^{\\color{#f59e0b} n} \\, dx = \\frac{x^{{\\color{#f59e0b} n}+1}}{{\\color{#f59e0b} n}+1} + C \\quad (n \\neq -1)',
    desc: 'Increase the exponent by 1, divide by the new exponent, and add the constant of integration C.',
    tokens: [
      { key: 'n', symbol: 'n', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', label: 'Power exponent' },
    ],
  },
  constant_factor: {
    title: 'Constant Multiple Rule',
    formula: '\\frac{d}{dx}\\left[{\\color{#34d399} c} \\cdot {\\color{#60a5fa} f(x)}\\right] = {\\color{#34d399} c} \\cdot \\frac{d}{dx}\\left[{\\color{#60a5fa} f(x)}\\right]',
    desc: 'Factor the constant coefficient out of the calculus operation.',
    tokens: [
      { key: 'c', symbol: 'c',    color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: '#34d399', label: 'Constant coefficient' },
      { key: 'f', symbol: 'f(x)', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa', label: 'Variable term' },
    ],
  },
  sum_rule: {
    title: 'Sum / Linearity Rule',
    formula: '\\frac{d}{dx}\\left[{\\color{#38bdf8} u} + {\\color{#a855f7} v}\\right] = \\frac{d}{dx}[{\\color{#38bdf8} u}] + \\frac{d}{dx}[{\\color{#a855f7} v}]',
    desc: 'Differentiate each additive term independently and sum their derivatives.',
    tokens: [
      { key: 'u', symbol: 'u', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: 'Term 1' },
      { key: 'v', symbol: 'v', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)', border: '#a855f7', label: 'Term 2' },
    ],
  },
  sum_rule_integral: {
    title: 'Linearity of Integration',
    formula: '\\int \\left[{\\color{#38bdf8} f(x)} + {\\color{#a855f7} g(x)}\\right] dx = \\int {\\color{#38bdf8} f(x)} \\, dx + \\int {\\color{#a855f7} g(x)} \\, dx',
    desc: 'Split the integral across addition and integrate each term individually.',
    tokens: [
      { key: 'u', symbol: 'f(x)', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.12)', border: '#38bdf8', label: 'Integral 1' },
      { key: 'v', symbol: 'g(x)', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.12)', border: '#a855f7', label: 'Integral 2' },
    ],
  },
}

/**
 * Match existing substep items from API/localSolve to color-coded token chips.
 */
export function getStepTokens(step) {
  if (!step) return []
  const breakdown = RULE_BREAKDOWNS[step.rule]
  const substeps = step.substeps || []

  if (breakdown?.tokens && substeps.length > 0) {
    // Map substeps to tokens based on label keywords
    return substeps.map((sub, idx) => {
      const lbl = (sub.label || '').toLowerCase()
      let token = breakdown.tokens[idx % breakdown.tokens.length]
      if (lbl.includes('outer')) {
        token = breakdown.tokens.find(t => t.key.includes('outer')) || token
      } else if (lbl.includes('inner')) {
        token = breakdown.tokens.find(t => t.key.includes('inner')) || token
      } else if (lbl.includes('[u]') || lbl === 'u') {
        token = breakdown.tokens.find(t => t.key === 'u' || t.key === 'du') || token
      } else if (lbl.includes('[v]') || lbl === 'v') {
        token = breakdown.tokens.find(t => t.key === 'v' || t.key === 'dv') || token
      }
      return {
        ...sub,
        color: token.color,
        bg: token.bg,
        border: token.border,
        tag: token.symbol,
      }
    })
  }

  // Fallback for substeps without rule breakdown template
  const fallbackColors = [
    { color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.12)', border: '#60a5fa' },
    { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b' },
    { color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)', border: '#4ade80' },
    { color: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', border: '#c084fc' },
  ]
  return substeps.map((sub, idx) => {
    const c = fallbackColors[idx % fallbackColors.length]
    return {
      ...sub,
      color: c.color,
      bg: c.bg,
      border: c.border,
      tag: String.fromCharCode(65 + idx), // A, B, C...
    }
  })
}
