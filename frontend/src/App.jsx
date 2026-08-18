/**
 * App.jsx — Pneutn main layout (redesigned).
 *
 * Layout (desktop):
 *   TOP ROW  — 50/50 split, fixed height ~52vh
 *     Left  : Input builder (MathLive field + controls + equation tabs)
 *     Right : Solution (result + step cards with KaTeX + explanations)
 *   BOTTOM ROW — flex 1, fills remaining viewport
 *     Sidebar : Curve list, area toggle, Riemann controls, region toggle
 *     Graph   : Full-width 2D/3D canvas + graph tabs
 *
 * On mobile: tabs switch between Input / Graph / Steps views.
 */
import React, { useState, useCallback, useEffect } from 'react'
import EquationInput from './components/EquationInput/EquationInput'
import GraphCanvas2D from './components/GraphCanvas2D/GraphCanvas2D'
import GraphCanvas3D from './components/GraphCanvas3D/GraphCanvas3D'
import StepPanel from './components/StepPanel/StepPanel'
import RiemannControls from './components/RiemannControls/RiemannControls'
import RegionToggle from './components/RegionToggle/RegionToggle'
import LoadingBar from './components/shared/LoadingBar'
import { solve as callSolve } from './lib/apiClient'
import styles from './App.module.css'

const EQ_COLORS      = ['#1a1917', '#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed']
const EQ_COLORS_DARK = ['#e8e6e1', '#60a5fa', '#f87171', '#4ade80', '#fbbf24', '#a78bfa']

const EXAMPLE_EXPRS = [
  { label: 'x² sin x',   expr: 'x^2*sin(x)',   wrt: 'x', operation: 'derivative' },
  { label: 'eˣ cos x',   expr: 'exp(x)*cos(x)', wrt: 'x', operation: 'derivative' },
  { label: '∫ x² [0,3]', expr: 'x^2',           wrt: 'x', operation: 'integral', bounds: [0, 3] },
  { label: 'x²y³ ∂/∂x',  expr: 'x^2*y^3',       wrt: 'x', operation: 'derivative' },
]

