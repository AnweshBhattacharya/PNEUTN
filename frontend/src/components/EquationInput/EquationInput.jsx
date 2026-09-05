/**
 * EquationInput — MathLive keyboard + live LaTeX preview + Smart Syntax.
 * No dropdowns anywhere: pill toggles, steppers, toggle switches.
 */
import React, { useEffect, useRef, useState, useMemo } from 'react'
import 'mathlive'
import { getSuggestions, lastToken, validateExpr, checkBalance } from '../../lib/smartSyntax'
import { normaliseMathExpression, extractVariables } from '../../lib/mathInput'
import EquationPreview from '../EquationPreview/EquationPreview'
import styles from './EquationInput.module.css'

/**
 * MathLive's `value` is LaTeX-oriented. The API and graph evaluator instead
 * accept ASCII-style maths (for example `sin(x)` and `sqrt(x^2 + 1)`).
 * Exporting the expression explicitly keeps physical and virtual-keyboard
 * input on the same safe, executable format.
 */
function getExpressionValue(mathfield) {
  try {
    return normaliseMathExpression(mathfield.getValue('ascii-math') || mathfield.value || '')
  } catch {
    return normaliseMathExpression(mathfield.value || '')
  }
}

export default function EquationInput({ value, onChange, onSolve, loading,
  exampleOperation, exampleWrt, exampleBounds }) {
  const mlRef = useRef(null)
  const [latexValue, setLatexValue]     = useState(value || '')
  const [suggestions, setSuggestions]   = useState([])
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const [balanceError, setBalanceError] = useState(null)
  const [operation, setOperation]       = useState('derivative')
  const [wrtSequence, setWrtSequence]   = useState(['x'])
  const [integrationSequence, setIntegrationSequence] = useState([
    { wrt: 'x', boundsEnabled: false, boundLo: '0', boundHi: '1' }
  ])
  const [totalWrt, setTotalWrt]         = useState('t')  // independent var for df/dt

  const wrtOptions = useMemo(() => {
    const raw = value || latexValue || ''
    const detected = extractVariables(raw)
    const defaults = ['x', 'y', 'z', 't']
    const combined = [...detected]
    for (const d of defaults) {
      if (!combined.includes(d) && combined.length < 5) {
        combined.push(d)
      }
    }
    return combined
  }, [value, latexValue])

  useEffect(() => {
    if (wrtSequence.length === 0 && wrtOptions.length > 0) {
      setWrtSequence([wrtOptions[0]])
    }
  }, [wrtOptions, wrtSequence])

  // Sync MathLive if parent changes value programmatically
  useEffect(() => {
    if (mlRef.current) {
      if (mlRef.current.value !== value) {
        mlRef.current.value = value || ''
      }
      try {
        setLatexValue(mlRef.current.getValue('latex') || value || '')
      } catch {
        setLatexValue(value || '')
      }
    } else {
      setLatexValue(value || '')
    }
  }, [value])

  // Apply example settings when parent loads an example chip (F5)
  useEffect(() => {
    if (exampleOperation) setOperation(exampleOperation)
    if (exampleWrt) {
      setWrtSequence([exampleWrt])
      setIntegrationSequence(prev => {
        const copy = [...prev]
        copy[0] = { ...copy[0], wrt: exampleWrt }
        return copy
      })
    }
    if (exampleBounds) {
      setIntegrationSequence(prev => {
        const copy = [...prev]
        copy[0] = { ...copy[0], boundsEnabled: true, boundLo: String(exampleBounds[0]), boundHi: String(exampleBounds[1]) }
        return copy
      })
    } else if (exampleOperation === 'derivative') {
      setIntegrationSequence(prev => {
        const copy = [...prev]
        copy[0] = { ...copy[0], boundsEnabled: false }
        return copy
      })
    }
  }, [exampleOperation, exampleWrt, exampleBounds])

  const handleInput = (e) => {
    const mf = e.target
    const expr = getExpressionValue(mf)
    const ltx  = mf.getValue('latex')
    setLatexValue(ltx)

    const bal = checkBalance(expr)
    setBalanceError(bal.balanced ? null : bal.message)

    const token = lastToken(expr)
    setSuggestions(getSuggestions(token))

    onChange?.(expr, ltx)
  }

  const applySuggestion = (s) => {
    if (!mlRef.current) return
    const mf = mlRef.current
    const current = mf.value
    const token = lastToken(current)
    mf.value = current.slice(0, current.length - token.length) + s.completion
    mf.focus()
    setSuggestions([])
    setActiveSuggestion(-1)
    const ltx = mf.getValue('latex')
    setLatexValue(ltx)
    onChange?.(getExpressionValue(mf), ltx)
  }

  const handleSolve = () => {
    if (!mlRef.current) return
    const rawVal = getExpressionValue(mlRef.current) || value || ''
    const expr = normaliseMathExpression(rawVal)
    const err = validateExpr(expr)
    if (err) { setBalanceError(err); return }
    setBalanceError(null)

    // Validate bounds before sending — prevents NaN→null serialization (AC1)
    if (operation === 'integral') {
      for (const step of integrationSequence) {
        if (step.boundsEnabled) {
          const lo = parseFloat(step.boundLo)
          const hi = parseFloat(step.boundHi)
          if (!isFinite(lo) || !isFinite(hi)) {
            setBalanceError('Bounds must be numeric values (e.g. 0 and 3).')
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
      operation,
      wrtSequence: operation === 'derivative' ? wrtSequence : undefined,
      wrt_sequence: operation === 'derivative' ? wrtSequence : undefined,
      integrationSequence: operation === 'integral' ? intSeq : undefined,
      integration_sequence: operation === 'integral' ? intSeq : undefined,
      // total_derivative params — dep_vars: [] means backend auto-detects free symbols
      dep_vars: operation === 'total_derivative' ? [] : undefined,
      wrt: operation === 'total_derivative'
        ? totalWrt
        : operation === 'derivative'
          ? (wrtSequence[wrtSequence.length - 1] || 'x')
          : (integrationSequence[integrationSequence.length - 1]?.wrt || 'x'),
      order: operation === 'derivative' ? (wrtSequence.length || 1) : 1,
      bounds: operation === 'integral' && integrationSequence[integrationSequence.length - 1]?.boundsEnabled
        ? [parseFloat(integrationSequence[integrationSequence.length - 1].boundLo), parseFloat(integrationSequence[integrationSequence.length - 1].boundHi)]
        : null,
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSolve()
    // Suggestion listbox keyboard navigation (F8)
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveSuggestion(i => Math.min(i + 1, suggestions.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveSuggestion(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && activeSuggestion >= 0) {
        e.preventDefault()
        applySuggestion(suggestions[activeSuggestion])
      } else if (e.key === 'Escape') {
        setSuggestions([])
        setActiveSuggestion(-1)
      }
    }
  }

  return (
    <div className={styles.wrapper}>
      {/* ── MathLive input ── */}
      <div className={styles.inputRow}>
        <math-field
          ref={mlRef}
          id="equation-input"
          class={styles.mathField}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type\ a\ math\ expression"
          virtual-keyboard-mode="manual"
          smart-mode="false"
        />
      </div>

      {balanceError && (
        <p className={styles.errorHint} role="alert">{balanceError}</p>
      )}

      {/* ── Smart suggestions ── */}
      {suggestions.length > 0 && (
        <ul className={styles.suggestions} role="listbox" aria-label="Suggestions"
        aria-activedescendant={activeSuggestion >= 0 ? `suggestion-${activeSuggestion}` : undefined}>
        {suggestions.map((s, i) => (
          <li
            key={i}
            id={`suggestion-${i}`}
            className={`${styles.suggestion} ${activeSuggestion === i ? styles.suggestionActive : ''}`}
            role="option"
            aria-selected={activeSuggestion === i}
            tabIndex={0}
            onClick={() => { applySuggestion(s); setActiveSuggestion(-1) }}
            onKeyDown={(e) => e.key === 'Enter' && applySuggestion(s)}
            onMouseEnter={() => setActiveSuggestion(i)}
            onMouseLeave={() => setActiveSuggestion(-1)}
          >
            <span className={styles.suggestCompletion}>{s.completion}</span>
            <span className={styles.suggestDesc}>{s.description}</span>
          </li>
        ))}
      </ul>
      )}

      {/* ── Live LaTeX preview ── */}
      <EquationPreview
        latexExpr={latexValue}
        operation={operation}
        wrtSequence={wrtSequence}
        integrationSequence={integrationSequence}
        totalWrt={totalWrt}
      />

      {/* ── Controls ── */}
      <div className={styles.controls}>
        {/* Operation + wrt on one row */}
        <div className={styles.controlRow}>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Op</span>
            <div className={styles.pillGroup} role="group" aria-label="Operation">
              {[
                { value: 'derivative',       label: 'd/dx'  },
                { value: 'integral',         label: '∫ dx'  },
                { value: 'total_derivative', label: 'df/dt' },
              ].map(op => (
                <button
                  key={op.value}
                  className={`${styles.pill} ${operation === op.value ? styles.pillActive : ''}`}
                  onClick={() => setOperation(op.value)}
                  type="button"
                  aria-pressed={operation === op.value}
                >
                  {op.label}
                </button>
              ))}
            </div>
          </div>

          {/* Wrt / variable selector — hidden for total_derivative, gradient, divergence, curl */}
          {!['total_derivative', 'gradient', 'divergence', 'curl'].includes(operation) && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>{operation === 'derivative' ? 'Wrt Add' : 'Wrt'}</span>
            <div className={styles.pillGroup} role="group" aria-label="Variable">
              {wrtOptions.map(v => (
                <button
                  key={v}
                  className={`${styles.pill}`}
                  onClick={() => {
                    if (operation === 'derivative') {
                      setWrtSequence(prev => prev.length < 5 ? [...prev, v] : prev)
                    } else {
                      setIntegrationSequence(prev => {
                        const copy = [...prev]
                        copy[copy.length - 1].wrt = v
                        return copy
                      })
                    }
                  }}
                  type="button"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Derivative Sequence Builder */}
        {operation === 'derivative' && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Sequence</span>
            <div className={styles.stepperRow} style={{ flexWrap: 'wrap', gap: '4px' }}>
              {wrtSequence.map((w, i) => (
                <span key={i} className={styles.pillActive} style={{ padding: '2px 6px', fontSize: '12px', border: '1px solid var(--border-color)', borderRadius: '0' }}>
                  ∂{w}
                </span>
              ))}
              {wrtSequence.length > 0 && (
                <button
                  className={styles.pill}
                  style={{ padding: '2px 6px', fontSize: '12px' }}
                  onClick={() => setWrtSequence(prev => prev.slice(0, -1))}
                >
                  undo
                </button>
              )}
            </div>
          </div>
        )}

        {/* Total Derivative — independent variable selector */}
        {operation === 'total_derivative' && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>d/d</span>
            <div className={styles.pillGroup} role="group" aria-label="Independent variable">
              {['t', 'x', 'y', 'z'].map(v => (
                <button
                  key={v}
                  className={`${styles.pill} ${totalWrt === v ? styles.pillActive : ''}`}
                  onClick={() => setTotalWrt(v)}
                  type="button"
                  aria-pressed={totalWrt === v}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Integral sequences */}
        {operation === 'integral' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className={styles.controlGroup}>
              <span className={styles.controlLabel}>Integrals</span>
              <div className={styles.stepperRow}>
                <button className={styles.stepperBtn} type="button" disabled={integrationSequence.length <= 1} onClick={() => setIntegrationSequence(p => p.slice(1))}>−</button>
                <span className={styles.stepperValue}>{integrationSequence.length}</span>
                <button className={styles.stepperBtn} type="button" disabled={integrationSequence.length >= 3} onClick={() => setIntegrationSequence(p => [{ wrt: wrtOptions[0] || 'x', boundsEnabled: false, boundLo: '0', boundHi: '1' }, ...p])}>+</button>
              </div>
            </div>

            {integrationSequence.map((step, idx) => (
              <div key={idx} className={styles.controlGroup} style={{ borderLeft: '2px solid var(--border-color)', paddingLeft: '8px', marginLeft: '4px' }}>
                <span className={styles.controlLabel}>d{step.wrt} bounds</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                  <div className={styles.boundsToggleRow}>
                    <label className={styles.toggle}>
                      <input
                        type="checkbox"
                        checked={step.boundsEnabled}
                        onChange={e => {
                          const val = e.target.checked
                          setIntegrationSequence(prev => {
                            const copy = [...prev]
                            copy[idx] = { ...copy[idx], boundsEnabled: val }
                            return copy
                          })
                        }}
                      />
                      <span className={styles.toggleTrack} />
                      <span className={styles.toggleThumb} />
                    </label>
                    <label className={styles.toggleLabel}>Definite</label>
                  </div>
                  {step.boundsEnabled && (
                    <div className={styles.boundsRow}>
                      <input
                        type="text"
                        value={step.boundLo}
                        onChange={e => {
                          const val = e.target.value
                          setIntegrationSequence(prev => {
                            const copy = [...prev]
                            copy[idx] = { ...copy[idx], boundLo: val }
                            return copy
                          })
                        }}
                        className={styles.boundInput}
                        placeholder="lower"
                      />
                      <span className={styles.boundSep}>to</span>
                      <input
                        type="text"
                        value={step.boundHi}
                        onChange={e => {
                          const val = e.target.value
                          setIntegrationSequence(prev => {
                            const copy = [...prev]
                            copy[idx] = { ...copy[idx], boundHi: val }
                            return copy
                          })
                        }}
                        className={styles.boundInput}
                        placeholder="upper"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Solve button ── */}
      <div className={styles.actionRow}>
        {/* U4: Document Ctrl+Enter shortcut */}
        <p className={styles.shortcutHint}>
          Tip: press <kbd style={{ fontFamily: 'var(--font-mono)', padding: '1px 5px', border: '1px solid var(--border-color)', borderRadius: 0, fontSize: 10 }}>Ctrl+Enter</kbd> to solve
        </p>
        <button
          id="solve-btn"
          className={styles.solveBtn}
          onClick={handleSolve}
          disabled={loading}
          type="button"
          aria-label="Solve expression"
        >
          {loading ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Solving…
            </>
          ) : (
            <>Solve <span className={styles.solveBtnArrow}>→</span></>
          )}
        </button>
      </div>
    </div>
  )
}
