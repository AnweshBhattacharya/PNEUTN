/**
 * RiemannControls — compact single-row layout.
 * Slider + sample point + results all in minimal vertical space.
 *
 * Bug fixes:
 *   B2 — Auto-triggers fetchRiemann on mount so rectangles appear immediately
 *   B9 — Clears sumData + error when exprStr or bounds prop changes (curve switch)
 */
import React, { useState, useRef, useEffect } from 'react'
import { riemann as callRiemann } from '../../lib/apiClient'
import LoadingBar from '../shared/LoadingBar'
import styles from './RiemannControls.module.css'

const SAMPLE_POINTS = ['left', 'midpoint', 'right']

export default function RiemannControls({ exprStr, bounds = [0, 4], onRectangles, onSumResult }) {
  const [open, setOpen] = useState(true)
  const [n, setN] = useState(8)
  const [samplePoint, setSamplePoint] = useState('midpoint')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [sumData, setSumData] = useState(null)
  const debounceRef = useRef(null)
  // Track whether we have done the initial fetch
  const didMountFetch = useRef(false)

  const fetchRiemann = async (nVal, sp, currentBounds) => {
    if (!exprStr) return
    setLoading(true); setError(null)
    try {
      const data = await callRiemann({ expr: exprStr, bounds: currentBounds ?? bounds, sub_intervals: nVal, sample_point: sp })
      onRectangles?.(data.rectangles)
      onSumResult?.({ riemann_sum: data.riemann_sum, exact_value: data.exact_value })
      setSumData(data)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // B2: Auto-trigger on mount (once exprStr is available)
  useEffect(() => {
    if (!exprStr) return
    if (didMountFetch.current) return
    didMountFetch.current = true
    fetchRiemann(n, samplePoint, bounds)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exprStr])

  // B9: Clear stale data when expression or bounds change (e.g. curve switch)
  const prevExprRef = useRef(exprStr)
  const prevBoundsRef = useRef(bounds)
  useEffect(() => {
    const exprChanged   = prevExprRef.current !== exprStr
    const boundsChanged = prevBoundsRef.current[0] !== bounds[0] || prevBoundsRef.current[1] !== bounds[1]
    prevExprRef.current   = exprStr
    prevBoundsRef.current = bounds

    if (exprChanged || boundsChanged) {
      // Clear stale Riemann display immediately
      setSumData(null)
      setError(null)
      onRectangles?.([])
      // Re-fetch with new expr / bounds after a small settle delay
      clearTimeout(debounceRef.current)
      if (exprStr) {
        debounceRef.current = setTimeout(() => {
          didMountFetch.current = true
          fetchRiemann(n, samplePoint, bounds)
        }, 300)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exprStr, bounds[0], bounds[1]])

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value, 10)
    setN(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchRiemann(val, samplePoint, bounds), 350)
  }

  const handleSampleChange = (sp) => { setSamplePoint(sp); fetchRiemann(n, sp, bounds) }

  const errorAbs = sumData?.exact_value != null
    ? Math.abs(sumData.riemann_sum - sumData.exact_value) : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}
        onClick={() => setOpen(o => !o)}
        role="button" aria-expanded={open} tabIndex={0}
        aria-controls="riemann-body"
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}>
        <span className={styles.headerTitle}>Riemann Sum</span>
        <span className={`${styles.headerChevron} ${open ? styles.headerChevronOpen : ''}`}>▼</span>
      </div>

      {open && (
        <div id="riemann-body" className={styles.body}>
          {/* Slider row */}
          <div className={styles.sliderRow}>
            <span className={styles.label}>n</span>
            <input type="range" min={1} max={200} value={n}
              onChange={handleSliderChange}
              className={styles.slider}
              aria-label={`Sub-intervals: ${n}`} />
            <span className={styles.nValue}>{n}</span>
          </div>

          {/* Sample point */}
          <div className={styles.sampleRow}>
            <span className={styles.label}>Sample</span>
            <div className={styles.pillGroup} role="group" aria-label="Sample point">
              {SAMPLE_POINTS.map(sp => (
                <button key={sp} type="button"
                  className={`${styles.pill} ${samplePoint === sp ? styles.pillActive : ''}`}
                  onClick={() => handleSampleChange(sp)}
                  aria-pressed={samplePoint === sp}>
                  {sp}
                </button>
              ))}
            </div>
          </div>

          {loading && <LoadingBar active label="Computing…" />}
          {error && <div className={styles.error} role="alert">{error}</div>}

          {sumData && !loading && (
            <div className={styles.results}>
              <div className={styles.resultRow}>
                <span className={styles.resultLabel}>Σ (n={n})</span>
                <span className={styles.resultValue}>{sumData.riemann_sum?.toFixed(5)}</span>
              </div>
              {sumData.exact_value != null && (
                <>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>Exact</span>
                    <span className={styles.resultValue}>{sumData.exact_value?.toFixed(5)}</span>
                  </div>
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>Error</span>
                    <span className={`${styles.resultValue} ${styles.resultDiff}`}>
                      {errorAbs?.toFixed(5)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
