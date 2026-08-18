/**
 * GraphCanvas3D — Three.js 3D surface renderer.
 *
 * Features (matching 2D parity):
 * - Slow auto-rotation demonstration (pauses on interaction)
 * - Colour-gradient surface (height-mapped: blue→green→red)
 * - Raycaster hover with (x, y, z) coordinate display
 * - Axis labels (X, Y, Z)
 * - Pan/orbit drag, scroll zoom, pinch zoom, double-click reset
 * - Expand to fullscreen
 * - Theme-aware via MutationObserver
 * - Z updated in-place on expression change
 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sample2DGrid } from '../../lib/mathEval'
import styles from './GraphCanvas3D.module.css'

const SEGMENTS = 50
const DEFAULT_ROT = { phi: Math.PI / 5, theta: Math.PI / 7, radius: 13 }
const AUTO_ROT_SPEED = 0.003  // radians per frame

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark' }
function themeColors() {
  const dark = isDark()
  return {
    bg:   dark ? 0x111110 : 0xfafaf9,
    axis: dark ? 0x57534e : 0xa8a29e,
    grid: dark ? 0x2c2b28 : 0xe4e1dc,
  }
}

/** Map a height value (normalised 0-1) to a RGB color (cool-to-warm). */
function heightColor(t) {
  // Blue (0,0,1) → Cyan (0,1,1) → Green (0,1,0) → Yellow (1,1,0) → Red (1,0,0)
  const stops = [
    [0.0,  0,   0,   1],
    [0.25, 0,   1,   1],
    [0.5,  0,   1,   0],
    [0.75, 1,   1,   0],
    [1.0,  1,   0,   0],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i]
    const [t1, r1, g1, b1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0)
      return new THREE.Color(r0 + f*(r1-r0), g0 + f*(g1-g0), b0 + f*(b1-b0))
    }
  }
  return new THREE.Color(1, 0, 0)
}

