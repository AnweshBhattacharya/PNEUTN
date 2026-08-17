/**
 * GraphCanvas3D — Three.js 3D surface renderer.
 *
 * Interactions:
 *   Mouse drag  → orbit
 *   Scroll      → zoom
 *   Touch drag  → orbit
 *   Pinch       → zoom
 *   Double-click/tap → reset
 *
 * Z-values updated IN PLACE on expression change.
 * Theme-aware via MutationObserver.
 * See ARCHITECTURE.md §1.
 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sample2DGrid } from '../../lib/mathEval'
import styles from './GraphCanvas3D.module.css'

const SEGMENTS = 40
const DEFAULT_ROT = { phi: Math.PI / 4, theta: Math.PI / 6, radius: 12 }

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}
function themeColors() {
  const dark = isDark()
  return {
    bg:        dark ? 0x111110 : 0xfafaf9,
    axis:      dark ? 0x57534e : 0xb8b5b0,
    surface:   dark ? 0x292927 : 0xfafaf9,
    wireframe: dark ? 0xa8a29e : 0x1a1917,
  }
}

export default function GraphCanvas3D({
  exprStr = 'sin(x) * cos(y)',
  xMin = -4, xMax = 4,
  yMin = -4, yMax = 4,
  extraVars = {},
}) {
  const mountRef    = useRef(null)
  const sceneRef    = useRef(null)
  const cameraRef   = useRef(null)
  const rendererRef = useRef(null)
  const meshRef     = useRef(null)
  const wireMeshRef = useRef(null)
  const posAttrRef  = useRef(null)
  const animRef     = useRef(null)
  const rotRef      = useRef({ ...DEFAULT_ROT })
  const isDragging  = useRef(false)
  const lastPtr     = useRef({ x: 0, y: 0 })
  const lastPinch   = useRef(null)

  const [hoverCoord, setHoverCoord]   = useState(null)
  const [isExpanded, setIsExpanded]   = useState(false)

  // ── Scene init ─────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    const W = mount.clientWidth || 600
    const H = mount.clientHeight || 260
    const c = themeColors()

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(c.bg)
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200)
    cameraRef.current = camera

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(W, H)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(5, 10, 5); scene.add(dir)

    // Axes
    const axMat = new THREE.LineBasicMaterial({ color: c.axis })
    for (const [p1, p2] of [
      [[-6, 0, 0], [6, 0, 0]], [[0, -6, 0], [0, 6, 0]], [[0, 0, -6], [0, 0, 6]],
    ]) {
      scene.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p1), new THREE.Vector3(...p2)]),
        axMat
      ))
    }

    // Surface
    const geo = new THREE.PlaneGeometry(xMax - xMin, yMax - yMin, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)
    const posAttr = geo.getAttribute('position')
    posAttr.setUsage(THREE.DynamicDrawUsage)
    posAttrRef.current = posAttr

    const mat = new THREE.MeshPhongMaterial({ color: c.surface, wireframe: false, side: THREE.DoubleSide, shininess: 40 })
    const mesh = new THREE.Mesh(geo, mat); scene.add(mesh); meshRef.current = mesh

    const wireMat = new THREE.MeshBasicMaterial({ color: c.wireframe, wireframe: true, transparent: true, opacity: 0.13 })
    const wireMesh = new THREE.Mesh(geo, wireMat); scene.add(wireMesh); wireMeshRef.current = wireMesh

    // ── Input handlers ─────────────────────────────────────────────────
    const el = renderer.domElement

    function orbit(dx, dy) {
      rotRef.current.phi   += dx * 0.012
      rotRef.current.theta += dy * 0.012
      rotRef.current.theta  = Math.max(0.05, Math.min(Math.PI / 2 - 0.05, rotRef.current.theta))
    }

    // Mouse
    el.addEventListener('mousedown', e => {
      isDragging.current = true
      lastPtr.current = { x: e.clientX, y: e.clientY }
      el.style.cursor = 'grabbing'
    })
    window.addEventListener('mouseup', () => { isDragging.current = false; el.style.cursor = 'grab' })
    el.addEventListener('mousemove', e => {
      if (!isDragging.current) return
      orbit(e.clientX - lastPtr.current.x, e.clientY - lastPtr.current.y)
      lastPtr.current = { x: e.clientX, y: e.clientY }
    })
    el.addEventListener('wheel', e => {
      rotRef.current.radius = Math.max(4, Math.min(30, rotRef.current.radius + e.deltaY * 0.025))
    }, { passive: true })
    el.addEventListener('dblclick', () => { rotRef.current = { ...DEFAULT_ROT } })

    // Touch
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDragging.current = true
        lastPtr.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        lastPinch.current = null
      } else if (e.touches.length === 2) {
        isDragging.current = false
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        lastPinch.current = d
      }
    }, { passive: true })
    el.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && isDragging.current) {
        orbit(e.touches[0].clientX - lastPtr.current.x, e.touches[0].clientY - lastPtr.current.y)
        lastPtr.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      } else if (e.touches.length === 2 && lastPinch.current !== null) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY)
        const delta = lastPinch.current - d
        rotRef.current.radius = Math.max(4, Math.min(30, rotRef.current.radius + delta * 0.04))
        lastPinch.current = d
      }
    }, { passive: true })
    el.addEventListener('touchend', () => { isDragging.current = false; lastPinch.current = null })

    // Raycaster hover
    const raycaster = new THREE.Raycaster()
    const mouse2 = new THREE.Vector2()
    el.addEventListener('mousemove', e => {
      if (isDragging.current) { setHoverCoord(null); return }
      const rect = el.getBoundingClientRect()
      mouse2.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
      mouse2.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse2, camera)
      const hits = raycaster.intersectObject(mesh)
      if (hits.length) {
        const p = hits[0].point
        setHoverCoord({ x: p.x.toFixed(2), y: p.y.toFixed(2), z: p.z.toFixed(2) })
      } else setHoverCoord(null)
    })

    // Animate
    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
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

    // Resize
    const ro = new ResizeObserver(() => {
      const nW = mount.clientWidth; const nH = mount.clientHeight
      renderer.setSize(nW, nH)
      camera.aspect = nW / nH
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Theme sync
  useEffect(() => {
    const apply = () => {
      if (!sceneRef.current) return
      const c = themeColors()
      sceneRef.current.background = new THREE.Color(c.bg)
      meshRef.current?.material.color.set(c.surface)
      wireMeshRef.current?.material.color.set(c.wireframe)
    }
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // Update Z in-place
  useEffect(() => {
    if (!posAttrRef.current) return
    const zVals = sample2DGrid(exprStr, xMin, xMax, yMin, yMax, SEGMENTS, extraVars)
    const pos = posAttrRef.current.array
    for (let idx = 0; idx < (SEGMENTS + 1) ** 2; idx++) {
      pos[idx * 3 + 1] = zVals[idx]
    }
    posAttrRef.current.needsUpdate = true
    meshRef.current?.geometry.computeVertexNormals()
  }, [exprStr, extraVars, xMin, xMax, yMin, yMax])

  return (
    <div className={`${styles.wrapper} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.toolbar}>
        <span className={styles.label}>3D Surface</span>
        <div className={styles.toolbarRight}>
          {hoverCoord && (
            <span className={styles.coordBadge}>
              ({hoverCoord.x}, {hoverCoord.y}, {hoverCoord.z})
            </span>
          )}
          <button className={styles.toolBtn} onClick={() => { rotRef.current = { ...DEFAULT_ROT } }} title="Reset view">⌂</button>
          <button className={styles.toolBtn} onClick={() => setIsExpanded(e => !e)} title={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? '⊡' : '⊞'}
          </button>
        </div>
      </div>
      <div className={styles.canvas} ref={mountRef} />
      <p className={styles.hint}>Drag to orbit · scroll to zoom · double-click to reset</p>
    </div>
  )
}
