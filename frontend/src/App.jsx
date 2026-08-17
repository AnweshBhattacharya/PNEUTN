/**
 * App.jsx — main layout.
 *
 * Multi-equation state: users can add up to 6 equations with the "+" button.
 * Each equation has its own solve result and step panel tab.
 * GraphCanvas2D receives all equations at once and renders them together,
 * with optional area shading between the first two.
 */
import React, { useState, useCallback, useEffect, useId } from 'react'
import EquationInput from './components/EquationInput/EquationInput'
import GraphCanvas2D from './components/GraphCanvas2D/GraphCanvas2D'
import GraphCanvas3D from './components/GraphCanvas3D/GraphCanvas3D'
import StepPanel from './components/StepPanel/StepPanel'
import RiemannControls from './components/RiemannControls/RiemannControls'
import RegionToggle from './components/RegionToggle/RegionToggle'
import LoadingBar from './components/shared/LoadingBar'
import { solve as callSolve } from './lib/apiClient'
import styles from './App.module.css'

// Palette mirrors GraphCanvas2D.jsx
const EQ_COLORS = ['#1a1917', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed']
const EQ_COLORS_DARK = ['#e8e6e1', '#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa']

const EXAMPLE_EXPRS = [
  { label: 'x² sin x',  expr: 'x^2*sin(x)', wrt: 'x', operation: 'derivative' },
  { label: 'eˣ cos x',  expr: 'exp(x)*cos(x)', wrt: 'x', operation: 'derivative' },
  { label: '∫ x² [0,3]',expr: 'x^2', wrt: 'x', operation: 'integral', bounds: [0, 3] },
  { label: 'x²y³ ∂/∂x', expr: 'x^2*y^3', wrt: 'x', operation: 'derivative' },
]

let _nextId = 1
function makeEq(expr = 'x^2') {
  return { id: String(_nextId++), expr, result: null, error: null, loading: false, isLocal: false, steps: [] }
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('pneutn-theme')
      if (stored) return stored
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pneutn-theme', theme)
  }, [theme])
  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle }
}

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme()

  // Multi-equation state
  const [equations, setEquations] = useState([makeEq('x^2')])
  const [activeId, setActiveId] = useState(equations[0].id)
  const [graphMode, setGraphMode] = useState('2d')
  const [riemannRects, setRiemannRects] = useState([])
  const [showArea, setShowArea] = useState(false)

  const activeEq = equations.find(e => e.id === activeId) ?? equations[0]

  // ── equation list management ────────────────────────────────────────
  const addEquation = () => {
    if (equations.length >= 6) return
    const eq = makeEq('')
    setEquations(prev => [...prev, eq])
    setActiveId(eq.id)
  }

  const removeEquation = (id) => {
    if (equations.length <= 1) return
    setEquations(prev => {
      const next = prev.filter(e => e.id !== id)
      if (activeId === id) setActiveId(next[Math.max(0, prev.findIndex(e => e.id === id) - 1)].id)
      return next
    })
  }

  const updateExpr = useCallback((id, expr) => {
    setEquations(prev => prev.map(e => e.id === id ? { ...e, expr } : e))
  }, [])

  const updateEquation = useCallback((id, patch) => {
    setEquations(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e))
  }, [])

  // ── solve ──────────────────────────────────────────────────────────
  const handleSolve = useCallback(async (params) => {
    const id = activeId
    updateEquation(id, { loading: true, error: null, result: null, steps: [] })
    try {
      const data = await callSolve(params)
      updateEquation(id, {
        loading: false,
        result: data.result_latex,
        steps: data.steps ?? [],
        isLocal: !!data._local,
        numericSample: data.result_numeric_sample ?? [],
      })
    } catch (e) {
      updateEquation(id, { loading: false, error: e.message || 'An error occurred.' })
    }
  }, [activeId, updateEquation])

  const loadExample = (example) => {
    const id = activeId
    updateEquation(id, { expr: example.expr, result: null, error: null, steps: [] })
    setRiemannRects([])
  }

  const anyLoading = equations.some(e => e.loading)

  // Build equations array for GraphCanvas
  const graphEquations = equations.map(e => ({ id: e.id, expr: e.expr }))

  return (
    <div className={styles.app}>
      {/* ── Top bar ── */}
      <header className={styles.topBar}>
        <span className={styles.brand}>PNEUTN</span>
        <nav className={styles.topBarCenter} aria-label="Examples">
          {EXAMPLE_EXPRS.map((ex, i) => (
            <button key={i} className={styles.exampleChip} onClick={() => loadExample(ex)} id={`example-${i}`}>
              {ex.label}
            </button>
          ))}
        </nav>
        <div className={styles.topBarRight}>
          {equations.length >= 2 && (
            <label className={styles.areaToggle}>
              <span className={styles.toggle}>
                <input type="checkbox" checked={showArea} onChange={e => setShowArea(e.target.checked)} />
                <span className={styles.toggleTrack} />
                <span className={styles.toggleThumb} />
              </span>
              <span className={styles.areaLabel}>Area</span>
            </label>
          )}
          <button className={styles.themeBtn} onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {anyLoading && (
        <div className={styles.loadingBanner}>
          <LoadingBar active label="Computing…" />
        </div>
      )}

      <main className={styles.main}>
        {/* ── Left panel: input tabs + step panel ── */}
        <aside className={styles.leftPanel}>
          {/* Equation tabs */}
          <div className={styles.eqTabs}>
            {equations.map((eq, i) => {
              const dark = document.documentElement.getAttribute('data-theme') === 'dark'
              const colors = dark ? EQ_COLORS_DARK : EQ_COLORS
              const color = colors[i % colors.length]
              return (
                <button
                  key={eq.id}
                  className={`${styles.eqTab} ${eq.id === activeId ? styles.eqTabActive : ''}`}
                  onClick={() => setActiveId(eq.id)}
                  style={eq.id === activeId ? { borderTopColor: color } : {}}
                >
                  <span className={styles.eqDot} style={{ background: color }} />
                  <span className={styles.eqTabLabel}>
                    {eq.expr ? (eq.expr.length > 12 ? eq.expr.slice(0, 12) + '…' : eq.expr) : `f${i + 1}(x)`}
                  </span>
                  {equations.length > 1 && (
                    <button
                      className={styles.eqTabClose}
                      onClick={e => { e.stopPropagation(); removeEquation(eq.id) }}
                      aria-label="Remove equation"
                    >×</button>
                  )}
                </button>
              )
            })}
            {equations.length < 6 && (
              <button className={styles.addEqBtn} onClick={addEquation} aria-label="Add equation" title="Add equation">
                +
              </button>
            )}
          </div>

          {/* Active equation input */}
          <EquationInput
            key={activeEq.id}
            value={activeEq.expr}
            onChange={(expr) => updateExpr(activeEq.id, expr)}
            onSolve={handleSolve}
            loading={activeEq.loading}
          />

          {/* Step panel */}
          <div className={styles.stepWrapper}>
            <StepPanel
              result={activeEq.result}
              steps={activeEq.steps ?? []}
              loading={activeEq.loading}
              error={activeEq.error}
              isLocal={activeEq.isLocal}
            />
          </div>
        </aside>

        {/* ── Right panel: graph + controls ── */}
        <section className={styles.rightPanel}>
          <div className={styles.graphTabs} role="tablist">
            {['2d', '3d'].map(mode => (
              <button key={mode} role="tab" aria-selected={graphMode === mode}
                className={`${styles.tab} ${graphMode === mode ? styles.activeTab : ''}`}
                onClick={() => setGraphMode(mode)}>
                {mode === '2d' ? '2D Curve' : '3D Surface'}
              </button>
            ))}
          </div>

          {graphMode === '2d' && (
            <GraphCanvas2D
              equations={graphEquations}
              overlayRectangles={riemannRects}
              showArea={showArea && equations.length >= 2}
            />
          )}
          {graphMode === '3d' && (
            <GraphCanvas3D
              exprStr={activeEq.expr || 'x^2'}
              xMin={-4} xMax={4} yMin={-4} yMax={4}
            />
          )}

          {graphMode === '2d' && (
            <RiemannControls
              exprStr={activeEq.expr}
              bounds={[0, 4]}
              onRectangles={setRiemannRects}
            />
          )}

          <RegionToggle />

          {activeEq.numericSample?.length > 0 && (
            <div className={styles.numericSample}>
              <div className={styles.numericHeader}>Numeric sample points</div>
              <div className={styles.numericTable}>
                {activeEq.numericSample.map(({ x, y }, i) => (
                  <div key={i} className={styles.numericRow}>
                    <span className={styles.numericCell}>x = {x}</span>
                    <span className={styles.numericCell}>y = {y}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
