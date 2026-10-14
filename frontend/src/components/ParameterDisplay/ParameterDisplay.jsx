import React from 'react'
import styles from './ParameterDisplay.module.css'

/**
 * ParameterDisplay — absolutely-positioned overlay in the top-right corner
 * of the graph canvas area. Shows active free-parameter values.
 *
 * Props:
 *   paramValues:  Record<string, number>
 */
export default function ParameterDisplay({ paramValues = {} }) {
  const entries = Object.entries(paramValues)
  if (entries.length === 0) return null

  return (
    <div className={styles.overlay} aria-label="Current parameter values">
      {entries.map(([name, value]) => (
        <div key={name} className={styles.row}>
          <span className={styles.key}>{name}</span>
          <span className={styles.val}>{Number(value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}
