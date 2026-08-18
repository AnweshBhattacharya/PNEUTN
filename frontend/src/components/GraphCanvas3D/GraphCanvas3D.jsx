/**
 * GraphCanvas3D — Three.js 3D surface renderer.
 *
 * Features:
 * - Slow auto-rotation (pauses on interaction)
 * - Colour-gradient surface (height-mapped: blue→green→red)
 * - Raycaster hover with (x, y, z) coordinate display
 * - Bold cylinder axes with +X/+Y/+Z and −X/−Y/−Z labels
 * - 3D grid background (GridHelper on XZ plane)
 * - 3D Volume under surface: semi-transparent skirt + floor enclosing volume to base plane
 * - Interactive limit settings (xMin, xMax, yMin, yMax) updated in-place
 * - Numerical volume approximation badge
 * - Pan/orbit drag, scroll zoom, pinch zoom, double-click reset
 * - Expand to fullscreen
 * - Theme-aware via MutationObserver
 * - In-place buffer mutation on expression/limit changes (ARCHITECTURE.md §1)
 */
import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { sample2DGrid } from '../../lib/mathEval'
import styles from './GraphCanvas3D.module.css'

const SEGMENTS = 50
const DEFAULT_ROT = { phi: Math.PI / 5, theta: Math.PI / 7, radius: 13 }
const AUTO_ROT_SPEED = 0.003

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark' }
function themeColors() {
  const dark = isDark()
  return {
    bg:   dark ? 0x111110 : 0xfafaf9,
    axis: dark ? 0xa8a29e : 0x57534e,
    grid: dark ? 0x2c2b28 : 0xe4e1dc,
  }
}

/** Map a height value (normalised 0-1) to a RGB color (cool-to-warm). */
function heightColor(t) {
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

/**
 * Create a bold axis using a thin CylinderGeometry + MeshBasicMaterial.
 * Three.js WebGL2 ignores linewidth>1 on Line objects; cylinders render with real thickness.
 */
function makeBoldAxis(from, to, color) {
  const dir = new THREE.Vector3().subVectors(to, from)
  const len = dir.length()
  const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 8)
  const mat = new THREE.MeshBasicMaterial({ color })
  const mesh = new THREE.Mesh(geo, mat)
  const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5)
  mesh.position.copy(mid)
  const axis = new THREE.Vector3(0, 1, 0)
  mesh.quaternion.setFromUnitVectors(axis, dir.normalize())
  return mesh
}

/** Axis label sprite using canvas texture. */
function makeLabel(scene, text, position, dark) {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = dark ? '#d4d0cc' : '#1a1917'
  ctx.font = 'bold 58px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.85, 0.85, 1)
  sprite.position.set(...position)
  scene.add(sprite)
  return sprite
}

