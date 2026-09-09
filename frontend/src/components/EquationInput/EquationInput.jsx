/**
 * EquationInput — restructured layout:
 *   1. Category tabs (Scalar / Vector / Differential) — always visible, no scroll
 *   2. Operation selector for the active category
 *   3. Operation-specific sub-controls (wrt, bounds, etc.)
 *   4. MathLive expression field
 *   5. Solve button (sticky at bottom)
 *
 * No EquationPreview — MathLive already renders LaTeX inline.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react'
import 'mathlive'
import { getSuggestions, lastToken, validateExpr, checkBalance } from '../../lib/smartSyntax'
import { normaliseMathExpression, extractVariables } from '../../lib/mathInput'
import styles from './EquationInput.module.css'

function getExpressionValue(mathfield) {
  // Get the ascii-math representation for the backend.
  // For well-known constants, also normalise their ascii-math output.
  try {
    const ascii = mathfield.getValue('ascii-math') || ''
    const latex = mathfield.getValue('latex') || ''
    // Prefer ascii-math but fall back to LaTeX-stripped version
    const raw = ascii || latex.replace(/\\[a-zA-Z]+/g, m => {
      const map = { '\\pi': 'pi', '\\phi': 'phi', '\\infty': 'oo', '\\sqrt': 'sqrt' }
      return map[m] ?? m.slice(1)
    })
    return normaliseMathExpression(raw)
  } catch {
    return normaliseMathExpression(mathfield.value || '')
  }
}

/**
 * Find the end index of the \\int prefix in a LaTeX string,
 * handling nested braces (e.g. \\int_{\\frac{a}{b}}^{c}).
 * Returns the index right after the prefix, or 0 if no \\int prefix found.
 */
function findIntPrefixEnd(latex) {
  if (!latex.startsWith('\\int')) return 0
  let i = 4 // skip past "\\int"

  // Helper: skip a brace-delimited group { ... } respecting nesting
  function skipBraceGroup() {
    if (i >= latex.length || latex[i] !== '{') return
    let depth = 1
    i++ // skip opening {
    while (i < latex.length && depth > 0) {
      if (latex[i] === '{') depth++
      else if (latex[i] === '}') depth--
      i++
    }
  }

  // Optional subscript: _{...}
  if (i < latex.length && latex[i] === '_') {
    i++ // skip _
    skipBraceGroup()
  }
  // Optional superscript: ^{...}
  if (i < latex.length && latex[i] === '^') {
    i++ // skip ^
    skipBraceGroup()
  }

  return i
}

// Greek / special symbols that MathLive accepts as LaTeX shortcuts
const SYMBOL_SHORTCUTS = [
  { label: 'π',  latex: '\\pi',    ascii: 'pi'  },
  { label: 'φ',  latex: '\\phi',   ascii: 'phi' },
  { label: 'θ',  latex: '\\theta', ascii: 'theta' },
  { label: '√',  latex: '\\sqrt{}',ascii: 'sqrt(' },
  { label: 'a/b', latex: '\\frac{}{}', ascii: '/' },
  { label: 'e',  latex: 'e',       ascii: 'e'   },
  { label: '∞',  latex: '\\infty', ascii: 'oo'  },
  { label: 'x²', latex: 'x^{2}',  ascii: 'x^2' },
]

// Category → operations map
const CATEGORIES = [
  { id: 'scalar',       label: 'Scalar' },
  { id: 'vector',       label: 'Vector' },
  { id: 'differential', label: 'ODE' },
]

const OPS_BY_CATEGORY = {
  scalar: [
    { value: 'derivative', label: 'd/dx' },
    { value: 'integral',   label: '∫ dx' },
  ],
  vector: [
    { value: 'gradient',   label: '∇f' },
    { value: 'divergence', label: '∇·F' },
    { value: 'curl',       label: '∇×F' },
  ],
  differential: [
    { value: 'ode', label: "dy/dx = f" },
  ],
}

const OP_TO_CATEGORY = {}
Object.entries(OPS_BY_CATEGORY).forEach(([cat, ops]) => {
  ops.forEach(op => { OP_TO_CATEGORY[op.value] = cat })
})

