/**
 * EquationPreview — live KaTeX render of the current expression.
 *
 * Shows a formatted "d/dx [ f(x) ]" or "∫ f(x) dx" preview that updates
 * on every keystroke.  Sits between the MathLive input and the controls.
 */
import React, { useMemo } from 'react'
import katex from 'katex'
import styles from './EquationPreview.module.css'

function buildDisplayLatex(latexExpr, operation, wrt, order, boundsEnabled, boundLo, boundHi) {
  if (!latexExpr) return null

  const inner = latexExpr

  if (operation === 'derivative') {
    if (order === 1) {
      return `\\frac{d}{d${wrt}}\\left[${inner}\\right]`
    }
    return `\\frac{d^{${order}}}{d${wrt}^{${order}}}\\left[${inner}\\right]`
  }

  // integral
  if (boundsEnabled && boundLo !== '' && boundHi !== '') {
    return `\\int_{${boundLo}}^{${boundHi}} \\left(${inner}\\right) \\, d${wrt}`
  }
  return `\\int \\left(${inner}\\right) \\, d${wrt}`
}

export default function EquationPreview({
  latexExpr,      // raw latex string from MathLive
  operation,
  wrt,
  order,
  boundsEnabled,
  boundLo,
  boundHi,
}) {
  const { html, error } = useMemo(() => {
    const displayLatex = buildDisplayLatex(latexExpr, operation, wrt, order, boundsEnabled, boundLo, boundHi)
    if (!displayLatex) return { html: null, error: null }

    try {
      return {
        html: katex.renderToString(displayLatex, {
          displayMode: true,
          throwOnError: true,
          strict: false,
        }),
        error: null,
      }
    } catch (e) {
      // KaTeX parse error — try without the wrapper
      try {
        return {
          html: katex.renderToString(latexExpr, {
            displayMode: true,
            throwOnError: false,
            strict: false,
          }),
          error: null,
        }
      } catch {
        return { html: null, error: 'Cannot render expression' }
      }
    }
  }, [latexExpr, operation, wrt, order, boundsEnabled, boundLo, boundHi])

  const opLabel = operation === 'derivative'
    ? `d${order > 1 ? `${order}` : ''}/d${wrt}${order > 1 ? `${order}` : ''}`
    : `∫ d${wrt}`

  return (
    <div className={`${styles.wrapper} ${html ? styles.hasContent : ''}`}>
      <span className={styles.label}>Preview</span>
      <span className={styles.opBadge}>{opLabel}</span>

      {html ? (
        <div
          key={html} // key change triggers the CSS animation
          className={styles.display}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : error ? (
        <p className={styles.parseError}>{error}</p>
      ) : (
        <p className={styles.placeholder}>type an expression above…</p>
      )}
    </div>
  )
}
