/**
 * apiClient.js — fetch wrapper for the Pneutn backend API.
 *
 * Lambda HTTP API v2 passes responses directly (not wrapped in an envelope)
 * when the integration is configured correctly. This client handles both the
 * direct JSON case and the legacy Lambda proxy envelope just in case.
 *
 * Fallback behaviour:
 *   - /solve falls back to localSolve() ONLY when the backend is genuinely
 *     unreachable (no VITE_API_BASE_URL, DNS failure, network timeout).
 *   - CORS errors and 4xx/5xx responses are surfaced as ApiError — they should
 *     not be silently swallowed, they indicate a real configuration problem.
 */
import { localSolve } from './localSolve'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/**
 * Unwrap a Lambda proxy envelope if present.
 * HTTP API v2 with direct Lambda integration returns the object directly,
 * but proxy integrations wrap it in { statusCode, headers, body: string }.
 */
function unwrap(raw) {
  if (raw && typeof raw.body === 'string' && typeof raw.statusCode === 'number') {
    let inner
    try { inner = JSON.parse(raw.body) } catch { inner = { message: raw.body } }
    if (!String(raw.statusCode).startsWith('2')) {
      throw new ApiError(
        inner?.error || 'http_error',
        inner?.message || `HTTP ${raw.statusCode}`,
        raw.statusCode,
      )
    }
    return inner
  }
  return raw
}

