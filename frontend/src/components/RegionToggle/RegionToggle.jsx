/**
 * RegionToggle — order-of-integration toggle for two-curve bounded regions.
 * Uses pill toggles instead of dropdowns. Collapsible panel.
 * Supports curves prop to easily populate from active equations list (U2).
 */
import React, { useState, useRef } from 'react'
import katex from 'katex'
import { integralOrder } from '../../lib/apiClient'
import LoadingBar from '../shared/LoadingBar'
import styles from './RegionToggle.module.css'

export default function RegionToggle({ curves = [], onRegionData }) {
  const [open, setOpen] = useState(false)
  const [curveUpper, setCurveUpper] = useState('x')
  const [curveLower, setCurveLower] = useState('x^2')
  const [order, setOrder] = useState('dy_dx')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [sweeping, setSweeping] = useState(false)
  const sweepTimerRef = useRef(null)

  const fetchOrder = async (newOrder) => {
    if (!curveUpper || !curveLower) return
    setLoading(true)
    setError(null)
    try {
      const data = await integralOrder({ curve_upper: curveUpper, curve_lower: curveLower, order: newOrder })
      setResult(data)
      onRegionData?.(data)
      setSweeping(true)
      clearTimeout(sweepTimerRef.current)
      sweepTimerRef.current = setTimeout(() => setSweeping(false), 1200)
    } catch (e) {
      setError(e.message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const handleOrderChange = (newOrder) => {
    setOrder(newOrder)
    if (result) fetchOrder(newOrder)
  }

  const boundsHtml = result?.bounds_latex
    ? (() => {
        try {
          return katex.renderToString(result.bounds_latex, {
            displayMode: true,
            throwOnError: false,
            trust: false,
            maxExpand: 1000,
          })
        } catch { return null }
      })()
    : null

  const validCurves = curves.filter(c => c && c.expr)

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.header}
        onClick={() => setOpen(o => !o)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        aria-controls="region-toggle-body"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
      >
        <span className={styles.headerTitle}>Region &amp; Integration Order</span>
        <span className={`${styles.headerChevron} ${open ? styles.headerChevronOpen : ''}`}>▼</span>
      </div>

      {open && (
        <div id="region-toggle-body" className={styles.body}>
          <p className={styles.hint}>
            Two curves as functions of x — region needs intersection points.
          </p>

          {validCurves.length >= 2 && (
            <div className={styles.curveShortcuts}>
              <span className={styles.label}>Use curve:</span>
              {validCurves.slice(0, 4).map((c, i) => (
                <button
                  key={c.id || i}
                  type="button"
                  className={styles.curveChip}
                  onClick={() => {
                    if (curveUpper === c.expr) {
                      setCurveLower(c.expr)
                    } else {
                      setCurveUpper(c.expr)
                    }
                  }}
                  title={`Click to set as upper/lower curve: ${c.expr}`}
                >
                  {c.expr.length > 8 ? c.expr.slice(0, 8) + '…' : c.expr}
                </button>
              ))}
            </div>
          )}

          <div className={styles.curveRow}>
            <div className={styles.curveInput}>
              <label className={styles.label} htmlFor="curve-upper">Upper y =</label>
              <input
                id="curve-upper"
                type="text"
                value={curveUpper}
                onChange={e => setCurveUpper(e.target.value)}
                className={styles.input}
                placeholder="x"
              />
            </div>
            <div className={styles.curveInput}>
              <label className={styles.label} htmlFor="curve-lower">Lower y =</label>
              <input
                id="curve-lower"
                type="text"
                value={curveLower}
                onChange={e => setCurveLower(e.target.value)}
                className={styles.input}
                placeholder="x^2"
              />
            </div>
          </div>

          <div className={styles.actionRow}>
            <button
              className={styles.computeBtn}
              onClick={() => fetchOrder(order)}
              disabled={loading}
              type="button"
            >
              Compute Region
            </button>

            <div className={styles.orderToggle}>
              <span className={styles.orderLabel}>Order:</span>
              <div className={styles.orderPills} role="group" aria-label="Integration order">
                {[
                  { value: 'dy_dx', label: 'dy dx' },
                  { value: 'dx_dy', label: 'dx dy' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.orderPill} ${order === opt.value ? styles.orderPillActive : ''}`}
                    onClick={() => handleOrderChange(opt.value)}
                    disabled={loading}
                    aria-pressed={order === opt.value}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && <LoadingBar active label="Computing bounds…" />}
          {error && <div className={styles.error} role="alert">{error}</div>}

          {result && !loading && (
            <>
              <div className={`${styles.sweepBlock} ${sweeping ? styles.sweeping : ''}`}>
                <span className={styles.sweepAxis}>
                  Sweeping: {result.sweep_axis?.toUpperCase() || '—'}
                </span>
                <div className={styles.sweepStrips}>
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className={styles.strip}
                      style={sweeping ? { animationDelay: `${i * 0.07}s` } : undefined}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.intersections}>
                <span className={styles.label}>Intersections</span>
                <div className={styles.intPoints}>
                  {result.intersections?.map(([x, y], i) => (
                    <span key={i} className={styles.intPoint}>
                      ({x.toFixed(3)}, {y.toFixed(3)})
                    </span>
                  ))}
                </div>
              </div>

              {boundsHtml && (
                <div className={styles.boundsBlock}>
                  <span className={styles.label}>Integral bounds</span>
                  <div
                    className={styles.latexRender}
                    dangerouslySetInnerHTML={{ __html: boundsHtml }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