let _nextId = 1
function makeEq(expr = 'x^2') {
  return { id: String(_nextId++), expr, result: null, error: null, loading: false, isLocal: false, steps: [], numericSample: [] }
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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

  const [equations, setEquations]   = useState([makeEq('x^2')])
  const [activeId, setActiveId]     = useState(equations[0].id)
  const [graphMode, setGraphMode]   = useState('2d')
  const [riemannRects, setRiemannRects] = useState([])
  const [showArea, setShowArea]     = useState(false)
  const [regionVertices, setRegionVertices] = useState(null)
  const [activeExamplePatch, setActiveExamplePatch] = useState(null)
  const [mobilePanel, setMobilePanel] = useState('input')

  // 2D graph parameter controls
  const [showTangent,    setShowTangent]    = useState(true)
  const [showDerivative, setShowDerivative] = useState(false)
  const [showGrid,       setShowGrid]       = useState(true)
  const [markedX,        setMarkedX]        = useState(null)
  const [markedXInput,   setMarkedXInput]   = useState('')
  const [xRangeMin,      setXRangeMin]      = useState(null)
  const [xRangeMax,      setXRangeMax]      = useState(null)
  const [xRangeMinInput, setXRangeMinInput] = useState('-6')
  const [xRangeMaxInput, setXRangeMaxInput] = useState('6')

  // 3D graph parameter & limit controls
  const [xMin3D,         setXMin3D]         = useState(-4)
  const [xMax3D,         setXMax3D]         = useState(4)
  const [yMin3D,         setYMin3D]         = useState(-4)
  const [yMax3D,         setYMax3D]         = useState(4)
  const [xMin3DInput,    setXMin3DInput]    = useState('-4')
  const [xMax3DInput,    setXMax3DInput]    = useState('4')
  const [yMin3DInput,    setYMin3DInput]    = useState('-4')
  const [yMax3DInput,    setYMax3DInput]    = useState('4')
  const [showVolume3D,   setShowVolume3D]   = useState(true)
  const [showGrid3D,     setShowGrid3D]     = useState(true)
  const [showWireframe3D,setShowWireframe3D]= useState(true)

  const activeEq = equations.find(e => e.id === activeId) ?? equations[0]
  const activeCurveIndex = equations.findIndex(e => e.id === activeId)

  useEffect(() => { setActiveExamplePatch(null) }, [activeId])

  // Mobile tab switch resize trigger (Bug 7 / Bug 11)
  useEffect(() => {
    if (mobilePanel === 'graph') {
      const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 50)
      return () => clearTimeout(timer)
    }
  }, [mobilePanel])

  // ── equation management ───────────────────────────────────────────
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

  // ── solve ─────────────────────────────────────────────────────────
  const handleSolve = useCallback(async (params) => {
    const id = activeId
    updateEquation(id, { loading: true, error: null, result: null, steps: [] })
    setMobilePanel('steps')
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
    updateEquation(activeId, { expr: example.expr, result: null, error: null, steps: [] })
    setRiemannRects([])
    setActiveExamplePatch({
      operation: example.operation ?? null,
      wrt:       example.wrt       ?? null,
      bounds:    example.bounds    ?? null,
    })
  }

  const anyLoading = equations.some(e => e.loading)
  // graphEquations: only pass expr so GraphCanvas2D gets the raw math string
  const graphEquations = equations.map(e => ({ id: e.id, expr: e.expr }))
  const colors = theme === 'dark' ? EQ_COLORS_DARK : EQ_COLORS

  return (
    <div className={styles.app}>

      {/* ── Top bar ── */}
      <header className={styles.topBar}>
        <span className={styles.brand}>PNEUTN</span>

        <nav className={styles.topBarCenter} aria-label="Examples">
          {EXAMPLE_EXPRS.map((ex, i) => (
            <button key={i} className={styles.exampleChip} onClick={() => loadExample(ex)}>
              {ex.label}
            </button>
          ))}
        </nav>

        <div className={styles.topBarRight}>
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

      {/* ── Mobile tabs ── */}
      <div className={styles.mobileTabs} role="tablist">
        {[
          { id: 'input', label: 'Input' },
          { id: 'steps', label: 'Steps', badge: activeEq.steps?.length },
          { id: 'graph', label: 'Graph' },
        ].map(({ id, label, badge }) => (
          <button key={id} role="tab"
            aria-selected={mobilePanel === id}
            className={`${styles.mobileTab} ${mobilePanel === id ? styles.mobileTabActive : ''}`}
            onClick={() => setMobilePanel(id)}>
            {label}
            {badge > 0 && <span className={styles.stepCountBadge}>{badge}</span>}
          </button>
        ))}
      </div>

      <main className={styles.main}>

        {/* ══ TOP ROW: Input (left) + Solution (right) ══ */}
        <div className={styles.topRow}>

          {/* ── Input column ── */}
          <div className={`${styles.inputCol} ${mobilePanel !== 'input' ? styles.mobileHidden : ''}`}>

            {/* Equation tabs */}
            <div className={styles.eqTabs}>
              {equations.map((eq, i) => {
                const color = colors[i % colors.length]
                return (
                  <button key={eq.id}
                    className={`${styles.eqTab} ${eq.id === activeId ? styles.eqTabActive : ''}`}
                    onClick={() => setActiveId(eq.id)}
                    style={eq.id === activeId ? { borderTopColor: color } : {}}>
                    <span className={styles.eqDot} style={{ background: color }} />
                    <span className={styles.eqTabLabel}>
                      {eq.expr
                        ? (eq.expr.length > 12 ? eq.expr.slice(0, 12) + '…' : eq.expr)
                        : `f${i + 1}(x)`}
                    </span>
                    {equations.length > 1 && (
                      <button className={styles.eqTabClose}
                        onClick={e => { e.stopPropagation(); removeEquation(eq.id) }}
                        aria-label="Remove equation">×</button>
                    )}
                  </button>
                )
              })}
              {equations.length < 6 && (
                <button className={styles.addEqBtn} onClick={addEquation}
                  aria-label="Add equation" title="Add equation">+</button>
              )}
            </div>

            {/* Input builder */}
            <div className={styles.inputColBody}>
              <EquationInput
                key={activeEq.id}
                value={activeEq.expr}
                onChange={(expr) => updateExpr(activeEq.id, expr)}
                onSolve={handleSolve}
                loading={activeEq.loading}
                exampleOperation={activeExamplePatch?.operation}
                exampleWrt={activeExamplePatch?.wrt}
                exampleBounds={activeExamplePatch?.bounds}
              />
            </div>
          </div>

          {/* ── Solution column ── */}
          <div className={`${styles.solutionCol} ${mobilePanel !== 'steps' ? styles.solutionColMobileHidden : ''}`}>
            <div className={styles.solutionColBody}>
              <StepPanel
                result={activeEq.result}
                steps={activeEq.steps ?? []}
                loading={activeEq.loading}
                error={activeEq.error}
                isLocal={activeEq.isLocal}
              />
            </div>
          </div>

        </div>

        {/* ══ BOTTOM ROW: Graph ══ */}
        <div className={`${styles.bottomRow} ${mobilePanel === 'input' || mobilePanel === 'steps' ? styles.mobileHidden : ''}`}>

          {/* Graph mode tabs (full-width strip) */}
          <div className={styles.bottomRowHeader}>
            <div className={styles.graphTabs} role="tablist">
              {['2d', '3d'].map(mode => (
                <button key={mode} role="tab" aria-selected={graphMode === mode}
                  className={`${styles.tab} ${graphMode === mode ? styles.activeTab : ''}`}
                  onClick={() => setGraphMode(mode)}>
                  {mode === '2d' ? '2D Curve' : '3D Surface'}
                </button>
              ))}
            </div>
            {/* Area toggle in the header strip */}
            {graphMode === '2d' && (
              <label className={styles.areaToggleRow} style={{ cursor: 'pointer', gap: 8, display: 'flex', alignItems: 'center' }}>
                <span className={styles.areaLabel}>Area shading</span>
                <span className={styles.toggle}>
                  <input type="checkbox" checked={showArea}
                    onChange={e => setShowArea(e.target.checked)} />
                  <span className={styles.toggleTrack} />
                  <span className={styles.toggleThumb} />
                </span>
              </label>
            )}
          </div>

          <div className={styles.bottomRowBody}>

            {/* ── Left sidebar: curve list + controls ── */}
            {graphMode === '2d' && (
              <aside className={styles.graphSidebar}>

                {/* Curve list */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Curves</span>
                  {equations.map((eq, i) => {
                    const color = colors[i % colors.length]
                    return (
                      <div key={eq.id}
                        className={`${styles.curveRow} ${eq.id === activeId ? styles.curveRowActive : ''}`}
                        onClick={() => setActiveId(eq.id)}>
                        <span className={styles.curveSwatch} style={{ background: color }} />
                        <input
                          className={styles.curveExprInput}
                          value={eq.expr}
                          onChange={e => updateExpr(eq.id, e.target.value)}
                          placeholder={`f${i + 1}(x) = …`}
                          onClick={e => { e.stopPropagation(); setActiveId(eq.id) }}
                          aria-label={`Expression for curve ${i + 1}`}
                          spellCheck={false}
                        />
                        {equations.length > 1 && (
                          <button className={styles.curveRemoveBtn}
                            onClick={e => { e.stopPropagation(); removeEquation(eq.id) }}
                            aria-label={`Remove curve ${i + 1}`}>×</button>
                        )}
                      </div>
                    )
                  })}
                  {equations.length < 6 && (
                    <button className={styles.addCurveBtn} onClick={addEquation}>
                      + Add curve
                    </button>
                  )}
                </div>

                {/* Graph Controls (2D) */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Graph Controls</span>

                  {/* Toggle row helper */}
                  {[
                    { label: 'Tangent line', value: showTangent, set: setShowTangent },
                    { label: 'Derivative f′(x)', value: showDerivative, set: setShowDerivative },
                    { label: 'Grid', value: showGrid, set: setShowGrid },
                  ].map(({ label, value, set }) => (
                    <label key={label} className={styles.areaToggleRow} style={{ cursor: 'pointer', gap: 8, display: 'flex', alignItems: 'center', padding: '4px 4px' }}>
                      <span className={styles.areaLabel} style={{ flex: 1 }}>{label}</span>
                      <span className={styles.toggle}>
                        <input type="checkbox" checked={value} onChange={e => set(e.target.checked)} />
                        <span className={styles.toggleTrack} />
                        <span className={styles.toggleThumb} />
                      </span>
                    </label>
                  ))}

                  {/* X-range inputs */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={styles.areaLabel}>X range</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={xRangeMinInput}
                        onChange={e => {
                          setXRangeMinInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setXRangeMin(isFinite(v) ? v : null)
                        }}
                        placeholder="−6"
                        aria-label="X minimum"
                      />
                      <span className={styles.areaLabel}>to</span>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={xRangeMaxInput}
                        onChange={e => {
                          setXRangeMaxInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setXRangeMax(isFinite(v) ? v : null)
                        }}
                        placeholder="6"
                        aria-label="X maximum"
                      />
                    </div>
                  </div>

                  {/* Mark point x = a */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={styles.areaLabel}>Mark x =</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 70, borderRadius: 2 }}
                        value={markedXInput}
                        onChange={e => {
                          setMarkedXInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setMarkedX(isFinite(v) ? v : null)
                        }}
                        placeholder="e.g. 2"
                        aria-label="Mark x value"
                      />
                      {markedX != null && (
                        <button
                          className={styles.curveRemoveBtn}
                          onClick={() => { setMarkedX(null); setMarkedXInput('') }}
                          title="Clear mark"
                        >×</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Riemann sum */}
                <RiemannControls
                  exprStr={activeEq.expr}
                  bounds={[0, 4]}
                  onRectangles={setRiemannRects}
                />

                {/* Region / integration order */}
                <RegionToggle
                  onRegionData={(data) => setRegionVertices(data.region_vertices ?? null)}
                />

                {/* Numeric sample */}
                {activeEq.numericSample?.length > 0 && (
                  <div className={styles.numericSampleSection}>
                    <span className={styles.numericHeader}>Sample points</span>
                    <div className={styles.numericStrip}>
                      {activeEq.numericSample.slice(0, 7).map(({ x, y }, i) => (
                        <span key={i} className={styles.numericPill}>
                          ({x}, {y})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </aside>
            )}

            {/* ── Left sidebar: 3D controls & limit settings ── */}
            {graphMode === '3d' && (
              <aside className={styles.graphSidebar}>
                {/* 3D Equation */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Surface Function</span>
                  <div className={`${styles.curveRow} ${styles.curveRowActive}`}>
                    <span className={styles.curveSwatch} style={{ background: '#2563eb' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--content-secondary)', marginRight: 2 }}>z =</span>
                    <input
                      className={styles.curveExprInput}
                      value={activeEq.expr}
                      onChange={e => updateExpr(activeEq.id, e.target.value)}
                      placeholder="e.g. sin(x) * cos(y)"
                      aria-label="3D surface expression z = f(x, y)"
                      spellCheck={false}
                    />
                  </div>
                </div>

                {/* 3D Limit Settings */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>3D Limit Settings</span>

                  {/* X domain limits */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={styles.areaLabel}>X Limits [x_min, x_max]</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={xMin3DInput}
                        onChange={e => {
                          setXMin3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          if (isFinite(v)) setXMin3D(v)
                        }}
                        placeholder="−4"
                        aria-label="3D X minimum"
                      />
                      <span className={styles.areaLabel}>to</span>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={xMax3DInput}
                        onChange={e => {
                          setXMax3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          if (isFinite(v)) setXMax3D(v)
                        }}
                        placeholder="4"
                        aria-label="3D X maximum"
                      />
                    </div>
                  </div>

                  {/* Y domain limits */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <span className={styles.areaLabel}>Y Limits [y_min, y_max]</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={yMin3DInput}
                        onChange={e => {
                          setYMin3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          if (isFinite(v)) setYMin3D(v)
                        }}
                        placeholder="−4"
                        aria-label="3D Y minimum"
                      />
                      <span className={styles.areaLabel}>to</span>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52, borderRadius: 2 }}
                        value={yMax3DInput}
                        onChange={e => {
                          setYMax3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          if (isFinite(v)) setYMax3D(v)
                        }}
                        placeholder="4"
                        aria-label="3D Y maximum"
                      />
                    </div>
                  </div>
                </div>

                {/* 3D Visual & Volume Toggles */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Volume & Display</span>

                  {[
                    { label: 'Volume under surface (∬ z dA)', value: showVolume3D, set: setShowVolume3D },
                    { label: '3D Floor Grid', value: showGrid3D, set: setShowGrid3D },
                    { label: 'Surface Wireframe', value: showWireframe3D, set: setShowWireframe3D },
                  ].map(({ label, value, set }) => (
                    <label key={label} className={styles.areaToggleRow} style={{ cursor: 'pointer', gap: 8, display: 'flex', alignItems: 'center', padding: '4px 4px' }}>
                      <span className={styles.areaLabel} style={{ flex: 1 }}>{label}</span>
                      <span className={styles.toggle}>
                        <input type="checkbox" checked={value} onChange={e => set(e.target.checked)} />
                        <span className={styles.toggleTrack} />
                        <span className={styles.toggleThumb} />
                      </span>
                    </label>
                  ))}
                </div>
              </aside>
            )}

            {/* ── Main graph canvas ── */}
            <div className={styles.graphMain}>
              {graphMode === '2d' && (
                <GraphCanvas2D
                  equations={graphEquations}
                  activeCurveIndex={activeCurveIndex >= 0 ? activeCurveIndex : 0}
                  overlayRectangles={riemannRects}
                  showArea={showArea}
                  regionVertices={regionVertices}
                  showTangent={showTangent}
                  showDerivative={showDerivative}
                  showGrid={showGrid}
                  markedX={markedX}
                  xRangeMin={xRangeMin}
                  xRangeMax={xRangeMax}
                />
              )}
              {graphMode === '3d' && (
                <GraphCanvas3D
                  exprStr={activeEq.expr || 'sin(x) * cos(y)'}
                  xMin={xMin3D}
                  xMax={xMax3D}
                  yMin={yMin3D}
                  yMax={yMax3D}
                  showVolume={showVolume3D}
                  showGrid={showGrid3D}
                  showWireframe={showWireframe3D}
                />
              )}
            </div>

          </div>
        </div>

      </main>

      <footer className={styles.footer}>
        <span>PNEUTN — anonymous · stateless · serverless</span>
        <span>React + Three.js + SymPy + Gemini</span>
      </footer>
    </div>
  )
}
