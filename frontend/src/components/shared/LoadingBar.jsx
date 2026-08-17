/**
 * LoadingBar — thin progress bar with slow-fill animation.
 * Fills to ~80% over 4 s (cold-start window), then snaps to 100% on complete.
 */
import React, { useEffect, useRef } from 'react'
import styles from './LoadingBar.module.css'

export default function LoadingBar({ active = false, label = 'Computing…' }) {
  const barRef = useRef(null)

  useEffect(() => {
    if (!barRef.current) return
    const bar = barRef.current

    if (active) {
      bar.style.transition = 'none'
      bar.style.width = '0%'
      void bar.offsetWidth
      bar.style.transition = 'width 4s cubic-bezier(0.22, 1, 0.36, 1)'
      bar.style.width = '80%'
    } else {
      bar.style.transition = 'width 200ms ease-out'
      bar.style.width = '100%'
      const t = setTimeout(() => {
        bar.style.transition = 'none'
        bar.style.width = '0%'
      }, 300)
      return () => clearTimeout(t)
    }
  }, [active])

  if (!active) return null

  return (
    <div className={styles.wrapper} role="status" aria-label={label}>
      <div className={styles.track}>
        <div className={styles.bar} ref={barRef} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  )
}