export default function GraphCanvas3D({
  exprStr = 'sin(x) * cos(y)',
  xMin = -4, xMax = 4,
  yMin = -4, yMax = 4,
  extraVars = {},
  showVolume = true,
  showGrid = true,
  showWireframe = true,
  onVolumeCalculated = null,
}) {
  const mountRef     = useRef(null)
  const sceneRef     = useRef(null)
  const cameraRef    = useRef(null)
  const rendererRef  = useRef(null)
  const meshRef      = useRef(null)
  const wireMeshRef  = useRef(null)
  const skirtMeshRef = useRef(null)   // area-under-surface skirt
  const floorMeshRef = useRef(null)   // base floor at y=0
  const posAttrRef   = useRef(null)
  const colAttrRef   = useRef(null)
  const skirtPosRef  = useRef(null)
  const floorPosRef  = useRef(null)
  const hoverMarkerRef = useRef(null)
  const axisGroupRef = useRef([])     // axis cylinders + labels for theme sync
  const gridRef      = useRef(null)
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
  const [volumeEst,  setVolumeEst]  = useState(null)

  // Escape key to close expanded view (Bug 5 / Bug 10)
  useEffect(() => {
    if (!isExpanded) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setIsExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isExpanded])

  useEffect(() => { autoRotateRef.current = autoRotate }, [autoRotate])

  useEffect(() => {
    const mount = mountRef.current
    const el = mount
    const rect = mount.getBoundingClientRect()
    const W = Math.max(rect.width  || mount.clientWidth  || 600, 1)
    const H = Math.max(rect.height || mount.clientHeight || 380, 1)
    const c = themeColors()
    const dark = isDark()

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

    // ── Lights ────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8)
    dir1.position.set(8, 12, 8); scene.add(dir1)
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3)
    dir2.position.set(-8, -4, -8); scene.add(dir2)

    // ── Bold Axes (CylinderGeometry) ──────────────────────────────────
    const axLen = 5.5
    const axisColor = c.axis

    const axObjs = []
    const xPos = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(axLen,0,0), axisColor)
    const xNeg = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(-axLen,0,0), axisColor)
    const yPos = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(0,axLen,0), axisColor)
    const yNeg = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(0,-axLen,0), axisColor)
    const zPos = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,axLen), axisColor)
    const zNeg = makeBoldAxis(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-axLen), axisColor)

    for (const ax of [xPos, xNeg, yPos, yNeg, zPos, zNeg]) {
      scene.add(ax); axObjs.push(ax)
    }

    function makeCone(position, direction, color) {
      const coneGeo = new THREE.ConeGeometry(0.10, 0.35, 8)
      const coneMat = new THREE.MeshBasicMaterial({ color })
      const cone = new THREE.Mesh(coneGeo, coneMat)
      cone.position.copy(position)
      const up = new THREE.Vector3(0, 1, 0)
      cone.quaternion.setFromUnitVectors(up, direction.normalize())
      scene.add(cone); axObjs.push(cone)
    }
    makeCone(new THREE.Vector3(axLen + 0.18, 0, 0), new THREE.Vector3(1, 0, 0), axisColor)
    makeCone(new THREE.Vector3(0, axLen + 0.18, 0), new THREE.Vector3(0, 1, 0), axisColor)
    makeCone(new THREE.Vector3(0, 0, axLen + 0.18), new THREE.Vector3(0, 0, 1), axisColor)

    axisGroupRef.current = axObjs

    // Labels: +X, +Y, +Z and -X, -Y, -Z
    const labelObjs = []
    const labelData = [
      ['X',  [axLen + 0.7,  0.15, 0]],
      ['Y',  [0.15,  axLen + 0.7, 0]],
      ['Z',  [0, 0.15, axLen + 0.7]],
      ['−X', [-axLen - 0.7, 0.15, 0]],
      ['−Y', [0.15, -axLen - 0.7, 0]],
      ['−Z', [0, 0.15, -axLen - 0.7]],
    ]
    for (const [text, pos] of labelData) {
      const s = makeLabel(scene, text, pos, dark)
      labelObjs.push(s)
    }

    // ── Grid Helper (XZ plane) ────────────────────────────────────────
    const gridHelper = new THREE.GridHelper(10, 10, c.grid, c.grid)
    gridHelper.position.y = 0
    gridHelper.material.opacity = 0.4
    gridHelper.material.transparent = true
    scene.add(gridHelper)
    gridRef.current = gridHelper

    // ── Surface ───────────────────────────────────────────────────────
    const geo = new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS)
    geo.rotateX(-Math.PI / 2)

    const posAttr = geo.getAttribute('position')
    posAttr.setUsage(THREE.DynamicDrawUsage)
    posAttrRef.current = posAttr

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

    // Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: dark ? 0x3c3a36 : 0xd0cdc6,
      wireframe: true, transparent: true, opacity: 0.08,
    })
    const wireMesh = new THREE.Mesh(geo, wireMat)
    scene.add(wireMesh); wireMeshRef.current = wireMesh

    // ── Area under surface skirt ──────────────────────────────────────
    const skirtVertCount = (SEGMENTS + 1) * 4 * 2
    const skirtPos = new Float32Array(skirtVertCount * 3)
    const skirtBufAttr = new THREE.BufferAttribute(skirtPos, 3)
    skirtBufAttr.setUsage(THREE.DynamicDrawUsage)
    const skirtGeo = new THREE.BufferGeometry()
    skirtGeo.setAttribute('position', skirtBufAttr)

    const skirtIdx = []
    const edgeN = SEGMENTS + 1
    for (let edge = 0; edge < 4; edge++) {
      const baseV = edge * edgeN * 2
      for (let i = 0; i < SEGMENTS; i++) {
        const a = baseV + i * 2
        const b = a + 1
        const c = a + 2
        const d = a + 3
        skirtIdx.push(a, b, c, b, d, c)
      }
    }
    skirtGeo.setIndex(skirtIdx)

    const skirtMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat)
    scene.add(skirtMesh)
    skirtMeshRef.current = skirtMesh
    skirtPosRef.current = skirtBufAttr

    // ── Base Floor Quad (at y=0) ──────────────────────────────────────
    const floorGeo = new THREE.PlaneGeometry(1, 1, 1, 1)
    floorGeo.rotateX(-Math.PI / 2)
    const floorPosAttr = floorGeo.getAttribute('position')
    floorPosAttr.setUsage(THREE.DynamicDrawUsage)
    floorPosRef.current = floorPosAttr
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    scene.add(floorMesh)
    floorMeshRef.current = floorMesh

    // ── Hover point marker ─────────────────────────────────────────────
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

    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
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
      const nW = Math.max(mount.clientWidth || 1, 1)
      const nH = Math.max(mount.clientHeight || 1, 1)
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
      if (gridRef.current) gridRef.current.material.color?.set(c.grid)
      axisGroupRef.current.forEach(obj => {
        if (obj.material) obj.material.color?.set(c.axis)
      })
    }
    const obs = new MutationObserver(apply)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // ── Visibility Toggles ──────────────────────────────────────────────────
  useEffect(() => {
    if (skirtMeshRef.current) skirtMeshRef.current.visible = showVolume
    if (floorMeshRef.current) floorMeshRef.current.visible = showVolume
  }, [showVolume])

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid
  }, [showGrid])

  useEffect(() => {
    if (wireMeshRef.current) wireMeshRef.current.visible = showWireframe
  }, [showWireframe])

  // ── Update surface Z + vertex positions/colours + skirt + floor ────────
  useEffect(() => {
    if (!posAttrRef.current || !colAttrRef.current) return

    const zVals = sample2DGrid(exprStr, xMin, xMax, yMin, yMax, SEGMENTS, extraVars)
    const pos = posAttrRef.current.array
    const col = colAttrRef.current.array
    const n = (SEGMENTS + 1) ** 2

    let zMin = Infinity, zMax = -Infinity
    let sumZ = 0
    let validCount = 0
    for (let i = 0; i < n; i++) {
      const z = zVals[i]
      if (isFinite(z)) {
        zMin = Math.min(zMin, z)
        zMax = Math.max(zMax, z)
        sumZ += z
        validCount++
      }
    }
    if (validCount === 0 || !isFinite(zMin) || !isFinite(zMax)) {
      zMin = -1
      zMax = 1
    }
    const zRange = (zMax === zMin || zMax - zMin === 0) ? 1 : (zMax - zMin)
    const xStep = (xMax - xMin) / SEGMENTS
    const yStep = (yMax - yMin) / SEGMENTS
    const dA = xStep * yStep
    const approxVolume = sumZ * dA
    setVolumeEst(approxVolume)
    onVolumeCalculated?.({ volume: approxVolume, zMin, zMax })

    let idx = 0
    for (let j = 0; j <= SEGMENTS; j++) {
      const yCoord = yMin + j * yStep
      for (let i = 0; i <= SEGMENTS; i++) {
        const xCoord = xMin + i * xStep
        const z = zVals[idx]
        pos[idx * 3]     = xCoord
        pos[idx * 3 + 1] = z
        pos[idx * 3 + 2] = yCoord

        const t = (zMax === zMin) ? 0.5 : Math.max(0, Math.min(1, (z - zMin) / zRange))
        const c = heightColor(t)
        col[idx * 3]     = c.r
        col[idx * 3 + 1] = c.g
        col[idx * 3 + 2] = c.b
        idx++
      }
    }

    posAttrRef.current.needsUpdate = true
    colAttrRef.current.needsUpdate = true
    meshRef.current?.geometry.computeVertexNormals()

    // ── Update skirt ────────────────────────────────────────────────────
    if (skirtPosRef.current) {
      const sp = skirtPosRef.current.array
      const S = SEGMENTS + 1
      let vi = 0
      function setVert(wx, wy, wz) {
        sp[vi * 3]     = wx
        sp[vi * 3 + 1] = wy
        sp[vi * 3 + 2] = wz
        vi++
      }

      // Front edge (yMin row, row=0)
      for (let i = 0; i < S; i++) {
        const wx = xMin + i * xStep
        const wz = yMin
        const wy = isFinite(zVals[i]) ? zVals[i] : 0
        setVert(wx, wy, wz); setVert(wx, 0, wz)
      }
      // Back edge (yMax row, row=SEGMENTS)
      for (let i = 0; i < S; i++) {
        const wx = xMin + i * xStep
        const wz = yMax
        const wy = isFinite(zVals[SEGMENTS * S + i]) ? zVals[SEGMENTS * S + i] : 0
        setVert(wx, wy, wz); setVert(wx, 0, wz)
      }
      // Left edge (xMin col, col=0)
      for (let j = 0; j < S; j++) {
        const wx = xMin
        const wz = yMin + j * yStep
        const wy = isFinite(zVals[j * S]) ? zVals[j * S] : 0
        setVert(wx, wy, wz); setVert(wx, 0, wz)
      }
      // Right edge (xMax col, col=SEGMENTS)
      for (let j = 0; j < S; j++) {
        const wx = xMax
        const wz = yMin + j * yStep
        const wy = isFinite(zVals[j * S + SEGMENTS]) ? zVals[j * S + SEGMENTS] : 0
        setVert(wx, wy, wz); setVert(wx, 0, wz)
      }

      skirtPosRef.current.needsUpdate = true
    }

    // ── Update Floor ────────────────────────────────────────────────────
    if (floorPosRef.current) {
      const fp = floorPosRef.current.array
      // PlaneGeometry 1x1 rotated has 4 verts:
      // (-0.5, 0, -0.5), (0.5, 0, -0.5), (-0.5, 0, 0.5), (0.5, 0, 0.5)
      fp[0] = xMin; fp[1] = 0; fp[2] = yMin
      fp[3] = xMax; fp[4] = 0; fp[5] = yMin
      fp[6] = xMin; fp[7] = 0; fp[8] = yMax
      fp[9] = xMax; fp[10] = 0; fp[11] = yMax
      floorPosRef.current.needsUpdate = true
    }
  }, [exprStr, extraVars, xMin, xMax, yMin, yMax, onVolumeCalculated])

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
          {showVolume && volumeEst != null && (
            <span className={styles.volumeBadge} title="Approximate volume under surface (double integral)">
              ∬ Volume ≈ {volumeEst.toFixed(2)}
            </span>
          )}
          {hoverCoord && (
            <span className={styles.coordBadge}>
              <span>x={hoverCoord.x}</span>
              <span>y={hoverCoord.y}</span>
              <span>z={hoverCoord.z}</span>
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
