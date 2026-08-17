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
export async function solve({ expr, operation, wrt = 'x', order = 1, bounds = null }) {
  if (!BASE_URL) {
    console.warn('[apiClient] VITE_API_BASE_URL not set — using local solver')
    return localSolve({ expr, operation, wrt, order, bounds })
  }
  try {
    return await post('/solve', { expr, operation, wrt, order, bounds })
  } catch (e) {
    // Only fall back on genuine network unavailability
    const isUnreachable =
      e.name === 'AbortError' ||
      e.code === 'no_backend' ||
      (e instanceof TypeError && /fetch|network|failed/i.test(e.message))
    if (isUnreachable) {
      console.warn('[apiClient] Backend unreachable — using local solver:', e.message)
      return { ...localSolve({ expr, operation, wrt, order, bounds }), _local: true }
    }
    throw e
  }
}

/** POST /riemann */
export async function riemann({ expr, bounds, sub_intervals, sample_point = 'midpoint' }) {
  return post('/riemann', { expr, bounds, sub_intervals, sample_point })
}

/** POST /integral-order */
export async function integralOrder({ curve_upper, curve_lower, order }) {
  return post('/integral-order', { curve_upper, curve_lower, order })
}
