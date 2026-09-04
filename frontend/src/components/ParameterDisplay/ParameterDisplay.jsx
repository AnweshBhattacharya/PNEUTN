import React from 'react'
import styles from './ParameterDisplay.module.css'

/**
 * ParameterDisplay — absolutely-positioned overlay in the top-right corner
 * of the graph canvas area. Shows current viewport x/y range and any active
 * free-parameter values.
 *
 * Props:
 *   xRange:       [number, number]
 *   yRange:       [number, number]
 *   paramValues:  Record<string, number>
 */
export default function ParameterDisplay({ xRange = [-10, 10], yRange = [-10, 10], paramValues = {} }) {
  const entries = Object.entries(paramValues)

  return (
    <div className={styles.overlay} aria-label="Current viewport and parameter values">
      <div className={styles.row}>
        <span className={styles.key}>x</span>
        <span className={styles.val}>[{xRange[0]}, {xRange[1]}]</span>
      </div>
      <div className={styles.row}>
        <span className={styles.key}>y</span>
        <span className={styles.val}>[{yRange[0]}, {yRange[1]}]</span>
      </div>
      {entries.map(([name, value]) => (
        <div key={name} className={styles.row}>
          <span className={styles.key}>{name}</span>
          <span className={styles.val}>{Number(value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}
