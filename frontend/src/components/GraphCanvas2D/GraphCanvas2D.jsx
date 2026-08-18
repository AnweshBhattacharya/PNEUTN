/**
 * GraphCanvas2D — multi-equation 2D renderer.
 *
 * Features (Desmos-inspired):
 * - Multiple coloured curves (up to 6) — already supported via equations[]
 * - Crosshair cursor that snaps to the nearest curve
 * - Dashed tangent line with angle badge showing slope angle in degrees
 * - Axis-projection lines from hover point to X and Y axes (highlighted)
 * - Hover tooltip shows (x, y, slope, angle)
 * - Area under curve shading (single curve to x-axis, or between two curves)
 * - Smooth animated curve draw-in on first render
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

const N_POINTS = 600
const AREA_N   = 300   // compile-time constant — keeps index array stable

// Palette for up to 6 curves
const CURVE_COLORS_LIGHT = [0x1a1917, 0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x7c3aed]
const CURVE_COLORS_DARK  = [0xe8e6e1, 0x60a5fa, 0xf87171, 0x4ade80, 0xfbbf24, 0xa78bfa]

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark' }
function bgColor()    { return isDark() ? 0x111110 : 0xfafaf9 }
function axColor()    { return isDark() ? 0x57534e : 0xa8a29e }
function gridColor()  { return isDark() ? 0x1e1d1b : 0xeeecea }
function curveColors(){ return isDark() ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT }
function areaColor()  { return isDark() ? 0x60a5fa : 0x2563eb }
function crossColor() { return isDark() ? 0x57534e : 0xb8b5b0 }

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

// ── Tick overlay ──────────────────────────────────────────────────────────
function TickLabels({ viewBounds, canvasW, canvasH, hoverInfo }) {
  if (!viewBounds) return null
  const [xL, xR, yB, yT] = viewBounds

  const xStep = computeNiceStep(xR - xL)
  const yStep = computeNiceStep(yT - yB)

  const xTicks = []
  const yTicks = []

  for (let t = Math.ceil(xL / xStep) * xStep; t <= xR + xStep * 0.01; t += xStep) {
    const v = Math.round(t / xStep) * xStep
    if (Math.abs(v) < xStep * 0.01) continue
    const px = ((v - xL) / (xR - xL)) * canvasW
    if (px < 8 || px > canvasW - 8) continue
    xTicks.push({ val: v, px })
  }
  for (let t = Math.ceil(yB / yStep) * yStep; t <= yT + yStep * 0.01; t += yStep) {
    const v = Math.round(t / yStep) * yStep
    if (Math.abs(v) < yStep * 0.01) continue
    const py = canvasH - ((v - yB) / (yT - yB)) * canvasH
    if (py < 8 || py > canvasH - 8) continue
    yTicks.push({ val: v, py })
  }

  const hx = hoverInfo ? ((hoverInfo.wx - xL) / (xR - xL)) * canvasW : null
  const hy = hoverInfo ? canvasH - ((hoverInfo.wy - yB) / (yT - yB)) * canvasH : null

  return (
    <div className={styles.tickLayer} style={{ width: canvasW, height: canvasH }}>
      {hx != null && (
        <>
          <div className={styles.hoverLineX} style={{ left: hx }} />
          <div className={styles.hoverLineY} style={{ top: hy }} />
          <span className={styles.hoverTickX} style={{ left: hx }}>
            {parseFloat(hoverInfo.wx.toFixed(4))}
          </span>
          <span className={styles.hoverTickY} style={{ top: hy }}>
            {parseFloat(hoverInfo.wy.toFixed(4))}
          </span>
          <div className={styles.hoverTooltip} style={{ left: hx, top: hy }}>
            <span className={styles.tooltipLabel}>m = </span>
            <span className={styles.slopeBadge}>{hoverInfo.slope}</span>
            <span className={styles.tooltipLabel}>θ = </span>
            <span className={styles.angleBadge}>{hoverInfo.angle}°</span>
          </div>
        </>
      )}
      {xTicks.map(({ val, px }) => (
        <span key={val} className={styles.tickX} style={{ left: px }}>{fmtTick(val)}</span>
      ))}
      {yTicks.map(({ val, py }) => (
        <span key={val} className={styles.tickY} style={{ top: py }}>{fmtTick(val)}</span>
      ))}
    </div>
  )
}

// ── Area shading helpers — in-place mutation (ARCHITECTURE.md §1) ─────────

function _computeAreaVerts(expr1, expr2OrNull, xL, xR) {
  // Returns a flat Float32Array: 2 vertices per column × (AREA_N+1) columns × 3 floats
  const verts = new Float32Array((AREA_N + 1) * 6)
  const step = (xR - xL) / AREA_N
  for (let i = 0; i <= AREA_N; i++) {
    const x = xL + i * step
    const y1 = sample1D(expr1, x, x, 1)[0]?.y ?? 0
    const y2 = expr2OrNull ? (sample1D(expr2OrNull, x, x, 1)[0]?.y ?? 0) : 0
    const base = i * 6
    verts[base]     = x; verts[base + 1] = Math.max(y1, y2); verts[base + 2] = 0.01
    verts[base + 3] = x; verts[base + 4] = Math.min(y1, y2); verts[base + 5] = 0.01
  }
  return verts
}

/**
 * Build or update the area mesh.
 * - If existingMesh is provided: update its position buffer in-place (no allocation).
 * - Otherwise: create a new mesh with DynamicDrawUsage and a stable index array.
 */
