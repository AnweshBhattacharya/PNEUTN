/**
 * EquationPreview — live KaTeX render of the current expression.
 *
 * Shows a formatted "d/dx [ f(x) ]" or "∫ f(x) dx" preview that updates
 * on every keystroke.  Sits between the MathLive input and the controls.
 */
import React, { useMemo } from 'react'
import katex from 'katex'
import styles from './EquationPreview.module.css'

function buildDisplayLatex(latexExpr, operation, wrtSequence, integrationSequence) {
  if (!latexExpr) return null
  const inner = latexExpr

  if (operation === 'derivative') {
    if (!wrtSequence || wrtSequence.length === 0) return `\\frac{d}{dx}\\left[${inner}\\right]`
    
    if (wrtSequence.length === 1) {
      return `\\frac{d}{d${wrtSequence[0]}}\\left[${inner}\\right]`
    }
    
    const groups = []
    let current = wrtSequence[0]
    let count = 1
    for (let i = 1; i < wrtSequence.length; i++) {
      if (wrtSequence[i] === current) { count++ }
      else {
        groups.push({ v: current, c: count })
        current = wrtSequence[i]
        count = 1
      }
    }
    groups.push({ v: current, c: count })
    
    // For mixed partials, standard notation uses \partial
    const denom = groups.map(g => g.c === 1 ? `\\partial ${g.v}` : `\\partial ${g.v}^{${g.c}}`).join(' ')
    return `\\frac{\\partial^{${wrtSequence.length}}}{${denom}}\\left[${inner}\\right]`
  }

  // integral
  if (!integrationSequence || integrationSequence.length === 0) return `\\int \\left(${inner}\\right) \\, dx`

  let result = `\\left(${inner}\\right)`
  let pre = ""
  let post = ""
  
  // Outer integrals first in pre, inner first in post
  for (let i = integrationSequence.length - 1; i >= 0; i--) {
    const step = integrationSequence[i]
    if (step.boundsEnabled && step.boundLo !== '' && step.boundHi !== '') {
      pre += `\\int_{${step.boundLo}}^{${step.boundHi}} `
    } else {
      pre += `\\int `
    }
  }
  for (let i = 0; i < integrationSequence.length; i++) {
    post += ` \\, d${integrationSequence[i].wrt}`
  }
  return `${pre} ${result} ${post}`
}

export default function EquationPreview({
  latexExpr,
  operation,
  wrtSequence = ['x'],
  integrationSequence = [{ wrt: 'x', boundsEnabled: false, boundLo: '0', boundHi: '1' }],
}) {
  const { html, error } = useMemo(() => {
    const displayLatex = buildDisplayLatex(latexExpr, operation, wrtSequence, integrationSequence)
    if (!displayLatex) return { html: null, error: null }

    try {
      return {
        html: katex.renderToString(displayLatex, {
          displayMode: true,
          throwOnError: true,
          strict: false,
          trust: false,
          maxExpand: 1000,
        }),
        error: null,
      }
    } catch {
      try {
        return {
          html: katex.renderToString(latexExpr, {
            displayMode: true,
            throwOnError: false,
            strict: false,
            trust: false,
            maxExpand: 1000,
          }),
          error: null,
        }
      } catch {
        return { html: null, error: 'Cannot render expression' }
      }
    }
  }, [latexExpr, operation, wrtSequence, integrationSequence])

  let opLabel = ''
  if (operation === 'derivative') {
    if (!wrtSequence || wrtSequence.length <= 1) {
      opLabel = `d/d${wrtSequence?.[0] || 'x'}`
    } else {
      opLabel = `∂^${wrtSequence.length}/∂…`
    }
  } else {
    opLabel = integrationSequence?.length > 1 ? `${'∫'.repeat(integrationSequence.length)}` : `∫ d${integrationSequence?.[0]?.wrt || 'x'}`
  }

  return (
    <div className={`${styles.wrapper} ${html ? styles.hasContent : ''}`}>
      <span className={styles.label}>Preview</span>
      <span className={styles.opBadge}>{opLabel}</span>

      {html ? (
        <div
          key={html}
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
