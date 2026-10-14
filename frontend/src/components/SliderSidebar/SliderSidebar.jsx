import React from 'react'
import styles from './SliderSidebar.module.css'

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
 * SliderSidebar — free-parameter sliders only.
 * Displays sliders for detected free parameters.
 *
 * Props:
 *   freeParams:    { name: string, value: number }[]
 *   onParamChange: (name: string, value: number) => void
 */
export default function SliderSidebar({
  freeParams = [],
  onParamChange,
}) {
  if (freeParams.length === 0) return null

  return (
    <aside className={styles.sidebar}>
      <span className={styles.sidebarTitle}>Parameters</span>
      {freeParams.map(({ name, value }) => (
        <ParameterSlider
          key={name}
          name={name}
          value={value}
          onChange={onParamChange}
        />
      ))}
    </aside>
  )
}