function buildAreaMesh(expr1, expr2OrNull, xL, xR, existingMesh = null) {
  const verts = _computeAreaVerts(expr1, expr2OrNull, xL, xR)

  if (existingMesh) {
    // In-place update — zero allocations
    const posAttr = existingMesh.geometry.getAttribute('position')
    posAttr.array.set(verts)
    posAttr.needsUpdate = true
    existingMesh.material.color.set(areaColor())
    return existingMesh
  }

  // First creation only
  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.Float32BufferAttribute(verts, 3)
  posAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', posAttr)
  const indices = []
  for (let i = 0; i < AREA_N; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3
    indices.push(a, b, c, b, d, c)
  }
  geo.setIndex(indices)
  const mat = new THREE.MeshBasicMaterial({
    color: areaColor(), transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  })
  return new THREE.Mesh(geo, mat)
}

export default function GraphCanvas2D({
  equations = [],
  overlayRectangles = [],
  showArea = false,
  areaValue = null,
  regionVertices = null,
}) {
  const mountRef        = useRef(null)
  const sceneRef        = useRef(null)
  const cameraRef       = useRef(null)
  const rendererRef     = useRef(null)
  const curveLinesRef   = useRef([])
  const tangentRef      = useRef(null)
  const slopePointRef   = useRef(null)
  const crossHRef       = useRef(null)
  const crossVRef       = useRef(null)
  const xDotRef         = useRef(null)
  const yDotRef         = useRef(null)
  const rectMeshRef     = useRef([])   // array of { fill, edges } — stable pool
  const areaMeshRef     = useRef(null)
  const regionMeshRef   = useRef(null)
  const axisRefs        = useRef([])
  const gridRefs        = useRef([])
  const animRef         = useRef(null)
  const animProgressRef = useRef(0)

  const viewRef      = useRef({ panX: 0, panY: 0, scale: 1 })
  const isDragging   = useRef(false)
  const lastPointer  = useRef({ x: 0, y: 0 })
  const lastPinch    = useRef(null)
  const xMinProp = -6
  const xMaxProp = 6

  const [hoverInfo,  setHoverInfo]  = useState(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [viewBounds, setViewBounds] = useState(null)
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 380 })

  const getViewBounds = useCallback(() => {
    const mount = mountRef.current
    if (!mount) return [xMinProp, xMaxProp, -4, 4]
    const W = mount.clientWidth || 600
    const H = mount.clientHeight || 380
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
    curveLinesRef.current.forEach(({ posAttr, expr, line }) => {
      if (!posAttr || !expr) return
      const pts = sample1D(expr, xL, xR, N_POINTS)
      const arr = posAttr.array
      const cnt = Math.min(pts.length, N_POINTS)
      for (let i = 0; i < cnt; i++) {
        arr[i * 3] = pts[i].x; arr[i * 3 + 1] = pts[i].y; arr[i * 3 + 2] = 0
      }
      for (let i = cnt; i < N_POINTS; i++) arr[i * 3] = arr[i * 3 + 1] = arr[i * 3 + 2] = 0
      posAttr.needsUpdate = true
      line.geometry.setDrawRange(0, cnt)
    })
  }, [getViewBounds])

  const buildStaticGeo = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return
    axisRefs.current.forEach(o => scene.remove(o))
    gridRefs.current.forEach(o => scene.remove(o))
    axisRefs.current = []; gridRefs.current = []
    const [xL, xR, yB, yT] = getViewBounds()
    const axMat  = new THREE.LineBasicMaterial({ color: axColor(), linewidth: 3, fog: false })
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

  // ── Scene init ──────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    // Use getBoundingClientRect for accurate size at mount time
    const rect = mount.getBoundingClientRect()
    const W = rect.width  || mount.clientWidth  || 600
    const H = rect.height || mount.clientHeight || 400
    const aspect = W / H
    const halfW = (xMaxProp - xMinProp) / 2
    const halfH = halfW / aspect

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(bgColor())
    sceneRef.current = scene

    const camera = new THREE.OrthographicCamera(xMinProp, xMaxProp, halfH, -halfH, 0.1, 1000)
    camera.position.z = 10
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    buildStaticGeo()

    const tlGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-20, 0, 0), new THREE.Vector3(20, 0, 0)
    ])
    const tlMat = new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 0.18, gapSize: 0.1, linewidth: 1 })
    const tl = new THREE.Line(tlGeo, tlMat)
    tl.computeLineDistances(); tl.visible = false
    scene.add(tl); tangentRef.current = tl

    const spGeo = new THREE.CircleGeometry(0.06, 24)
    const spMat = new THREE.MeshBasicMaterial({ color: 0x2563eb })
    const sp = new THREE.Mesh(spGeo, spMat)
    sp.visible = false; sp.renderOrder = 3
    scene.add(sp); slopePointRef.current = sp

    const makeProjectionLine = () => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)
      ])
      const m = new THREE.LineDashedMaterial({
        color: crossColor(), dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.7,
      })
      const l = new THREE.Line(g, m)
      l.computeLineDistances(); l.visible = false
      scene.add(l)
      return l
    }
    crossHRef.current = makeProjectionLine()
    crossVRef.current = makeProjectionLine()

    const dotGeo = new THREE.CircleGeometry(0.05, 16)
    const dotMat = new THREE.MeshBasicMaterial({ color: crossColor() })
    const xDot = new THREE.Mesh(dotGeo, dotMat.clone())
    const yDot = new THREE.Mesh(dotGeo, dotMat.clone())
    xDot.visible = false; yDot.visible = false
    xDot.renderOrder = 2; yDot.renderOrder = 2
    scene.add(xDot); scene.add(yDot)
    xDotRef.current = xDot; yDotRef.current = yDot

    const el = renderer.domElement

    function getWorld(cx, cy) {
      const rect = el.getBoundingClientRect()
      const [xL, xR, yB, yT] = getViewBounds()
      return {
        x: xL + ((cx - rect.left) / rect.width)  * (xR - xL),
        y: yT - ((cy - rect.top)  / rect.height) * (yT - yB),
      }
    }

    el.addEventListener('mousedown', e => {
      isDragging.current = true
      lastPointer.current = { x: e.clientX, y: e.clientY }
      el.style.cursor = 'grabbing'
    })
    window.addEventListener('mouseup', () => {
      isDragging.current = false
      el.style.cursor = 'crosshair'
    })

    el.addEventListener('mousemove', e => {
      if (isDragging.current) {
        const rect = el.getBoundingClientRect()
        const dx = e.clientX - lastPointer.current.x
        const dy = e.clientY - lastPointer.current.y
        lastPointer.current = { x: e.clientX, y: e.clientY }
        const [xL, xR, yB, yT] = getViewBounds()
        viewRef.current.panX -= (dx / rect.width)  * (xR - xL)
        viewRef.current.panY += (dy / rect.height) * (yT - yB)
        rebuildCamera(); resampleAll(); buildStaticGeo()
        tl.visible = false; sp.visible = false
        crossHRef.current.visible = false; crossVRef.current.visible = false
        xDot.visible = false; yDot.visible = false
        setHoverInfo(null)
        return
      }

      const w = getWorld(e.clientX, e.clientY)
      const curves = curveLinesRef.current
      if (!curves.length) { setHoverInfo(null); return }

      // F6: find nearest curve to mouse world-y position, not always curve 0
      let bestExpr = null
      let bestDist  = Infinity
      curves.forEach(({ expr }) => {
        if (!expr) return
        const [pt] = sample1D(expr, w.x, w.x, 1)
        if (!pt) return
        const d = Math.abs(pt.y - w.y)
        if (d < bestDist) { bestDist = d; bestExpr = expr }
      })
      if (!bestExpr) { setHoverInfo(null); return }

      const pts = sample1D(bestExpr, w.x - 0.001, w.x + 0.001, 3)
      const midPt = pts[1] ?? pts[0]
      if (!midPt) { setHoverInfo(null); return }

      const dx2 = 0.0001
      const p1s = sample1D(bestExpr, w.x - dx2, w.x - dx2, 1)
      const p2s = sample1D(bestExpr, w.x + dx2, w.x + dx2, 1)
      const slope = (p1s[0] && p2s[0]) ? (p2s[0].y - p1s[0].y) / (2 * dx2) : 0
      const angleDeg = (Math.atan(slope) * 180 / Math.PI)

      const extend = (getViewBounds()[1] - getViewBounds()[0]) * 0.35
      const x0t = midPt.x - extend; const x1t = midPt.x + extend
      const y0t = midPt.y + slope * (x0t - midPt.x)
      const y1t = midPt.y + slope * (x1t - midPt.x)
      const tlPos = tl.geometry.getAttribute('position')
      tlPos.setXYZ(0, x0t, y0t, 0.03); tlPos.setXYZ(1, x1t, y1t, 0.03)
      tlPos.needsUpdate = true; tl.computeLineDistances(); tl.visible = true
      sp.position.set(midPt.x, midPt.y, 0.04); sp.visible = true

      const [xL, xR, yB, yT] = getViewBounds()
      const ch = crossHRef.current
      const cv = crossVRef.current
      const chPos = ch.geometry.getAttribute('position')
      chPos.setXYZ(0, xL, midPt.y, 0.02); chPos.setXYZ(1, midPt.x, midPt.y, 0.02)
      chPos.needsUpdate = true; ch.computeLineDistances(); ch.visible = true
      const cvPos = cv.geometry.getAttribute('position')
      cvPos.setXYZ(0, midPt.x, yB, 0.02); cvPos.setXYZ(1, midPt.x, midPt.y, 0.02)
      cvPos.needsUpdate = true; cv.computeLineDistances(); cv.visible = true

      xDot.position.set(midPt.x, 0, 0.03); xDot.visible = true
      yDot.position.set(0, midPt.y, 0.03); yDot.visible = true

      setHoverInfo({
        x: midPt.x.toFixed(4),
        y: midPt.y.toFixed(4),
        slope: slope.toFixed(4),
        angle: angleDeg.toFixed(1),
        wx: midPt.x,
        wy: midPt.y,
      })
    })

    el.addEventListener('mouseleave', () => {
      tl.visible = false; sp.visible = false
      crossHRef.current.visible = false; crossVRef.current.visible = false
      xDot.visible = false; yDot.visible = false
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

    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDragging.current = true
        lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        lastPinch.current = null
      } else if (e.touches.length === 2) {
        isDragging.current = false
        lastPinch.current = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
      }
    }, { passive: true })
    el.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && isDragging.current) {
        const rect = el.getBoundingClientRect()
        const dx = e.touches[0].clientX - lastPointer.current.x
        const dy = e.touches[0].clientY - lastPointer.current.y
        lastPointer.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        const [xL, xR, yB, yT] = getViewBounds()
        viewRef.current.panX -= (dx / rect.width)  * (xR - xL)
        viewRef.current.panY += (dy / rect.height) * (yT - yB)
        rebuildCamera(); resampleAll(); buildStaticGeo()
      } else if (e.touches.length === 2 && lastPinch.current !== null) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        viewRef.current.scale = Math.max(0.02, Math.min(100, viewRef.current.scale * (d / lastPinch.current)))
        lastPinch.current = d; rebuildCamera(); resampleAll(); buildStaticGeo()
      }
    }, { passive: true })
    el.addEventListener('touchend', () => { isDragging.current = false; lastPinch.current = null })

    animProgressRef.current = 0
    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
      if (animProgressRef.current < 1) {
        animProgressRef.current = Math.min(1, animProgressRef.current + 0.03)
        const p = animProgressRef.current
        curveLinesRef.current.forEach(({ line }) => {
          if (line) line.geometry.setDrawRange(0, Math.round(p * N_POINTS))
        })
      }
      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const nW = mount.clientWidth  || mount.getBoundingClientRect().width  || 600
      const nH = mount.clientHeight || mount.getBoundingClientRect().height || 400
      if (nW > 0 && nH > 0) {
        renderer.setSize(nW, nH)
        rebuildCamera()
        resampleAll()
        setCanvasSize({ w: nW, h: nH })
      }
    })
    ro.observe(mount)
    setViewBounds(getViewBounds()); setCanvasSize({ w: W, h: H })

    return () => {
      cancelAnimationFrame(animRef.current); ro.disconnect(); renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    const apply = () => {
      const scene = sceneRef.current; if (!scene) return
      scene.background = new THREE.Color(bgColor())
      const cc = curveColors()
      curveLinesRef.current.forEach(({ line }, i) => {
        if (line) line.material.color.set(cc[i % cc.length])
      })
      axisRefs.current.forEach(l => l.material.color.set(axColor()))
      gridRefs.current.forEach(l => l.material.color.set(gridColor()))
      if (areaMeshRef.current) areaMeshRef.current.material.color.set(areaColor())
      if (crossHRef.current) crossHRef.current.material.color.set(crossColor())
      if (crossVRef.current) crossVRef.current.material.color.set(crossColor())
      if (xDotRef.current) xDotRef.current.material.color.set(crossColor())
      if (yDotRef.current) yDotRef.current.material.color.set(crossColor())
    }
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // ── Sync equations → Three.js lines ────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    const cc = curveColors()
    const existingCount = curveLinesRef.current.length

    while (curveLinesRef.current.length > equations.length) {
      const { line } = curveLinesRef.current.pop()
      scene.remove(line)
    }

    equations.forEach((eq, i) => {
      if (i < existingCount && curveLinesRef.current[i]) {
        curveLinesRef.current[i].line.material.color.set(cc[i % cc.length])
        curveLinesRef.current[i].expr = eq.expr
      } else {
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

    animProgressRef.current = 0
    resampleAll()

    // F3: Area mesh — in-place update when possible (ARCHITECTURE.md §1)
    if (!showArea || equations.length < 1) {
      if (areaMeshRef.current) {
        scene.remove(areaMeshRef.current)
        areaMeshRef.current.geometry.dispose()
        areaMeshRef.current.material.dispose()
        areaMeshRef.current = null
      }
    } else {
      const [xL, xR] = getViewBounds()
      const expr2 = equations.length >= 2 ? equations[1].expr : null
      if (areaMeshRef.current) {
        buildAreaMesh(equations[0].expr, expr2, xL, xR, areaMeshRef.current)
      } else {
        const am = buildAreaMesh(equations[0].expr, expr2, xL, xR)
        scene.add(am)
        areaMeshRef.current = am
      }
    }
  }, [equations, showArea, resampleAll, getViewBounds])

  // ── Riemann rectangles — in-place pool (ARCHITECTURE.md §1, F2) ─────────
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    const rects = overlayRectangles
    const pool  = rectMeshRef.current  // array of { fill, edges }

    // Grow pool only when needed — one-time allocation per new slot
    while (pool.length < rects.length) {
      const geo  = new THREE.PlaneGeometry(1, 1)
      const posArr = geo.getAttribute('position')
      posArr.setUsage(THREE.DynamicDrawUsage)
      const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: areaColor(), transparent: true, opacity: 0.15, side: THREE.DoubleSide,
      }))
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: areaColor(), transparent: true, opacity: 0.6 })
      )
      scene.add(fill); scene.add(edges)
      pool.push({ fill, edges })
    }

    // Mutate position/scale in-place for all active rects
    rects.forEach(({ x0, x1, height }, i) => {
      const w = x1 - x0; const h = Math.abs(height)
      const cx = x0 + w / 2; const cy = height / 2
      const { fill, edges } = pool[i]
      fill.scale.set(w, h, 1);   fill.position.set(cx, cy, 0.05);  fill.visible  = true
      edges.scale.set(w, h, 1);  edges.position.set(cx, cy, 0.05); edges.visible = true
    })

    // Hide excess pool entries — no removal, no allocation
    for (let i = rects.length; i < pool.length; i++) {
      pool[i].fill.visible  = false
      pool[i].edges.visible = false
    }
  }, [overlayRectangles])

  // ── Region polygon from /integral-order (AC2) ───────────────────────────
  useEffect(() => {
    const scene = sceneRef.current; if (!scene) return
    if (regionMeshRef.current) {
      scene.remove(regionMeshRef.current)
      regionMeshRef.current.geometry.dispose()
      regionMeshRef.current.material.dispose()
      regionMeshRef.current = null
    }
    if (!regionVertices || regionVertices.length < 3) return
    const pts   = regionVertices.map(([x, y]) => new THREE.Vector2(x, y))
    const shape = new THREE.Shape(pts)
    const geo   = new THREE.ShapeGeometry(shape)
    const mat   = new THREE.MeshBasicMaterial({
      color: areaColor(), transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    })
    const mesh  = new THREE.Mesh(geo, mat)
    mesh.position.z = 0.02
    scene.add(mesh)
    regionMeshRef.current = mesh
  }, [regionVertices])

  const resetView = () => {
    viewRef.current = { panX: 0, panY: 0, scale: 1 }
    rebuildCamera(); resampleAll(); buildStaticGeo()
  }

  return (
    <div className={`${styles.wrapper} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.toolbar}>
        <span className={styles.label}>Graph</span>
        <div className={styles.legend}>
          {equations.map((eq, i) => {
            const cc = isDark() ? CURVE_COLORS_DARK : CURVE_COLORS_LIGHT
            const hex = `#${cc[i % cc.length].toString(16).padStart(6, '0')}`
            return (
              <span key={eq.id} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: hex }} />
                <span className={styles.legendExpr}>{eq.expr || '—'}</span>
              </span>
            )
          })}
        </div>
        <div className={styles.toolbarRight}>
          {/* F10: render areaValue in the badge when provided */}
          {showArea && (
            <span className={styles.areaBadge} title="Area shading enabled">
              {areaValue != null ? `∫ Area = ${areaValue.toFixed(3)}` : '∫ Area'}
            </span>
          )}
          {hoverInfo && (
            <span className={styles.coordBadge}>
              <span>x={hoverInfo.x}</span>
              <span>y={hoverInfo.y}</span>
              <span className={styles.slopeBadge}>m={hoverInfo.slope}</span>
              <span className={styles.angleBadge}>{hoverInfo.angle}°</span>
            </span>
          )}
          <button className={styles.toolBtn} onClick={resetView} title="Reset view">
            <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor" aria-hidden="true">
              <path d="M480-320v-100q0-25 17.5-42.5T540-480h100v60H540v100h-60Zm60 240q-25 0-42.5-17.5T480-140v-100h60v100h100v60H540Zm280-240v-100H720v-60h100q25 0 42.5 17.5T880-420v100h-60ZM720-80v-60h100v-100h60v100q0 25-17.5 42.5T820-80H720Zm111-480h-83q-26-88-99-144t-169-56q-117 0-198.5 81.5T200-480q0 72 32.5 132t87.5 98v-110h80v240H160v-80h94q-62-50-98-122.5T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q129 0 226.5 79.5T831-560Z"/>
            </svg>
          </button>
          <button className={styles.toolBtn} onClick={() => setIsExpanded(e => !e)}
            title={isExpanded ? 'Collapse' : 'Expand'}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor" aria-hidden="true">
              <path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.canvasWrap}>
        <div className={styles.canvas} ref={mountRef} />
        <TickLabels
          viewBounds={viewBounds}
          canvasW={canvasSize.w}
          canvasH={canvasSize.h}
          hoverInfo={hoverInfo}
        />
      </div>

      <p className={styles.hint}>
        Drag to pan · scroll to zoom · double-click to reset · hover for slope &amp; angle
      </p>
    </div>
  )
}