async function post(path, body, { timeout = 25000 } = {}) {
  if (!BASE_URL) {
    throw new ApiError('no_backend', 'VITE_API_BASE_URL is not configured.', 0)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    let raw
    try {
      raw = await response.json()
    } catch {
      throw new ApiError(
        'parse_error',
        `Server returned non-JSON (HTTP ${response.status}). Check VITE_API_BASE_URL.`,
        response.status,
      )
    }

    if (!response.ok) {
      const inner = typeof raw?.body === 'string'
        ? (() => { try { return JSON.parse(raw.body) } catch { return raw } })()
        : raw
      throw new ApiError(
        inner?.error || 'http_error',
        inner?.message || `HTTP ${response.status}`,
        response.status,
      )
    }

    return unwrap(raw)
  } catch (err) {
    clearTimeout(timer)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * POST /solve
 * Falls back to localSolve ONLY when backend is completely unreachable
 * (no URL configured, AbortError from timeout, or DNS/network failure).
 * CORS errors and server errors are surfaced as real errors.
 */
export async function solve({
  expr,
  operation,
  wrt = 'x',
  order = 1,
  bounds = null,
  wrt_sequence,
  integration_sequence,
  wrtSequence,
  integrationSequence,
  dep_vars,
}) {
  const actualWrtSeq = wrt_sequence || wrtSequence
  const actualIntSeq = integration_sequence || integrationSequence

  if (!BASE_URL) {
    console.warn('[apiClient] VITE_API_BASE_URL not set — using local solver')
    return localSolve({
      expr,
      operation,
      wrt,
      order,
      bounds,
      wrt_sequence: actualWrtSeq,
      wrtSequence: actualWrtSeq,
      integration_sequence: actualIntSeq,
      integrationSequence: actualIntSeq,
    })
  }
  try {
    return await post('/solve', {
      expr,
      operation,
      wrt,
      order,
      bounds,
      wrt_sequence: actualWrtSeq,
      integration_sequence: actualIntSeq,
      dep_vars,
    })
  } catch (e) {
    // Only fall back on genuine network unavailability
    const isUnreachable =
      e.name === 'AbortError' ||
      e.code === 'no_backend' ||
      (e instanceof TypeError && /fetch|network|failed/i.test(e.message))
    if (isUnreachable) {
      console.warn('[apiClient] Backend unreachable — using local solver:', e.message)
      return {
        ...localSolve({
          expr,
          operation,
          wrt,
          order,
          bounds,
          wrt_sequence: actualWrtSeq,
          wrtSequence: actualWrtSeq,
          integration_sequence: actualIntSeq,
          integrationSequence: actualIntSeq,
        }),
        _local: true,
      }
    }
    throw e
  }
}

import { compileExpr, evalAt } from './mathEval'

function localRiemann({ expr, bounds, sub_intervals, sample_point = 'midpoint' }) {
  const [a, b] = bounds || [0, 4]
  const n = Math.max(1, Math.min(parseInt(sub_intervals, 10) || 8, 200))
  const dx = (b - a) / n
  const compiled = compileExpr(expr)
  const rectangles = []
  let riemann_sum = 0

  for (let i = 0; i < n; i++) {
    const x0 = a + i * dx
    const x1 = x0 + dx
    const sample_x = sample_point === 'left' ? x0 : sample_point === 'right' ? x1 : (x0 + x1) / 2
    const y = evalAt(compiled, { x: sample_x }) ?? 0
    rectangles.push({
      x0: parseFloat(x0.toFixed(8)),
      x1: parseFloat(x1.toFixed(8)),
      height: parseFloat(y.toFixed(8)),
    })
    riemann_sum += y * dx
  }

  return {
    rectangles,
    riemann_sum: parseFloat(riemann_sum.toFixed(8)),
    exact_value: null,
    _local: true,
  }
}

function localIntegralOrder({ curve_upper, curve_lower, order = 'dy_dx' }) {
  const compUpper = compileExpr(curve_upper)
  const compLower = compileExpr(curve_lower)

  // Find numerical intersections by scanning [-6, 6]
  const searchMin = -6
  const searchMax = 6
  const scanSteps = 240
  const scanDx = (searchMax - searchMin) / scanSteps
  const roots = []
  let prevDiff = null
  let prevX = null

  if (compUpper && compLower) {
    for (let i = 0; i <= scanSteps; i++) {
      const x = searchMin + i * scanDx
      const yu = evalAt(compUpper, { x })
      const yl = evalAt(compLower, { x })
      if (yu == null || yl == null) continue
      const diff = yu - yl
      if (Math.abs(diff) < 1e-4) {
        roots.push([parseFloat(x.toFixed(4)), parseFloat(yu.toFixed(4))])
      } else if (prevDiff !== null && Math.sign(diff) !== Math.sign(prevDiff)) {
        const rootX = prevX + (-prevDiff / (diff - prevDiff)) * (x - prevX)
        const rootY = evalAt(compUpper, { x: rootX }) ?? 0
        roots.push([parseFloat(rootX.toFixed(4)), parseFloat(rootY.toFixed(4))])
      }
      prevDiff = diff
      prevX = x
    }
  }

  // Deduplicate close roots
  const intersections = []
  roots.forEach(([rx, ry]) => {
    if (!intersections.some(([ix]) => Math.abs(ix - rx) < 0.05)) {
      intersections.push([rx, ry])
    }
  })

  let x_lo = 0
  let x_hi = 1
  if (intersections.length >= 2) {
    x_lo = Math.min(intersections[0][0], intersections[1][0])
    x_hi = Math.max(intersections[0][0], intersections[1][0])
  } else if (intersections.length === 1) {
    x_lo = intersections[0][0]
    x_hi = x_lo + 1
  }

  if (Math.abs(x_hi - x_lo) < 1e-3) {
    x_lo = 0
    x_hi = 1
  }

  const n_pts = 40
  const upper_pts = []
  const lower_pts = []
  const step = (x_hi - x_lo) / (n_pts - 1)

  for (let i = 0; i < n_pts; i++) {
    const x = x_lo + i * step
    const yu = evalAt(compUpper, { x }) ?? x
    const yl = evalAt(compLower, { x }) ?? (x * x)
    upper_pts.push([parseFloat(x.toFixed(6)), parseFloat(yu.toFixed(6))])
    lower_pts.push([parseFloat(x.toFixed(6)), parseFloat(yl.toFixed(6))])
  }

  const region_vertices = upper_pts.concat(lower_pts.slice().reverse())
  const finalIntersections = intersections.length > 0 ? intersections : [[x_lo, x_lo], [x_hi, x_hi]]

  const fmtLo = Number.isInteger(x_lo) ? String(x_lo) : x_lo.toFixed(2)
  const fmtHi = Number.isInteger(x_hi) ? String(x_hi) : x_hi.toFixed(2)

  const bounds_latex = order === 'dy_dx'
    ? `\\int_{${fmtLo}}^{${fmtHi}} \\int_{${curve_lower}}^{${curve_upper}} \\, dy \\, dx`
    : `\\int_{${fmtLo}}^{${fmtHi}} \\int_{${curve_upper}}^{${curve_lower}} \\, dx \\, dy`

  return {
    intersections: finalIntersections,
    bounds_latex,
    region_vertices,
    sweep_axis: order === 'dy_dx' ? 'y' : 'x',
    _local: true,
  }
}

/** POST /riemann with offline fallback */
export async function riemann({ expr, bounds, sub_intervals, sample_point = 'midpoint' }) {
  if (!BASE_URL) {
    return localRiemann({ expr, bounds, sub_intervals, sample_point })
  }
  try {
    return await post('/riemann', { expr, bounds, sub_intervals, sample_point })
  } catch (e) {
    const isUnreachable =
      e.name === 'AbortError' ||
      e.code === 'no_backend' ||
      (e instanceof TypeError && /fetch|network|failed/i.test(e.message))
    if (isUnreachable) {
      return localRiemann({ expr, bounds, sub_intervals, sample_point })
    }
    throw e
  }
}

/** POST /integral-order with offline fallback */
export async function integralOrder({ curve_upper, curve_lower, order }) {
  if (!BASE_URL) {
    return localIntegralOrder({ curve_upper, curve_lower, order })
  }
  try {
    return await post('/integral-order', { curve_upper, curve_lower, order })
  } catch (e) {
    const isUnreachable =
      e.name === 'AbortError' ||
      e.code === 'no_backend' ||
      (e instanceof TypeError && /fetch|network|failed/i.test(e.message))
    if (isUnreachable) {
      return localIntegralOrder({ curve_upper, curve_lower, order })
    }
    throw e
  }
}
