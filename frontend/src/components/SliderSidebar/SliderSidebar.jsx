import React from 'react'
import styles from './SliderSidebar.module.css'

/**
 * DualRangeSlider — two overlapping <input type="range"> elements sharing one track.
 * value = [lo, hi]; onChange receives [lo, hi].
 */
function DualRangeSlider({ label, min = -20, max = 20, value, onChange, step = 0.5 }) {
  const lo = value[0]
  const hi = value[1]
  const range = max - min

  return (
    <div className={styles.dualSlider}>
      <span className={styles.sliderLabel}>{label}</span>
      <div className={styles.trackWrap}>
        <input
          type="range"
          min={min} max={max} step={step}
          value={lo}
          onChange={e => onChange([Math.min(Number(e.target.value), hi - step), hi])}
          className={styles.rangeThumbLo}
          aria-label={`${label} minimum`}
        />
        <input
          type="range"
          min={min} max={max} step={step}
          value={hi}
          onChange={e => onChange([lo, Math.max(Number(e.target.value), lo + step)])}
          className={styles.rangeThumbHi}
          aria-label={`${label} maximum`}
        />
        <div
          className={styles.trackFill}
          style={{
            '--lo': (lo - min) / range,
            '--hi': (hi - min) / range,
          }}
        />
      </div>
      <div className={styles.rangeValues}>
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  )
}

/**
 * ParameterSlider — single-handle slider for a detected free parameter.
 */
function ParameterSlider({ name, value, min = -5, max = 5, onChange }) {
  return (
    <div className={styles.paramSlider}>
      <div className={styles.paramHeader}>
        <span className={styles.paramName}>{name}</span>
        <span className={styles.paramValue}>{Number(value).toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={0.01}
        value={value}
        onChange={e => onChange(name, Number(e.target.value))}
        className={styles.singleRange}
        aria-label={`Parameter ${name}`}
      />
    </div>
  )
}

/**
 * SliderSidebar — controlled component. All values live in App state.
 *
 * Props:
 *   xRange:           [number, number]
 *   yRange:           [number, number]
 *   onXRangeChange:   ([min, max]) => void
 *   onYRangeChange:   ([min, max]) => void
 *   freeParams:       { name: string, value: number }[]
 *   onParamChange:    (name: string, value: number) => void
 */
export default function SliderSidebar({
  xRange = [-10, 10],
  yRange = [-10, 10],
  onXRangeChange,
  onYRangeChange,
  freeParams = [],
  onParamChange,
}) {
  return (
    <aside className={styles.sidebar}>
      <span className={styles.sidebarTitle}>Viewport</span>

      <DualRangeSlider
        label="X"
        min={-20} max={20}
        value={xRange}
        onChange={onXRangeChange}
      />

      <DualRangeSlider
        label="Y"
        min={-20} max={20}
        value={yRange}
        onChange={onYRangeChange}
      />

      {freeParams.length > 0 && (
        <>
          <span className={styles.sidebarTitle} style={{ marginTop: 12 }}>Parameters</span>
          {freeParams.map(({ name, value }) => (
            <ParameterSlider
              key={name}
              name={name}
              value={value}
              onChange={onParamChange}
            />
          ))}
        </>
      )}
    </aside>
  )
}