export default function EquationInput({ value, onChange, onSolve, loading,
  exampleOperation, exampleWrt, exampleBounds,
  onViewGraph,  // new: called when user clicks "View Graph"
  // Equation tab props (hoisted from App)
  equations = [], activeId, onSetActiveId, onAddEquation, onRemoveEquation, colors = [] }) {
  const mlRef = useRef(null)
  const [latexValue, setLatexValue]     = useState(value || '')
  const [suggestions, setSuggestions]   = useState([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [balanceError, setBalanceError] = useState(null)

  // Category + operation — derive category from operation
  const [operation, setOperation]       = useState('derivative')
  const activeCategory = OP_TO_CATEGORY[operation] ?? 'scalar'

  const [isTotalDerivative, setIsTotalDerivative] = useState(false)
  const [wrtSequence, setWrtSequence]   = useState(['x'])
  const [integrationSequence, setIntegrationSequence] = useState([
    { wrt: 'x', boundsEnabled: false, boundLo: '0', boundHi: '1' }
  ])
  const [totalWrt, setTotalWrt] = useState('t')

  const effectiveOperation = operation === 'derivative' && isTotalDerivative
    ? 'total_derivative'
    : operation

  const wrtOptions = useMemo(() => {
    const raw = value || latexValue || ''
    // Only detect variables when there's actually an expression typed
    if (!raw.trim()) return ['x']
    const detected = extractVariables(raw)
    const defaults = ['x', 'y', 'z', 't']
    const combined = [...detected]
    for (const d of defaults) {
      if (!combined.includes(d) && combined.length < 4) combined.push(d)
    }
    return combined.length > 0 ? combined : ['x']
  }, [value, latexValue])

  useEffect(() => {
    if (wrtSequence.length === 0 && wrtOptions.length > 0) setWrtSequence([wrtOptions[0]])
  }, [wrtOptions, wrtSequence])

  // Track the last ascii value we sent to parent — used to break the update loop
  const lastSentRef = useRef(value || '')

  useEffect(() => {
    // Only sync from parent when the value is different from what WE last sent
    // (i.e. it came from an external source like loadExample, not from our own typing)
    if (value === lastSentRef.current) return
    lastSentRef.current = value || ''
    const mf = mlRef.current
    if (!mf) { setLatexValue(value || ''); return }
    mf.value = value || ''
    try { setLatexValue(mf.getValue('latex') || value || '') }
    catch { setLatexValue(value || '') }
  }, [value])

  useEffect(() => {
    if (exampleOperation) {
      // If it's total_derivative, map to derivative + toggle
      if (exampleOperation === 'total_derivative') {
        setOperation('derivative')
        setIsTotalDerivative(true)
      } else {
        setOperation(exampleOperation)
        setIsTotalDerivative(false)
      }
    }
    if (exampleWrt) {
      setWrtSequence([exampleWrt])
      setIntegrationSequence(prev => { const c=[...prev]; c[0]={...c[0], wrt: exampleWrt}; return c })
    }
    if (exampleBounds) {
      setIntegrationSequence(prev => {
        const c=[...prev]; c[0]={...c[0], boundsEnabled:true, boundLo:String(exampleBounds[0]), boundHi:String(exampleBounds[1])}; return c
      })
    } else if (exampleOperation === 'derivative') {
      setIntegrationSequence(prev => { const c=[...prev]; c[0]={...c[0], boundsEnabled:false}; return c })
    }
  }, [exampleOperation, exampleWrt, exampleBounds])

  // When switching to integral, insert ∫ into the field if it's empty
  // When switching AWAY from integral, strip the ∫ prefix from the field
  const prevOperationRef = useRef(operation)
  useEffect(() => {
    const mf = mlRef.current
    if (!mf) { prevOperationRef.current = operation; return }

    if (operation === 'integral' && prevOperationRef.current !== 'integral') {
      // Entering integral mode — insert ∫ if field is blank
      requestAnimationFrame(() => {
        const currentExpr = getExpressionValue(mf)
        if (!currentExpr || currentExpr === 'int') {
          const step = integrationSequence[0]
          const prefix = step.boundsEnabled && step.boundLo && step.boundHi
            ? `\\int_{${step.boundLo}}^{${step.boundHi}}`
            : '\\int'
          mf.value = prefix
          try { setLatexValue(mf.getValue('latex') || '') } catch {}
          lastSentRef.current = ''
          onChange?.('', mf.getValue('latex'))
          mf.focus()
        }
      })
    } else if (operation !== 'integral' && prevOperationRef.current === 'integral') {
      // Leaving integral mode — strip leading \int prefix (with optional bounds)
      requestAnimationFrame(() => {
        const currentLatex = mf.getValue('latex') || ''
        const stripped = currentLatex.replace(/^\\int(_\{[^}]*\}(\^\{[^}]*\})?)?\s*/, '').trim()
        if (stripped !== currentLatex) {
          mf.value = stripped
          try { setLatexValue(mf.getValue('latex') || '') } catch {}
          const ascii = getExpressionValue(mf)
          lastSentRef.current = ascii
          onChange?.(ascii, mf.getValue('latex'))
        }
      })
    }
    prevOperationRef.current = operation
  }, [operation])

  // Update integral symbol in field when bounds toggle or values change
  const prevIntSeqRef = useRef(integrationSequence)
  useEffect(() => {
    if (operation !== 'integral') return
    // Only update when integrationSequence actually changed (not on every render)
    const prev = prevIntSeqRef.current
    const curr = integrationSequence
    const changed = prev.length !== curr.length || prev.some((p, i) =>
      p.wrt !== curr[i]?.wrt || p.boundsEnabled !== curr[i]?.boundsEnabled ||
      p.boundLo !== curr[i]?.boundLo || p.boundHi !== curr[i]?.boundHi
    )
    prevIntSeqRef.current = curr
    if (!changed) return

    const mf = mlRef.current
    if (!mf) return
    requestAnimationFrame(() => {
      const step = curr[0]
      const prefix = step.boundsEnabled && step.boundLo && step.boundHi
        ? `\\int_{${step.boundLo}}^{${step.boundHi}}`
        : '\\int'

      const currentLatex = mf.getValue('latex') || ''

      // Match \\int with optional subscript/superscript (handles nested braces)
      // We use a function to find the matching brace rather than a naive [^}]*
      const intPrefixEnd = findIntPrefixEnd(currentLatex)
      let newLatex
      if (intPrefixEnd > 0) {
        // Replace existing \int prefix with updated one
        newLatex = prefix + currentLatex.slice(intPrefixEnd)
      } else if (currentLatex === '') {
        newLatex = prefix
      } else {
        // No existing \int prefix — don't prepend one
        // (user is typing a normal expression, don't mess with it)
        return
      }

      if (currentLatex !== newLatex) {
        mf.value = newLatex
        try { setLatexValue(mf.getValue('latex') || '') } catch {}
      }
    })
  }, [integrationSequence, operation])

  const handleInput = (e) => {
    const mf = e.target
    const rawExpr = getExpressionValue(mf)
    const ltx = mf.getValue('latex')
    setLatexValue(ltx)
    const bal = checkBalance(rawExpr)
    setBalanceError(bal.balanced ? null : bal.message)
    setSuggestions(getSuggestions(lastToken(rawExpr)))
    // Update our tracking ref BEFORE calling onChange so the sync effect doesn't fire
    lastSentRef.current = rawExpr
    onChange?.(rawExpr, ltx)

    // ── Auto-detect wrt from typed derivative notation ──
    if (operation === 'derivative' && !isTotalDerivative) {
      const lower = rawExpr.toLowerCase()
      const wrtMatch = lower.match(/(?:d\/d|d)([xyzt])(?:d([xyzt]))?(?:d([xyzt]))?/)
      if (wrtMatch) {
        const detected = [wrtMatch[1], wrtMatch[2], wrtMatch[3]].filter(Boolean)
        if (detected.length > 0) setWrtSequence(detected)
      }
    }
    if (operation === 'derivative' && isTotalDerivative) {
      const lower = rawExpr.toLowerCase()
      const tMatch = lower.match(/\bd\/d([xyzt])\b/)
      if (tMatch) setTotalWrt(tMatch[1])
    }

    // ── Auto-detect integration order from trailing dx/dy/dz ──
    if (operation === 'integral') {
      const lower = rawExpr.replace(/\s+/g, '')
      const diffMatch = lower.match(/d([xyzt])(?:d([xyzt]))?(?:d([xyzt]))?$/)
      if (diffMatch) {
        const vars = [diffMatch[1], diffMatch[2], diffMatch[3]].filter(Boolean)
        if (vars.length > 0) {
          setIntegrationSequence(prev => {
            const next = vars.map((v, i) => {
              const existing = prev[i]
              return existing
                ? { ...existing, wrt: v }
                : { wrt: v, boundsEnabled: false, boundLo: '0', boundHi: '1' }
            })
            return next
          })
        }
      }
    }
  }

  const applySuggestion = (s) => {
    if (!mlRef.current) return
    const mf = mlRef.current
    const current = mf.value
    mf.value = current.slice(0, current.length - lastToken(current).length) + s.completion
    mf.focus()
    setSuggestions([])
    setActiveSuggestion(-1)
    setLatexValue(mf.getValue('latex'))
    onChange?.(getExpressionValue(mf), mf.getValue('latex'))
  }

  const handleSolve = () => {
    if (!mlRef.current) return
    let expr = normaliseMathExpression(getExpressionValue(mlRef.current) || value || '')
    // Strip trailing differential symbols (dx, dy, dz, dt) that the user typed
    // as navigation shortcuts — they're encoded in integrationSequence, not the expression
    if (effectiveOperation === 'integral') {
      expr = expr.replace(/\s*d[xyzt](\s*d[xyzt])*\s*$/i, '').trim()
      // Also strip leading integral sign if present (MathLive may serialize \int as 'int')
      expr = expr.replace(/^\s*int\s*/i, '').trim()
    }
    const err = validateExpr(expr)
    if (err) { setBalanceError(err); return }
    setBalanceError(null)

    if (effectiveOperation === 'integral') {
      for (const step of integrationSequence) {
        if (step.boundsEnabled) {
          const lo = parseFloat(step.boundLo), hi = parseFloat(step.boundHi)
          if (!isFinite(lo) || !isFinite(hi)) {
            setBalanceError('Bounds must be numeric (e.g. 0 and 3).')
            return
          }
        }
      }
    }

    const intSeq = integrationSequence.map(i => ({
      wrt: i.wrt,
      bounds: i.boundsEnabled ? [parseFloat(i.boundLo), parseFloat(i.boundHi)] : null,
    }))

    onSolve?.({
      expr,
      operation: effectiveOperation,
      wrtSequence:          effectiveOperation === 'derivative' ? wrtSequence : undefined,
      wrt_sequence:         effectiveOperation === 'derivative' ? wrtSequence : undefined,
      integrationSequence:  effectiveOperation === 'integral'   ? intSeq     : undefined,
      integration_sequence: effectiveOperation === 'integral'   ? intSeq     : undefined,
      dep_vars:             effectiveOperation === 'total_derivative' ? [] : undefined,
      wrt: effectiveOperation === 'total_derivative'
        ? totalWrt
        : effectiveOperation === 'derivative'
          ? (wrtSequence[wrtSequence.length - 1] || 'x')
          : (integrationSequence[integrationSequence.length - 1]?.wrt || 'x'),
      order: effectiveOperation === 'derivative' ? (wrtSequence.length || 1) : 1,
      bounds: effectiveOperation === 'integral' && integrationSequence[integrationSequence.length - 1]?.boundsEnabled
        ? [parseFloat(integrationSequence[integrationSequence.length - 1].boundLo),
           parseFloat(integrationSequence[integrationSequence.length - 1].boundHi)]
        : null,
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSolve()
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSuggestion(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' && activeSuggestion >= 0) { e.preventDefault(); applySuggestion(suggestions[activeSuggestion]) }
      else if (e.key === 'Escape') { setSuggestions([]); setActiveSuggestion(-1) }
    }
  }

  const isComing = ['gradient', 'divergence', 'curl', 'ode'].includes(operation)

  return (
    <div className={styles.wrapper}>

      {/* ── 1. CATEGORY TABS (topmost) ── */}
      <div className={styles.catTabs} role="tablist" aria-label="Calculus category">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            role="tab"
            type="button"
            aria-selected={activeCategory === cat.id}
            className={`${styles.catTab} ${activeCategory === cat.id ? styles.catTabActive : ''}`}
            onClick={() => {
              const ops = OPS_BY_CATEGORY[cat.id]
              if (ops.length) setOperation(ops[0].value)
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* ── 2. OPERATION SELECTOR ── */}
      <div className={styles.opRow} role="group" aria-label="Operation">
        {OPS_BY_CATEGORY[activeCategory].map(op => (
          <button
            key={op.value}
            type="button"
            className={`${styles.opBtn} ${operation === op.value ? styles.opBtnActive : ''}`}
            onClick={() => setOperation(op.value)}
            aria-pressed={operation === op.value}
          >
            {op.label}
          </button>
        ))}
      </div>

      {/* ── 3. EQUATION TABS (below category/op, above sub-controls) ── */}
      {equations.length > 0 && (
        <div className={styles.eqTabs} role="tablist" aria-label="Equations">
          {equations.map((eq, i) => {
            const color = colors[i % colors.length] ?? '#2563eb'
            return (
              <button key={eq.id}
                role="tab"
                type="button"
                aria-selected={eq.id === activeId}
                className={`${styles.eqTab} ${eq.id === activeId ? styles.eqTabActive : ''}`}
                onClick={() => onSetActiveId?.(eq.id)}
                style={eq.id === activeId ? { borderTopColor: color } : {}}>
                <span className={styles.eqDot} style={{ background: color }} />
                <span className={styles.eqTabLabel}>
                  {eq.expr
                    ? (eq.expr.length > 10 ? eq.expr.slice(0, 10) + '…' : eq.expr)
                    : `f${i + 1}`}
                </span>
                {equations.length > 1 && (
                  <button className={styles.eqTabClose}
                    type="button"
                    onClick={e => { e.stopPropagation(); onRemoveEquation?.(eq.id) }}
                    aria-label={`Remove equation ${i + 1}`}>×</button>
                )}
              </button>
            )
          })}
          {equations.length < 6 && (
            <button className={styles.addEqBtn} type="button"
              onClick={() => onAddEquation?.()}
              aria-label="Add equation" title="Add equation">+</button>
          )}
        </div>
      )}

      {/* ── 4. OPERATION-SPECIFIC CONTROLS ── */}
      <div className={styles.subControls}>

        {/* Scalar: Derivative sub-controls */}
        {operation === 'derivative' && (
          <>
            <div className={styles.inlineRow}>
              <label className={styles.checkLabel}>
                <input type="checkbox" className={styles.checkboxInput}
                  checked={isTotalDerivative}
                  onChange={e => setIsTotalDerivative(e.target.checked)} />
                Total df/dt
              </label>
              {isTotalDerivative ? (
                <div className={styles.varPills} role="group" aria-label="Independent variable">
                  {['t','x','y','z'].map(v => (
                    <button key={v} type="button"
                      className={`${styles.varPill} ${totalWrt === v ? styles.varPillActive : ''}`}
                      onClick={() => setTotalWrt(v)}>
                      d/{v}
                    </button>
                  ))}
                </div>
              ) : (
                /* Partial: variable pills + nth-order shortcut */
                <div className={styles.inlineRow} style={{ flex: 1, flexWrap: 'wrap', gap: 4 }}>
                  {wrtOptions.map(v => (
                    <button key={v} type="button"
                      className={`${styles.varPill} ${wrtSequence[wrtSequence.length-1] === v ? styles.varPillActive : ''}`}
                      onClick={() => setWrtSequence(prev => prev.length < 5 ? [...prev, v] : prev)}>
                      ∂/{v}
                    </button>
                  ))}
                  {wrtSequence.length > 1 && (
                    <button type="button" className={styles.varPill}
                      onClick={() => setWrtSequence(prev => prev.slice(0, -1))}
                      title="Remove last variable">↩</button>
                  )}
                  {wrtSequence.length > 1 && (
                    <button type="button" className={styles.varPill}
                      onClick={() => setWrtSequence(['x'])}
                      title="Reset sequence">✕</button>
                  )}
                </div>
              )}
            </div>
            {/* nth-order shortcut: repeat last variable n times */}
            {!isTotalDerivative && (
              <div className={styles.inlineRow}>
                <span className={styles.microLabel}>
                  {wrtSequence.length === 1
                    ? `∂/${wrtSequence[0]}`
                    : wrtSequence.join(' ∂/')}
                  {wrtSequence.length > 1 ? ` (order ${wrtSequence.length})` : ''}
                </span>
                {/* Quick nth-order: hold same variable */}
                <span className={styles.microLabel} style={{ marginLeft: 'auto' }}>
                  n=
                </span>
                <button type="button" className={styles.microBtn}
                  disabled={wrtSequence.length <= 1}
                  onClick={() => setWrtSequence(prev => {
                    const last = prev[prev.length - 1]
                    // All same var? decrease order. Mixed? reset last
                    const allSame = prev.every(v => v === last)
                    if (allSame) return prev.slice(0, -1)
                    return prev.slice(0, -1)
                  })}>−</button>
                <span className={styles.microVal}>{wrtSequence.length}</span>
                <button type="button" className={styles.microBtn}
                  disabled={wrtSequence.length >= 5}
                  onClick={() => setWrtSequence(prev => {
                    const last = prev[prev.length - 1]
                    return [...prev, last]  // repeat last variable
                  })}>+</button>
              </div>
            )}
          </>
        )}

        {/* Scalar: Integral sub-controls */}
        {operation === 'integral' && (
          <div className={styles.integralControls}>
            {integrationSequence.map((step, idx) => (
              <div key={idx} className={styles.integralStep}>
                {/* Row 1: wrt pills + Definite + bounds + integral counter (right-aligned) */}
                <div className={styles.integralStepRow}>
                  <div className={styles.varPills} role="group" aria-label="Integration variable">
                    {wrtOptions.map(v => (
                      <button key={v} type="button"
                        className={`${styles.varPill} ${step.wrt === v ? styles.varPillActive : ''}`}
                        onClick={() => setIntegrationSequence(prev => {
                          const c=[...prev]; c[idx]={...c[idx], wrt:v}; return c
                        })}>
                        d{v}
                      </button>
                    ))}
                  </div>

                  <label className={styles.checkLabel}>
                    <input type="checkbox" className={styles.checkboxInput}
                      id={`def-${idx}`}
                      checked={step.boundsEnabled}
                      onChange={e => {
                        const val = e.target.checked
                        setIntegrationSequence(prev => { const c=[...prev]; c[idx]={...c[idx], boundsEnabled:val}; return c })
                      }} />
                    Definite
                  </label>

                  {step.boundsEnabled && (
                    <div className={styles.boundsRow}>
                      <input type="text" className={styles.boundInput} placeholder="a"
                        value={step.boundLo}
                        onChange={e => { const v=e.target.value; setIntegrationSequence(prev=>{ const c=[...prev]; c[idx]={...c[idx],boundLo:v}; return c }) }} />
                      <span className={styles.boundSep}>→</span>
                      <input type="text" className={styles.boundInput} placeholder="b"
                        value={step.boundHi}
                        onChange={e => { const v=e.target.value; setIntegrationSequence(prev=>{ const c=[...prev]; c[idx]={...c[idx],boundHi:v}; return c }) }} />
                    </div>
                  )}

                  {/* Integral count controls — right-aligned, only visible on first row */}
                  {idx === 0 && (
                    <div className={styles.integralCounter}>
                      <button type="button" className={styles.microBtn}
                        disabled={integrationSequence.length <= 1}
                        onClick={() => setIntegrationSequence(p => p.slice(1))}>−</button>
                      <span className={styles.microVal}>{integrationSequence.length}</span>
                      <button type="button" className={styles.microBtn}
                        disabled={integrationSequence.length >= 3}
                        onClick={() => setIntegrationSequence(p => [{wrt: wrtOptions[0]||'x', boundsEnabled:false, boundLo:'0', boundHi:'1'}, ...p])}>+</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vector: coming-soon notice */}
        {['gradient','divergence','curl'].includes(operation) && (
          <span className={styles.comingNotice}>
            {operation === 'gradient' ? 'Scalar field f(x,y,z)' : 'Vector field F = (P, Q, R)'} — backend coming soon
          </span>
        )}

        {/* ODE: coming-soon notice */}
        {operation === 'ode' && (
          <span className={styles.comingNotice}>ODE solver — coming soon</span>
        )}
      </div>

      {/* ── 4. EXPRESSION FIELD ── */}
      <div className={styles.fieldWrap}>
        {/* Quick-insert symbol toolbar */}
        <div className={styles.symbolBar} aria-label="Quick insert symbols">
          {SYMBOL_SHORTCUTS.map(sym => (
            <button
              key={sym.label}
              type="button"
              className={styles.symbolBtn}
              title={`Insert ${sym.ascii}`}
              onMouseDown={e => {
                // preventDefault so the math field doesn't lose focus
                e.preventDefault()
                const mf = mlRef.current
                if (!mf) return
                mf.focus()
                if (sym.latex === '\\sqrt{}') {
                  mf.executeCommand(['insert', '\\sqrt{#0}'])
                } else if (sym.latex === '\\frac{}{}') {
                  mf.executeCommand(['insert', '\\frac{#0}{#1}'])
                } else {
                  mf.executeCommand(['insert', sym.latex])
                }
                // Sync state
                setLatexValue(mf.getValue('latex') || '')
                const ascii = getExpressionValue(mf)
                onChange?.(ascii, mf.getValue('latex'))
              }}
            >
              {sym.label}
            </button>
          ))}
        </div>

        <math-field
          ref={mlRef}
          id="equation-input"
          class={styles.mathField}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type\ an\ expression…"
          virtual-keyboard-mode="manual"
          smart-mode="false"
        />
        {balanceError && (
          <p className={styles.errorHint} role="alert">{balanceError}</p>
        )}
        {suggestions.length > 0 && (
          <ul className={styles.suggestions} role="listbox"
            aria-activedescendant={activeSuggestion >= 0 ? `sugg-${activeSuggestion}` : undefined}>
            {suggestions.map((s, i) => (
              <li key={i} id={`sugg-${i}`}
                className={`${styles.suggestion} ${activeSuggestion === i ? styles.suggestionActive : ''}`}
                role="option" aria-selected={activeSuggestion === i} tabIndex={0}
                onClick={() => { applySuggestion(s); setActiveSuggestion(-1) }}
                onKeyDown={e => e.key==='Enter' && applySuggestion(s)}
                onMouseEnter={() => setActiveSuggestion(i)}
                onMouseLeave={() => setActiveSuggestion(-1)}>
                <span className={styles.suggestCompletion}>{s.completion}</span>
                <span className={styles.suggestDesc}>{s.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 5. ACTION ROW: Solve + View Graph ── */}
      <div className={styles.actionRow}>
        <div className={styles.actionBtns}>
          <button
            id="solve-btn"
            className={styles.solveBtn}
            onClick={handleSolve}
            disabled={loading || isComing}
            type="button"
            aria-label="Solve"
            title={isComing ? 'Backend coming soon' : 'Ctrl+Enter'}
          >
            {loading ? (
              <><span className={styles.spinner} aria-hidden="true" />Solving…</>
            ) : isComing ? (
              'Coming soon'
            ) : (
              <>Solve <span className={styles.solveBtnArrow}>→</span></>
            )}
          </button>
          <button
            className={styles.viewGraphBtn}
            onClick={() => {
              onViewGraph?.()
              // On desktop, also scroll the graph section into view
              const graphSection = document.querySelector('[class*="bottomRow"]')
              if (graphSection) {
                graphSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
            type="button"
            aria-label="View graph"
            title="Jump to graph"
          >
            Graph ↓
          </button>
        </div>
      </div>
    </div>
  )
}
