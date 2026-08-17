/**
 * GraphCanvas2D — multi-equation 2D renderer.
 *
 * Features:
 * - Multiple coloured curves with individual labels
 * - Slope tangent line follows the hover point on each curve
 * - Hover tooltip shows (x, y, slope) values
 * - Shaded area between two curves when both are present
 * - Axis tick labels
 * - Pan (drag) + zoom (scroll/pinch) + reset (double-click)
 * - Expand to fullscreen toggle
 * - Theme-aware colours via MutationObserver
 *
 * Architecture: in-place buffer mutation — geometry never rebuilt per frame.
 * See ARCHITECTURE.md §1.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { sample1D } from '../../lib/mathEval'
import styles from './GraphCanvas2D.module.css'

const N_POINTS  = 400
const TICK_STEP = 1   // world units between axis tick labels

// Palette for up to 6 curves
const CURVE_COLORS_LIGHT = [0x1a1917, 0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x7c3aed]
const CURVE_COLORS_DARK  = [0xe8e6e1, 0x60a5fa, 0xf87171, 0x4ade80, 0xfbbf24, 0xa78bfa]

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}
function bgColor()   { return isDark() ? 0x111110 : 0xfafaf9 }
function axColor()   { return isDark() ? 0x57534e : 0xb8b5b0 }
function gridColor() { return isDark() ? 0x1e1d1b : 0xeeecea }
function curveColors() { return isDark() ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT }
function areaColor() { return isDark() ? 0x60a5fa : 0x2563eb }

// ── HTML tick overlay (rendered outside Three.js canvas) ─────────────────
function TickLabels({ viewBounds, canvasW, canvasH }) {
  if (!viewBounds) return null
  const [xL, xR, yB, yT] = viewBounds
  const xTicks = []; const yTicks = []
  const xStep = computeNiceStep(xR - xL)
  const yStep = computeNiceStep(yT - yB)

  for (let t = Math.ceil(xL / xStep) * xStep; t <= xR; t += xStep) {
    if (Math.abs(t) < xStep * 0.01) continue // skip 0 label on axis
    const px = ((t - xL) / (xR - xL)) * canvasW
    xTicks.push({ val: t, px })
  }
  for (let t = Math.ceil(yB / yStep) * yStep; t <= yT; t += yStep) {
    if (Math.abs(t) < yStep * 0.01) continue
    const py = canvasH - ((t - yB) / (yT - yB)) * canvasH
    yTicks.push({ val: t, py })
  }

  return (
    <div className={styles.tickLayer} style={{ width: canvasW, height: canvasH }}>
      {xTicks.map(({ val, px }) => (
        <span key={val} className={styles.tickX} style={{ left: px }}>
          {fmtTick(val)}
        </span>
      ))}
      {yTicks.map(({ val, py }) => (
        <span key={val} className={styles.tickY} style={{ top: py }}>
          {fmtTick(val)}
        </span>
      ))}
    </div>
  )
}

function fmtTick(n) {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}
function computeNiceStep(range) {
  const raw = range / 8
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const frac = raw / mag
  if (frac < 1.5) return mag
  if (frac < 3.5) return 2 * mag
  if (frac < 7)   return 5 * mag
  return 10 * mag
}

// ── Area shading between two curves ──────────────────────────────────────
function buildAreaMesh(expr1, expr2, xL, xR, colors) {
  const N = 200
  const verts = []
  const step = (xR - xL) / N
  for (let i = 0; i <= N; i++) {
    const x = xL + i * step
    const pts1 = sample1D(expr1, x, x, 1)
    const pts2 = sample1D(expr2, x, x, 1)
    const y1 = pts1[0]?.y ?? 0
    const y2 = pts2[0]?.y ?? 0
    verts.push(x, Math.max(y1, y2), 0.02, x, Math.min(y1, y2), 0.02)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  const indices = []
  for (let i = 0; i < N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    indices.push(a, b, c, b, d, c)
  }
  geo.setIndex(indices)
  const mat = new THREE.MeshBasicMaterial({
    color: areaColor(), transparent: true, opacity: 0.15, side: THREE.DoubleSide,
  })
  return new THREE.Mesh(geo, mat)
}

export default function GraphCanvas2D({
  equations = [],          // [{ id, expr, color? }]  — passed from parent
  overlayRectangles = [],
  showArea = false,        // shade area between first two curves
}) {
  const mountRef       = useRef(null)
  const sceneRef       = useRef(null)
  const cameraRef      = useRef(null)
  const rendererRef    = useRef(null)
  const curveLinesRef  = useRef([])   // [{line, posAttr}] per equation
  const tangentRef     = useRef(null)
  const slopePointRef  = useRef(null)
  const rectMeshRef    = useRef([])
  const areaMeshRef    = useRef(null)
  const axisRefs       = useRef([])
  const gridRefs       = useRef([])
  const animRef        = useRef(null)

  const viewRef        = useRef({ panX: 0, panY: 0, scale: 1 })
  const isDragging     = useRef(false)
  const lastPointer    = useRef({ x: 0, y: 0 })
  const lastPinch      = useRef(null)
  const xMinProp       = -6
  const xMaxProp       = 6

  const [hoverInfo,   setHoverInfo]   = useState(null)  // {x, y, slope, curveIdx}
  const [isExpanded,  setIsExpanded]  = useState(false)
  const [viewBounds,  setViewBounds]  = useState(null)
  const [canvasSize,  setCanvasSize]  = useState({ w: 600, h: 260 })

  // ── view helpers ─────────────────────────────────────────────────────
  const getViewBounds = useCallback(() => {
    const mount = mountRef.current
    if (!mount) return [xMinProp, xMaxProp, -4, 4]
    const W = mount.clientWidth || 600
    const H = mount.clientHeight || 260
    const aspect = W / H
    const { panX, panY, scale } = viewRef.current
    const halfW = ((xMaxProp - xMinProp) / 2) / scale
    const halfH = halfW / aspect
    const cx = (xMinProp + xMaxProp) / 2 + panX
    return [cx - halfW, cx + halfW, panY - halfH, panY + halfH]
  }, [])

  const rebuildCamera = useCallback(() => {
    const cam = cameraRef.current; if (!cam) return
    const [l, r, b, t] = getViewBounds()
    cam.left = l; cam.right = r; cam.bottom = b; cam.top = t
    cam.updateProjectionMatrix()
    setViewBounds([l, r, b, t])
  }, [getViewBounds])

  const resampleAll = useCallback(() => {
    const [xL, xR] = getViewBounds()
    curveLinesRef.current.forEach(({ posAttr, expr }, idx) => {
      if (!posAttr || !expr) return
      const pts = sample1D(expr, xL, xR, N_POINTS)
      const arr = posAttr.array
      const cnt = Math.min(pts.length, N_POINTS)
      for (let i = 0; i < cnt; i++) {
        arr[i * 3] = pts[i].x; arr[i * 3 + 1] = pts[i].y; arr[i * 3 + 2] = 0
      }
      for (let i = cnt; i < N_POINTS; i++) arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0
      posAttr.needsUpdate = true
      curveLinesRef.current[idx].line.geometry.setDrawRange(0, cnt)
    })
  }, [getViewBounds])

  const buildStaticGeo = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return
    axisRefs.current.forEach(o => scene.remove(o))
    gridRefs.current.forEach(o => scene.remove(o))
    axisRefs.current = []; gridRefs.current = []
    const [xL, xR, yB, yT] = getViewBounds()
    const axMat  = new THREE.LineBasicMaterial({ color: axColor() })
    const grdMat = new THREE.LineBasicMaterial({ color: gridColor() })
    for (const [p1, p2] of [[[xL,0,0],[xR,0,0]],[[0,yB,0],[0,yT,0]]]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p1), new THREE.Vector3(...p2)])
      const l = new THREE.Line(g, axMat); scene.add(l); axisRefs.current.push(l)
    }
    const xStep = computeNiceStep(xR - xL)
    const yStep = computeNiceStep(yT - yB)
    for (let gx = Math.ceil(xL / xStep) * xStep; gx <= xR; gx += xStep) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(gx,yB,0),new THREE.Vector3(gx,yT,0)])
      const l = new THREE.Line(g, grdMat); scene.add(l); gridRefs.current.push(l)
    }
    for (let gy = Math.ceil(yB / yStep) * yStep; gy <= yT; gy += yStep) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(xL,gy,0),new THREE.Vector3(xR,gy,0)])
      const l = new THREE.Line(g, grdMat); scene.add(l); gridRefs.current.push(l)
    }
  }, [getViewBounds])

  // ── Scene init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    const W = mount.clientWidth || 600; const H = mount.clientHeight || 260
    const aspect = W / H; const halfW = (xMaxProp - xMinProp) / 2; const halfH = halfW / aspect

    const scene = new THREE.Scene(); scene.background = new THREE.Color(bgColor()); sceneRef.current = scene
    const camera = new THREE.OrthographicCamera(xMinProp, xMaxProp, halfH, -halfH, 0.1, 1000)
    camera.position.z = 10; cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(W, H)
    mount.appendChild(renderer.domElement); rendererRef.current = renderer

    buildStaticGeo()

    // Tangent line (hidden until hover)
    const tlGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20,0,0), new THREE.Vector3(20,0,0)])
    const tlMat = new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 0.15, gapSize: 0.1, linewidth: 1 })
    const tl = new THREE.Line(tlGeo, tlMat); tl.computeLineDistances(); tl.visible = false
    scene.add(tl); tangentRef.current = tl

    // Slope point dot
    const spGeo = new THREE.CircleGeometry(0.07, 16)
    const spMat = new THREE.MeshBasicMaterial({ color: 0x2563eb })
    const sp = new THREE.Mesh(spGeo, spMat); sp.visible = false; sp.renderOrder = 2
    scene.add(sp); slopePointRef.current = sp

    // ── Input handlers ────────────────────────────────────────────────
    const el = renderer.domElement

    function getWorld(cx, cy) {
      const rect = el.getBoundingClientRect()
      const [xL, xR, yB, yT] = getViewBounds()
      return {
        x: xL + ((cx - rect.left) / rect.width)  * (xR - xL),
        y: yT - ((cy - rect.top)  / rect.height) * (yT - yB),
      }
    }

    el.addEventListener('mousedown', e => { isDragging.current = true; lastPointer.current = { x: e.clientX, y: e.clientY }; el.style.cursor = 'grabbing' })
    window.addEventListener('mouseup', () => { isDragging.current = false; el.style.cursor = 'crosshair' })

    el.addEventListener('mousemove', e => {
      const rect = el.getBoundingClientRect()
      if (isDragging.current) {
        const dx = e.clientX - lastPointer.current.x; const dy = e.clientY - lastPointer.current.y
        lastPointer.current = { x: e.clientX, y: e.clientY }
        const [xL, xR, yB, yT] = getViewBounds()
        viewRef.current.panX -= (dx / rect.width)  * (xR - xL)
        viewRef.current.panY += (dy / rect.height) * (yT - yB)
        rebuildCamera(); resampleAll(); buildStaticGeo()
        if (tl) tl.visible = false
        if (sp) sp.visible = false
        setHoverInfo(null)
        return
      }

      // Hover: find nearest curve y-value and slope
      const w = getWorld(e.clientX, e.clientY)
      const curves = curveLinesRef.current
      if (curves.length === 0) { setHoverInfo(null); return }

      // Use first curve for hover snap
      const curveExpr = curves[0]?.expr
      if (!curveExpr) { setHoverInfo(null); return }

      const pts = sample1D(curveExpr, w.x - 0.0001, w.x + 0.0001, 3)
      const midPt = pts[1] ?? pts[0]
      if (!midPt) { setHoverInfo(null); return }

      // Slope via finite difference
      const dx = 0.0001
      const p1s = sample1D(curveExpr, w.x - dx, w.x - dx, 1)
      const p2s = sample1D(curveExpr, w.x + dx, w.x + dx, 1)
      const slope = (p1s[0] && p2s[0]) ? (p2s[0].y - p1s[0].y) / (2 * dx) : 0

      // Position tangent line
      if (tl) {
        const extend = (getViewBounds()[1] - getViewBounds()[0]) / 4
        const x0 = midPt.x - extend; const x1 = midPt.x + extend
        const y0 = midPt.y + slope * (x0 - midPt.x)
        const y1 = midPt.y + slope * (x1 - midPt.x)
        const tlPositions = tl.geometry.getAttribute('position')
        tlPositions.setXYZ(0, x0, y0, 0.03); tlPositions.setXYZ(1, x1, y1, 0.03)
        tlPositions.needsUpdate = true; tl.computeLineDistances(); tl.visible = true
      }
      if (sp) { sp.position.set(midPt.x, midPt.y, 0.04); sp.visible = true }

      setHoverInfo({ x: midPt.x.toFixed(4), y: midPt.y.toFixed(4), slope: slope.toFixed(4) })
    })

    el.addEventListener('mouseleave', () => {
      if (tl) tl.visible = false
      if (sp) sp.visible = false
      setHoverInfo(null)
    })
    el.addEventListener('wheel', e => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      viewRef.current.scale = Math.max(0.02, Math.min(100, viewRef.current.scale * factor))
      rebuildCamera(); resampleAll(); buildStaticGeo()
    }, { passive: false })
    el.addEventListener('dblclick', () => {
      viewRef.current = { panX: 0, panY: 0, scale: 1 }
      rebuildCamera(); resampleAll(); buildStaticGeo()
    })

    // Touch
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) { isDragging.current = true; lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; lastPinch.current = null }
      else if (e.touches.length === 2) { isDragging.current = false; lastPinch.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) }
    }, { passive: true })
    el.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && isDragging.current) {
        const rect = el.getBoundingClientRect()
        const dx = e.touches[0].clientX - lastPointer.current.x; const dy = e.touches[0].clientY - lastPointer.current.y
        lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        const [xL, xR, yB, yT] = getViewBounds()
        viewRef.current.panX -= (dx / rect.width) * (xR - xL)
        viewRef.current.panY += (dy / rect.height) * (yT - yB)
        rebuildCamera(); resampleAll(); buildStaticGeo()
      } else if (e.touches.length === 2 && lastPinch.current !== null) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        viewRef.current.scale = Math.max(0.02, Math.min(100, viewRef.current.scale * (d / lastPinch.current)))
        lastPinch.current = d; rebuildCamera(); resampleAll(); buildStaticGeo()
      }
    }, { passive: true })
    el.addEventListener('touchend', () => { isDragging.current = false; lastPinch.current = null })

    const animate = () => { animRef.current = requestAnimationFrame(animate); renderer.render(scene, camera) }
    animate()

    const ro = new ResizeObserver(() => {
      const nW = mount.clientWidth; const nH = mount.clientHeight
      renderer.setSize(nW, nH); rebuildCamera()
      setCanvasSize({ w: nW, h: nH })
    })
    ro.observe(mount)
    setViewBounds(getViewBounds()); setCanvasSize({ w: W, h: H })

    return () => {
      cancelAnimationFrame(animRef.current); ro.disconnect(); renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Theme sync
  useEffect(() => {
    const apply = () => {
      const scene = sceneRef.current; if (!scene) return
      scene.background = new THREE.Color(bgColor())
      const cc = curveColors()
      curveLinesRef.current.forEach(({ line }, i) => { if (line) line.material.color.set(cc[i % cc.length]) })
      axisRefs.current.forEach(l => l.material.color.set(axColor()))
      gridRefs.current.forEach(l => l.material.color.set(gridColor()))
      if (areaMeshRef.current) areaMeshRef.current.material.color.set(areaColor())
    }
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // Sync equations → Three.js lines
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    const cc = curveColors()

    // Add new lines, remove stale ones
    const existingCount = curveLinesRef.current.length

    // Remove excess
    while (curveLinesRef.current.length > equations.length) {
      const { line } = curveLinesRef.current.pop()
      scene.remove(line)
    }

    // Update / add
    equations.forEach((eq, i) => {
      if (i < existingCount && curveLinesRef.current[i]) {
        // Update colour if changed
        curveLinesRef.current[i].line.material.color.set(cc[i % cc.length])
        curveLinesRef.current[i].expr = eq.expr
      } else {
        // Create new line
        const positions = new Float32Array(N_POINTS * 3)
        const geo = new THREE.BufferGeometry()
        const posAttr = new THREE.BufferAttribute(positions, 3)
        posAttr.setUsage(THREE.DynamicDrawUsage)
        geo.setAttribute('position', posAttr)
        const mat = new THREE.LineBasicMaterial({ color: cc[i % cc.length], linewidth: 2 })
        const line = new THREE.Line(geo, mat)
        scene.add(line)
        curveLinesRef.current[i] = { line, posAttr, expr: eq.expr }
      }
    })

    resampleAll()

    // Area mesh
    if (areaMeshRef.current) { scene.remove(areaMeshRef.current); areaMeshRef.current = null }
    if (showArea && equations.length >= 2) {
      const [xL, xR] = getViewBounds()
      const am = buildAreaMesh(equations[0].expr, equations[1].expr, xL, xR, curveColors())
      scene.add(am); areaMeshRef.current = am
    }
  }, [equations, showArea, resampleAll, getViewBounds])

  // Riemann rectangles
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    rectMeshRef.current.forEach(m => scene.remove(m)); rectMeshRef.current = []
    if (!overlayRectangles.length) return
    overlayRectangles.forEach(({ x0, x1, height }) => {
      const w = x1 - x0; const h = Math.abs(height)
      const geo = new THREE.PlaneGeometry(w, h)
      const mat = new THREE.MeshBasicMaterial({ color: areaColor(), transparent: true, opacity: 0.12, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(geo, mat); mesh.position.set(x0 + w / 2, height / 2, 0.05)
      scene.add(mesh)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: areaColor() }))
      edges.position.copy(mesh.position); scene.add(edges)
      rectMeshRef.current.push(mesh, edges)
    })
  }, [overlayRectangles])

  const resetView = () => {
    viewRef.current = { panX: 0, panY: 0, scale: 1 }
    rebuildCamera(); resampleAll(); buildStaticGeo()
  }

  return (
    <div className={`${styles.wrapper} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.toolbar}>
        <span className={styles.label}>Graph</span>
        {/* Curve legend */}
        <div className={styles.legend}>
          {equations.map((eq, i) => {
            const cc = isDark() ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT
            const hex = `#${(cc[i % cc.length]).toString(16).padStart(6, '0')}`
            return (
              <span key={eq.id} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: hex }} />
                <span className={styles.legendExpr}>{eq.expr || '—'}</span>
              </span>
            )
          })}
        </div>
        <div className={styles.toolbarRight}>
          {hoverInfo && (
            <span className={styles.coordBadge}>
              x={hoverInfo.x} y={hoverInfo.y} <span className={styles.slopeBadge}>m={hoverInfo.slope}</span>
            </span>
          )}
          <button className={styles.toolBtn} onClick={resetView} title="Reset view">⌂</button>
          <button className={styles.toolBtn} onClick={() => setIsExpanded(e => !e)} title={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '⊡' : '⊞'}
          </button>
        </div>
      </div>

      <div className={styles.canvasWrap}>
        <div className={styles.canvas} ref={mountRef} />
        <TickLabels viewBounds={viewBounds} canvasW={canvasSize.w} canvasH={canvasSize.h} />
      </div>

      <p className={styles.hint}>Drag to pan · scroll to zoom · double-click to reset · hover for coordinates</p>
    </div>
  )
}
