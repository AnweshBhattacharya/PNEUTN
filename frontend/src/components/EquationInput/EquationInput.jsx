/**
 * EquationInput — MathLive keyboard + live LaTeX preview + Smart Syntax.
 * No dropdowns anywhere: pill toggles, steppers, toggle switches.
 */
import React, { useEffect, useRef, useState } from 'react'
import 'mathlive'
import { getSuggestions, lastToken, validateExpr, checkBalance } from '../../lib/smartSyntax'
import EquationPreview from '../EquationPreview/EquationPreview'
import styles from './EquationInput.module.css'

const WRT_OPTIONS = ['x', 'y', 'z', 't']

export default function EquationInput({ value, onChange, onSolve, loading }) {
  const mlRef = useRef(null)
  const [latexValue, setLatexValue]     = useState('')
  const [suggestions, setSuggestions]   = useState([])
  const [balanceError, setBalanceError] = useState(null)
  const [operation, setOperation]       = useState('derivative')
  const [wrt, setWrt]                   = useState('x')
  const [order, setOrder]               = useState(1)
  const [boundsEnabled, setBoundsEnabled] = useState(false)
  const [boundLo, setBoundLo] = useState('0')
  const [boundHi, setBoundHi] = useState('1')
  const boundsToggleId = 'bounds-toggle'

  // Sync MathLive if parent changes value programmatically
  useEffect(() => {
    if (mlRef.current && mlRef.current.value !== value) {
      mlRef.current.value = value || ''
      // Also update latexValue so the preview refreshes
      try { setLatexValue(mlRef.current.getValue('latex') || '') } catch {}
    }
  }, [value])

  const handleInput = (e) => {
    const mf = e.target
    const expr = mf.value
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
    const ltx = mf.getValue('latex')
    setLatexValue(ltx)
    onChange?.(mf.value, ltx)
  }

  const handleSolve = () => {
    if (!mlRef.current) return
    const expr = mlRef.current.value
    const err = validateExpr(expr)
    if (err) { setBalanceError(err); return }
    setBalanceError(null)
    onSolve?.({
      expr,
      operation,
      wrt,
      order: parseInt(order, 10),
      bounds: boundsEnabled ? [parseFloat(boundLo), parseFloat(boundHi)] : null,
    })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSolve()
  }

  return (
    <div className={styles.wrapper}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <h2 className={styles.title}>Pneutn</h2>
        <p className={styles.subtitle}>Calculus Visualizer</p>
      </div>

      {/* ── MathLive input ── */}
      <div className={styles.inputRow}>
        <math-field
          ref={mlRef}
          id="equation-input"
          class={styles.mathField}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a math expression…"
          virtual-keyboard-mode="manual"
          smart-mode="false"
        />
      </div>

      {balanceError && (
        <p className={styles.errorHint} role="alert">{balanceError}</p>
      )}

      {/* ── Smart suggestions ── */}
      {suggestions.length > 0 && (
        <ul className={styles.suggestions} role="listbox" aria-label="Suggestions">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className={styles.suggestion}
              role="option"
              tabIndex={0}
              onClick={() => applySuggestion(s)}
              onKeyDown={(e) => e.key === 'Enter' && applySuggestion(s)}
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
        wrt={wrt}
        order={order}
        boundsEnabled={boundsEnabled}
        boundLo={boundLo}
        boundHi={boundHi}
      />

      {/* ── Controls ── */}
      <div className={styles.controls}>

        {/* Operation */}
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Operation</span>
          <div className={styles.pillGroup} role="group" aria-label="Operation">
            {[
              { value: 'derivative', label: 'd/dx' },
              { value: 'integral',   label: '∫ dx'  },
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

        {/* With respect to */}
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>With respect to</span>
          <div className={styles.pillGroup} role="group" aria-label="Variable">
            {WRT_OPTIONS.map(v => (
              <button
                key={v}
                className={`${styles.pill} ${wrt === v ? styles.pillActive : ''}`}
                onClick={() => setWrt(v)}
                type="button"
                aria-pressed={wrt === v}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Derivative order */}
        {operation === 'derivative' && (
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Order</span>
            <div className={styles.stepperRow}>
              <button
                className={styles.stepperBtn}
                type="button"
                disabled={order <= 1}
                onClick={() => setOrder(o => Math.max(1, o - 1))}
                aria-label="Decrease order"
              >−</button>
              <span className={styles.stepperValue} aria-live="polite">{order}</span>
              <button
                className={styles.stepperBtn}
                type="button"
                disabled={order >= 5}
                onClick={() => setOrder(o => Math.min(5, o + 1))}
                aria-label="Increase order"
              >+</button>
            </div>
          </div>
        )}

        {/* Integral bounds */}
        {operation === 'integral' && (
          <div className={styles.controlGroup}>
            <div className={styles.boundsToggleRow}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  id={boundsToggleId}
                  checked={boundsEnabled}
                  onChange={e => setBoundsEnabled(e.target.checked)}
                />
                <span className={styles.toggleTrack} />
                <span className={styles.toggleThumb} />
              </label>
              <label htmlFor={boundsToggleId} className={styles.toggleLabel}>
                Definite bounds
              </label>
            </div>
            {boundsEnabled && (
              <div className={styles.boundsRow}>
                <input
                  type="text"
                  value={boundLo}
                  onChange={e => setBoundLo(e.target.value)}
                  className={styles.boundInput}
                  placeholder="lower"
                  id="bound-lower"
                  aria-label="Lower bound"
                />
                <span className={styles.boundSep}>to</span>
                <input
                  type="text"
                  value={boundHi}
                  onChange={e => setBoundHi(e.target.value)}
                  className={styles.boundInput}
                  placeholder="upper"
                  id="bound-upper"
                  aria-label="Upper bound"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Solve button ── */}
      <div className={styles.actionRow}>
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
        <p className={styles.shortcutHint}>Ctrl + Enter</p>
      </div>
    </div>
  )
}
