/**
 * apiClient.js — fetch wrapper for the Pneuton backend API.
 *
 * Lambda HTTP API v2 wraps responses in a JSON envelope:
 *   { statusCode, headers, body: "<JSON string>" }
 * This client unwraps that envelope so consumers always get the inner object.
 *
 * Falls back to localSolve() for /solve when the backend is unreachable.
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
 * Unwrap a Lambda HTTP API response envelope.
 * If the response is already a plain object (direct API GW pass-through), return as-is.
 */
function unwrap(raw) {
  // Lambda proxy envelope: { statusCode, headers, body: string }
  if (raw && typeof raw.body === 'string' && typeof raw.statusCode === 'number') {
    let inner
    try { inner = JSON.parse(raw.body) } catch { inner = raw.body }
    if (!raw.statusCode.toString().startsWith('2')) {
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

async function post(path, body, { timeout = 15000 } = {}) {
  if (!BASE_URL) throw new ApiError('no_backend', 'VITE_API_BASE_URL is not set.', 0)

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
    try { raw = await response.json() } catch {
      throw new ApiError('parse_error', 'Server returned non-JSON response.', response.status)
    }

    if (!response.ok) {
      const inner = typeof raw.body === 'string' ? (() => { try { return JSON.parse(raw.body) } catch { return raw } })() : raw
      throw new ApiError(
        inner?.error || 'http_error',
        inner?.message || `HTTP ${response.status}`,
        response.status,
      )
    }

    return unwrap(raw)
  } finally {
    clearTimeout(timer)
  }
}

/** POST /solve — falls back to localSolve on any network / config failure */
export async function solve({ expr, operation, wrt = 'x', order = 1, bounds = null }) {
  if (!BASE_URL) return localSolve({ expr, operation, wrt, order, bounds })
  try {
    return await post('/solve', { expr, operation, wrt, order, bounds })
  } catch (e) {
    if (e.name === 'AbortError' || e.code === 'no_backend' ||
        (e instanceof TypeError && e.message.includes('fetch'))) {
      return localSolve({ expr, operation, wrt, order, bounds })
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