export default function GraphCanvas3D({
  exprStr = 'sin(x) * cos(y)',
  xMin = -4, xMax = 4,
  yMin = -4, yMax = 4,
  extraVars = {},
}) {
  const mountRef     = useRef(null)
  const sceneRef     = useRef(null)
  const cameraRef    = useRef(null)
  const rendererRef  = useRef(null)
  const meshRef      = useRef(null)
  const wireMeshRef  = useRef(null)
  const posAttrRef   = useRef(null)
  const colAttrRef   = useRef(null)
  const hoverMarkerRef = useRef(null)
  const animRef      = useRef(null)
  const rotRef       = useRef({ ...DEFAULT_ROT })
  const autoRotateRef= useRef(true)
  const isDragging   = useRef(false)
  const isInteracting= useRef(false)
  const lastPtr      = useRef({ x: 0, y: 0 })
  const lastPinch    = useRef(null)
  const interactTimer= useRef(null)

  const [hoverCoord, setHoverCoord] = useState(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)

  // Keep autoRotateRef in sync with state so animate loop always reads current value
  useEffect(() => { autoRotateRef.current = autoRotate }, [autoRotate])

  useEffect(() => {
    const mount = mountRef.current
    const el = mount // Assign mount to el for event listeners
    const W = mount.clientWidth || 600
    const H = mount.clientHeight || 380
    const c = themeColors()

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(c.bg)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 300)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Lights ──────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8)
    dir1.position.set(8, 12, 8); scene.add(dir1)
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3)
    dir2.position.set(-8, -4, -8); scene.add(dir2)

    // ── Axes with labels ─────────────────────────────────────────────
    // Make axes thicker and more visible
    const axMat = new THREE.LineBasicMaterial({ color: c.axis, linewidth: 2 })
    const grdMat = new THREE.LineBasicMaterial({ color: c.grid })
    const axLen = 5.5
    for (const [p1, p2] of [
      [[-axLen,0,0],[axLen,0,0]],
      [[0,-axLen,0],[0,axLen,0]],
      [[0,0,-axLen],[0,0,axLen]],
    ]) {
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p1), new THREE.Vector3(...p2)]),
        axMat
      ))
    }

    // Axis label sprites - make text bolder and larger
    function makeLabel(text, position) {
      const canvas = document.createElement('canvas')
      canvas.width = 128; canvas.height = 128
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = isDark() ? '#e3e3e3' : '#1a1a1a'
      ctx.font = 'bold 60px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 64, 64)
      const tex = new THREE.CanvasTexture(canvas)
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(0.8, 0.8, 1)
      sprite.position.set(...position)
      scene.add(sprite)
    }
    makeLabel('X', [axLen + 0.4, 0, 0])
    makeLabel('Y', [0, axLen + 0.4, 0])
    makeLabel('Z', [0, 0, axLen + 0.4])

    // ── Surface ──────────────────────────────────────────────────────
    const geo = new THREE.PlaneGeometry(xMax - xMin, yMax - yMin, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)

    const posAttr = geo.getAttribute('position')
    posAttr.setUsage(THREE.DynamicDrawUsage)
    posAttrRef.current = posAttr

    // Vertex colours
    const n = (SEGMENTS + 1) ** 2
    const colors = new Float32Array(n * 3)
    const colAttr = new THREE.BufferAttribute(colors, 3)
    colAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('color', colAttr)
    colAttrRef.current = colAttr

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      shininess: 60,
      specular: new THREE.Color(0.2, 0.2, 0.2),
    })
    const mesh = new THREE.Mesh(geo, mat)
    scene.add(mesh); meshRef.current = mesh

    // Subtle wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: isDark() ? 0x3c3a36 : 0xd0cdc6,
      wireframe: true, transparent: true, opacity: 0.08,
    })
    const wireMesh = new THREE.Mesh(geo, wireMat)
    scene.add(wireMesh); wireMeshRef.current = wireMesh

    // ── Hover point marker ───────────────────────────────────────────
    const hoverSphereGeo = new THREE.SphereGeometry(0.12, 16, 16)
    const hoverSphereMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      emissive: 0x2563eb,
      emissiveIntensity: 0.6,
      metalness: 0.8,
      roughness: 0.2,
    })
    const hoverSphere = new THREE.Mesh(hoverSphereGeo, hoverSphereMat)
    hoverSphere.visible = false
    scene.add(hoverSphere)
    hoverMarkerRef.current = hoverSphere

    function pauseAutoRotate() {
      isInteracting.current = true
      clearTimeout(interactTimer.current)
      interactTimer.current = setTimeout(() => { isInteracting.current = false }, 2500)
    }

    function orbit(dx, dy) {
      rotRef.current.phi   += dx * 0.010
      rotRef.current.theta = Math.max(0.05, Math.min(Math.PI / 2 - 0.05,
        rotRef.current.theta + dy * 0.010))
    }

    el.addEventListener('mousedown', e => {
      isDragging.current = true
      lastPtr.current = { x: e.clientX, y: e.clientY }
      el.style.cursor = 'grabbing'
      pauseAutoRotate()
    })
    window.addEventListener('mouseup', () => { isDragging.current = false; el.style.cursor = 'grab' })
    el.addEventListener('mousemove', e => {
      if (isDragging.current) {
        orbit(e.clientX - lastPtr.current.x, e.clientY - lastPtr.current.y)
        lastPtr.current = { x: e.clientX, y: e.clientY }
        return
      }
      // Raycaster hover
      const rect = el.getBoundingClientRect()
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length) {
        const p = hits[0].point
        setHoverCoord({ x: p.x.toFixed(2), y: p.z.toFixed(2), z: p.y.toFixed(2) })
        // Position hover marker sphere at the hit point
        if (hoverMarkerRef.current) {
          hoverMarkerRef.current.position.copy(p)
          hoverMarkerRef.current.visible = true
        }
      } else {
        setHoverCoord(null)
        if (hoverMarkerRef.current) hoverMarkerRef.current.visible = false
      }
    })
    el.addEventListener('mouseleave', () => {
      setHoverCoord(null)
      if (hoverMarkerRef.current) hoverMarkerRef.current.visible = false
    })
    el.addEventListener('wheel', e => {
      rotRef.current.radius = Math.max(4, Math.min(35,
        rotRef.current.radius + e.deltaY * 0.02))
      pauseAutoRotate()
    }, { passive: true })
    el.addEventListener('dblclick', () => {
      rotRef.current = { ...DEFAULT_ROT }
      pauseAutoRotate()
    })

    // Touch
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDragging.current = true
        lastPtr.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        lastPinch.current = null
        pauseAutoRotate()
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
        orbit(e.touches[0].clientX - lastPtr.current.x, e.touches[0].clientY - lastPtr.current.y)
        lastPtr.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      } else if (e.touches.length === 2 && lastPinch.current !== null) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        )
        rotRef.current.radius = Math.max(4, Math.min(35,
          rotRef.current.radius + (lastPinch.current - d) * 0.04))
        lastPinch.current = d
      }
    }, { passive: true })
    el.addEventListener('touchend', () => { isDragging.current = false; lastPinch.current = null })

    // ── Animate ──────────────────────────────────────────────────────
    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
      // Auto-rotate when not interacting (respects autoRotateRef so state changes take effect)
      if (autoRotateRef.current && !isInteracting.current && !isDragging.current) {
        rotRef.current.phi += AUTO_ROT_SPEED
      }
      const { phi, theta, radius } = rotRef.current
      camera.position.set(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta),
        radius * Math.cos(theta) * Math.cos(phi),
      )
      camera.lookAt(0, 0, 0)
      renderer.render(scene, camera)
    }
    animate()

    const ro = new ResizeObserver(() => {
      const nW = mount.clientWidth; const nH = mount.clientHeight
      renderer.setSize(nW, nH)
      camera.aspect = nW / nH
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(animRef.current)
      clearTimeout(interactTimer.current)
      ro.disconnect()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Theme sync ──────────────────────────────────────────────────────────
  useEffect(() => {
    const apply = () => {
      if (!sceneRef.current) return
      const c = themeColors()
      sceneRef.current.background = new THREE.Color(c.bg)
      if (wireMeshRef.current) wireMeshRef.current.material.color.set(isDark() ? 0x3c3a36 : 0xd0cdc6)
    }
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // ── Update surface Z + vertex colours ──────────────────────────────────
  useEffect(() => {
    if (!posAttrRef.current || !colAttrRef.current) return

    const zVals = sample2DGrid(exprStr, xMin, xMax, yMin, yMax, SEGMENTS, extraVars)
    const pos = posAttrRef.current.array
    const col = colAttrRef.current.array
    const n = (SEGMENTS + 1) ** 2

    // Find z range for colour normalisation
    let zMin = Infinity, zMax = -Infinity
    for (let i = 0; i < n; i++) {
      const z = zVals[i]
      if (isFinite(z)) { zMin = Math.min(zMin, z); zMax = Math.max(zMax, z) }
    }
    const zRange = zMax - zMin || 1

    for (let idx = 0; idx < n; idx++) {
      pos[idx * 3 + 1] = zVals[idx]
      const t = Math.max(0, Math.min(1, (zVals[idx] - zMin) / zRange))
      const c = heightColor(t)
      col[idx * 3]     = c.r
      col[idx * 3 + 1] = c.g
      col[idx * 3 + 2] = c.b
    }

    posAttrRef.current.needsUpdate = true
    colAttrRef.current.needsUpdate = true
    meshRef.current?.geometry.computeVertexNormals()
  }, [exprStr, extraVars, xMin, xMax, yMin, yMax])

  return (
    <div className={`${styles.wrapper} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.toolbar}>
        <span className={styles.label}>3D Surface</span>
        <div className={styles.toolbarCenter}>
          <button
            className={styles.toolBtn}
            onClick={() => setAutoRotate(r => !r)}
            title={autoRotate ? 'Stop auto-rotation' : 'Start auto-rotation'}
            aria-pressed={autoRotate}
            type="button"
          >
            {autoRotate ? '⟳' : '⏸'}
          </button>
          {autoRotate && !isExpanded && (
            <span className={styles.rotateBadge}>auto-rotating</span>
          )}
        </div>
        <div className={styles.toolbarRight}>
          {hoverCoord && (
            <span className={styles.coordBadge}>
              x={hoverCoord.x} y={hoverCoord.y} z={hoverCoord.z}
            </span>
          )}
          <button className={styles.toolBtn}
            onClick={() => { rotRef.current = { ...DEFAULT_ROT } }}
            title="Reset view">
            <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor" aria-hidden="true">
              <path d="M480-320v-100q0-25 17.5-42.5T540-480h100v60H540v100h-60Zm60 240q-25 0-42.5-17.5T480-140v-100h60v100h100v60H540Zm280-240v-100H720v-60h100q25 0 42.5 17.5T880-420v100h-60ZM720-80v-60h100v-100h60v100q0 25-17.5 42.5T820-80H720Zm111-480h-83q-26-88-99-144t-169-56q-117 0-198.5 81.5T200-480q0 72 32.5 132t87.5 98v-110h80v240H160v-80h94q-62-50-98-122.5T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q129 0 226.5 79.5T831-560Z"/>
            </svg>
          </button>
          <button className={styles.toolBtn}
            onClick={() => setIsExpanded(e => !e)}
            title={isExpanded ? 'Collapse' : 'Expand'}>
            <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor" aria-hidden="true">
              <path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.colorBar}>
        <span className={styles.colorBarLabel}>low</span>
        <div className={styles.colorBarGradient} />
        <span className={styles.colorBarLabel}>high</span>
      </div>

      <div className={styles.canvas} ref={mountRef} />
      <p className={styles.hint}>
        Drag to orbit · scroll to zoom · double-click to reset · auto-rotates when idle
      </p>
    </div>
  )
}
