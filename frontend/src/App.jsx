/**
 * App.jsx — Pneutn main layout.
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
 *
 * Bug fixes applied (see bugfix.md):
 *   B0  — Removed duplicate import block and broken JSX fragment
 *   B1  — RiemannControls now receives dynamic riemannBoundsLo/Hi state
 *   B9  — riemannRects + riemannSumResult cleared on activeId change
 *   U1  — onSumResult wired to setRiemannSumResult
 *   U3  — 3D sidebar controls (domain limits, mark point) fully restored
 *   U6  — onRegionData wired to setRegionVertices
 *   V3  — areaValue + onAreaValue wired to GraphCanvas2D
 *   M2  — Mobile resize uses dual setTimeout (150ms + 400ms) for reliability
 *   F11 — Theme read from useTheme() state, not from DOM inline
 */
import React, { useState, useCallback, useEffect } from 'react'
import EquationInput from './components/EquationInput/EquationInput'
import GraphCanvas2D from './components/GraphCanvas2D/GraphCanvas2D'
import GraphCanvas3D from './components/GraphCanvas3D/GraphCanvas3D'
import SliderSidebar from './components/SliderSidebar/SliderSidebar'
import ParameterDisplay from './components/ParameterDisplay/ParameterDisplay'
import { detectFreeParams } from './lib/freeParams'
import StepPanel from './components/StepPanel/StepPanel'
import RiemannControls from './components/RiemannControls/RiemannControls'
import RegionToggle from './components/RegionToggle/RegionToggle'
import LoadingBar from './components/shared/LoadingBar'
import { solve as callSolve, riemann as callRiemann } from './lib/apiClient'
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
  // U1: surface Riemann results to parent
  const [_riemannSumResult, setRiemannSumResult] = useState(null)
  const [showArea, setShowArea]     = useState(false)
  // V3: area numeric value
  const [areaValue, setAreaValue]   = useState(null)
  const [regionVertices, setRegionVertices] = useState(null)
  const [activeExamplePatch, setActiveExamplePatch] = useState(null)
  const [mobilePanel, setMobilePanel] = useState('input')

  // Free parameter slider values keyed by param name
  const [paramValues, setParamValues] = useState({})

  // Viewport range sliders (SliderSidebar → GraphCanvas2D)
  const [xRange, setXRange] = useState([-10, 10])
  const [yRange, setYRange] = useState([-10, 10])

  // 3D Riemann bars
  const [showRiemannBars3D, setShowRiemannBars3D] = useState(false)
  const [riemannBars3DRects, setRiemannBars3DRects] = useState([])
  const [riemannBars3DError, setRiemannBars3DError] = useState(null)

  // B1: dynamic Riemann bounds (replaces hardcoded [0,4])
  const [riemannBoundsLo, setRiemannBoundsLo] = useState('0')
  const [riemannBoundsHi, setRiemannBoundsHi] = useState('4')

  // 2D graph parameter controls
  const [showTangent,    setShowTangent]    = useState(true)
  const [showDerivative, setShowDerivative] = useState(false)
  const [showGrid,       setShowGrid]       = useState(true)
  const [showVolumeRev,  setShowVolumeRev]  = useState(false)
  const [markedX,        setMarkedX]        = useState(null)
  const [markedXInput,   setMarkedXInput]   = useState('')
  const [xRangeMin,      setXRangeMin]      = useState(null)
  const [xRangeMax,      setXRangeMax]      = useState(null)
  const [xRangeMinInput, setXRangeMinInput] = useState('-6')
  const [xRangeMaxInput, setXRangeMaxInput] = useState('6')

  // 3D graph parameter & limit controls (U3: fully restored)
  const [xMin3D,         setXMin3D]         = useState(-4)
  const [xMax3D,         setXMax3D]         = useState(4)
  const [yMin3D,         setYMin3D]         = useState(-4)
  const [yMax3D,         setYMax3D]         = useState(4)
  const [zMin3D,         setZMin3D]         = useState(null)
  const [zMax3D,         setZMax3D]         = useState(null)
  const [xMin3DInput,    setXMin3DInput]    = useState('-4')
  const [xMax3DInput,    setXMax3DInput]    = useState('4')
  const [yMin3DInput,    setYMin3DInput]    = useState('-4')
  const [yMax3DInput,    setYMax3DInput]    = useState('4')
  const [zMin3DInput,    setZMin3DInput]    = useState('')
  const [zMax3DInput,    setZMax3DInput]    = useState('')
  const [showVolume3D,   setShowVolume3D]   = useState(true)
  const [showGrid3D,     setShowGrid3D]     = useState(true)
  const [showWireframe3D,setShowWireframe3D]= useState(true)
  const [showTangent3D,  setShowTangent3D]  = useState(true)
  const [showDerivative3D,setShowDerivative3D]= useState(false)
  const [markedX3D,      setMarkedX3D]      = useState(null)
  const [markedY3D,      setMarkedY3D]      = useState(null)
  const [markedX3DInput, setMarkedX3DInput] = useState('')
  const [markedY3DInput, setMarkedY3DInput] = useState('')
  const [n3D,            setN3D]            = useState(30)
  const [samplePoint3D,  setSamplePoint3D]  = useState('midpoint')

  const activeEq = equations.find(e => e.id === activeId) ?? equations[0]
  const activeCurveIndex = equations.findIndex(e => e.id === activeId)

  useEffect(() => { setActiveExamplePatch(null) }, [activeId])

  // Sync free parameter sliders whenever the active expression changes
  useEffect(() => {
    const wrt = activeExamplePatch?.wrt ?? 'x'
    const detected = detectFreeParams(activeEq.expr ?? '', wrt)
    setParamValues(prev => {
      const next = {}
      detected.forEach(name => {
        next[name] = name in prev ? prev[name] : 1
      })
      return next
    })
  }, [activeEq?.expr, activeExamplePatch?.wrt])

  // B9: Clear Riemann state and area value when the active equation changes
  useEffect(() => {
    setRiemannRects([])
    setRiemannSumResult(null)
    setAreaValue(null)
  }, [activeId])

  // M2: Mobile tab switch resize — dual timer ensures canvas is mounted
  useEffect(() => {
    if (mobilePanel === 'graph') {
      const t1 = setTimeout(() => window.dispatchEvent(new Event('resize')), 150)
      const t2 = setTimeout(() => window.dispatchEvent(new Event('resize')), 400)
      return () => { clearTimeout(t1); clearTimeout(t2) }
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

  // ── 3D Riemann bars request ───────────────────────────────────────
  const handleRiemann3DRequest = useCallback(async () => {
    setRiemannBars3DError(null)
    try {
      const lo = parseFloat(riemannBoundsLo)
      const hi = parseFloat(riemannBoundsHi)
      const bounds = [isFinite(lo) ? lo : 0, isFinite(hi) ? hi : 4]
      const data = await callRiemann({
        expr: activeEq.expr,
        bounds,
        sub_intervals: 10,
        sample_point: 'midpoint',
      })
      setRiemannBars3DRects(data.rectangles ?? [])
    } catch (e) {
      setRiemannBars3DError(e.message || 'Riemann request failed')
    }
  }, [activeEq.expr, riemannBoundsLo, riemannBoundsHi])

  const loadExample = (example) => {    updateEquation(activeId, { expr: example.expr, result: null, error: null, steps: [] })
    setRiemannRects([])
    setRiemannSumResult(null)
    setActiveExamplePatch({
      operation: example.operation ?? null,
      wrt:       example.wrt       ?? null,
      bounds:    example.bounds    ?? null,
    })
  }

  // B1: parse riemann bounds for passing to component
  const riemannBounds = (() => {
    const lo = parseFloat(riemannBoundsLo)
    const hi = parseFloat(riemannBoundsHi)
    return [isFinite(lo) ? lo : 0, isFinite(hi) ? hi : 4]
  })()

  const anyLoading = equations.some(e => e.loading)
  const graphEquations = equations.map(e => ({ id: e.id, expr: e.expr }))
  // F11: read colors from theme state, not from DOM attribute inline
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
          </div>

          <div className={styles.bottomRowBody}>

            {/* ── Left sidebar: 2D curve list + controls ── */}
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

                  {[
                    { label: 'Area shading', value: showArea, set: setShowArea },
                    { label: 'Tangent line', value: showTangent, set: setShowTangent },
                    { label: 'Derivative f′(x)', value: showDerivative, set: setShowDerivative },
                    { label: 'Grid', value: showGrid, set: setShowGrid },
                    { label: 'Volume of Revolution', value: showVolumeRev, set: setShowVolumeRev },
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
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 70 }}
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

                {/* B1: Riemann bounds inputs */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Riemann Bounds</span>
                  <div style={{ padding: '4px', display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input
                      type="number"
                      className={styles.curveExprInput}
                      style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                      value={riemannBoundsLo}
                      onChange={e => setRiemannBoundsLo(e.target.value)}
                      placeholder="0"
                      aria-label="Riemann lower bound"
                    />
                    <span className={styles.areaLabel}>to</span>
                    <input
                      type="number"
                      className={styles.curveExprInput}
                      style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                      value={riemannBoundsHi}
                      onChange={e => setRiemannBoundsHi(e.target.value)}
                      placeholder="4"
                      aria-label="Riemann upper bound"
                    />
                  </div>
                </div>

                {/* U1: Riemann sum — wired with onSumResult */}
                <RiemannControls
                  exprStr={activeEq.expr}
                  bounds={riemannBounds}
                  onRectangles={setRiemannRects}
                  onSumResult={setRiemannSumResult}
                />

                {/* U6: Region / integration order — wired with onRegionData */}
                <RegionToggle
                  curves={graphEquations}
                  onRegionData={(data) => setRegionVertices(data.region_vertices ?? null)}
                />

              </aside>
            )}

            {/* ── Left sidebar: 3D controls & limit settings (U3: fully restored) ── */}
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

                {/* 3D Graph Controls */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Graph Controls</span>
                  {[
                    { label: 'Tangent plane', value: showTangent3D, set: setShowTangent3D },
                    { label: 'Derivative slices', value: showDerivative3D, set: setShowDerivative3D },
                    { label: '3D Grid', value: showGrid3D, set: setShowGrid3D },
                    { label: 'Surface Wireframe', value: showWireframe3D, set: setShowWireframe3D },
                    { label: 'Volume under surface', value: showVolume3D, set: setShowVolume3D },
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

                {/* 3D Axis Limits */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>3D Axis Limits</span>

                  {/* X domain */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={styles.areaLabel}>X range</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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

                  {/* Y domain */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <span className={styles.areaLabel}>Y range</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
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

                  {/* Z clamp limits */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <span className={styles.areaLabel}>Z limits (optional)</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                        value={zMin3DInput}
                        onChange={e => {
                          setZMin3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setZMin3D(isFinite(v) ? v : null)
                        }}
                        placeholder="−∞"
                        aria-label="3D Z minimum clamp"
                      />
                      <span className={styles.areaLabel}>to</span>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                        value={zMax3DInput}
                        onChange={e => {
                          setZMax3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setZMax3D(isFinite(v) ? v : null)
                        }}
                        placeholder="+∞"
                        aria-label="3D Z maximum clamp"
                      />
                    </div>
                  </div>

                  {/* Mark point (x0, y0) */}
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                    <span className={styles.areaLabel}>Mark point (x, y)</span>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                        value={markedX3DInput}
                        onChange={e => {
                          setMarkedX3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setMarkedX3D(isFinite(v) ? v : null)
                        }}
                        placeholder="x"
                        aria-label="3D Mark X"
                      />
                      <input
                        type="number"
                        className={styles.curveExprInput}
                        style={{ border: '1px solid var(--border-color)', padding: '2px 4px', width: 52 }}
                        value={markedY3DInput}
                        onChange={e => {
                          setMarkedY3DInput(e.target.value)
                          const v = parseFloat(e.target.value)
                          setMarkedY3D(isFinite(v) ? v : null)
                        }}
                        placeholder="y"
                        aria-label="3D Mark Y"
                      />
                      {(markedX3D != null || markedY3D != null) && (
                        <button
                          className={styles.curveRemoveBtn}
                          onClick={() => {
                            setMarkedX3D(null); setMarkedX3DInput('')
                            setMarkedY3D(null); setMarkedY3DInput('')
                          }}
                          title="Clear mark"
                        >×</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* V8: Renamed from "Riemann Grid Resolution" to "Surface Resolution" */}
                <div className={styles.curveListSection}>
                  <span className={styles.sidebarSectionLabel}>Surface Resolution (n)</span>
                  <div style={{ padding: '4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className={styles.areaLabel}>n = {n3D} segments</span>
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="60"
                      step="2"
                      value={n3D}
                      onChange={e => setN3D(parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                      aria-label="3D surface segments n"
                    />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['left', 'midpoint', 'right'].map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSamplePoint3D(s)}
                          className={styles.numericPill}
                          style={{
                            flex: 1,
                            padding: '3px 4px',
                            textAlign: 'center',
                            cursor: 'pointer',
                            background: samplePoint3D === s ? 'var(--accent)' : 'var(--surface-sunken)',
                            color: samplePoint3D === s ? '#fff' : 'var(--content-secondary)',
                            fontWeight: samplePoint3D === s ? 700 : 400,
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              </aside>
            )}

            {/* ── SliderSidebar: viewport + free-param sliders (2D only) ── */}
            {graphMode === '2d' && (
              <SliderSidebar
                xRange={xRange}
                yRange={yRange}
                onXRangeChange={setXRange}
                onYRangeChange={setYRange}
                freeParams={Object.entries(paramValues).map(([name, value]) => ({ name, value }))}
                onParamChange={(name, value) => setParamValues(prev => ({ ...prev, [name]: value }))}
              />
            )}

            {/* ── Main graph canvas ── */}
            <div className={styles.graphMain} style={{ position: 'relative' }}>
              {/* ParameterDisplay overlay — 2D only */}
              {graphMode === '2d' && (
                <ParameterDisplay
                  xRange={xRange}
                  yRange={yRange}
                  paramValues={paramValues}
                />
              )}
              <div style={{ display: graphMode === '2d' ? 'contents' : 'none' }}>
                <GraphCanvas2D
                    equations={graphEquations}
                    activeCurveIndex={activeCurveIndex >= 0 ? activeCurveIndex : 0}
                    overlayRectangles={riemannRects}
                    showArea={showArea}
                    showVolumeRev={showVolumeRev}
                    regionVertices={regionVertices}
                    showTangent={showTangent}
                    showDerivative={showDerivative}
                    showGrid={showGrid}
                    markedX={markedX}
                    xRangeMin={xRangeMin}
                    xRangeMax={xRangeMax}
                    areaValue={areaValue}
                    onAreaValue={setAreaValue}
                    xRange={xRange}
                    yRange={yRange}
                    extraVars={paramValues}
                  />

                  {activeEq.numericSample?.length > 0 && (
                    <section className={styles.samplePointPanel} aria-label="Verified sample points">
                      <div className={styles.samplePointHeader}>
                        <span>Sample points</span>
                        <span>{activeEq.expr}</span>
                      </div>
                      <div className={styles.samplePointGrid}>
                        {activeEq.numericSample.slice(0, 7).map((pt, i) => {
                            const wrtKey = Object.keys(pt).find(k => k !== 'y') ?? 'x'
                            return (
                              <div key={i} className={styles.samplePointCard}>
                                <span className={styles.samplePointLabel}>{wrtKey}</span>
                                <span className={styles.samplePointValue}>{pt[wrtKey]}</span>
                                <span className={styles.samplePointLabel}>y</span>
                                <span className={styles.samplePointValue}>{pt.y}</span>
                              </div>
                            )
                          })}
                      </div>
                    </section>
                  )}
              </div>
              <div style={{ display: graphMode === '3d' ? 'contents' : 'none' }}>
                <GraphCanvas3D
                  exprStr={activeEq.expr || 'sin(x) * cos(y)'}
                  xMin={xMin3D}
                  xMax={xMax3D}
                  yMin={yMin3D}
                  yMax={yMax3D}
                  zMinLimit={zMin3D}
                  zMaxLimit={zMax3D}
                  n={n3D}
                  samplePoint={samplePoint3D}
                  extraVars={paramValues}
                  showVolume={showVolume3D}
                  showGrid={showGrid3D}
                  showWireframe={showWireframe3D}
                  showTangent={showTangent3D}
                  showDerivative={showDerivative3D}
                  markedX={markedX3D}
                  markedY={markedY3D}
                  riemannRects={riemannBars3DRects}
                  showRiemannBars={showRiemannBars3D}
                  riemannError={riemannBars3DError}
                  onToggleRiemannBars={(val) => {
                    setShowRiemannBars3D(val)
                    if (!val) setRiemannBars3DRects([])
                  }}
                  onRequestRiemann={handleRiemann3DRequest}
                />
              </div>
            </div>

          </div>
        </div>

      </main>
    </div>
  )
}
