/**
 * StepPanel — step-by-step solution with KaTeX + substeps + Gemini narration.
 * Each step is collapsible. Substeps show rule details inline.
 * Steps animate in with stagger.
 * Includes Copy LaTeX button for result (U5).
 */
import React, { useState } from 'react'
import katex from 'katex'
import styles from './StepPanel.module.css'

export function KatexDisplay({ latex, block = false }) {
  if (!latex) return null
  let html = ''
  try {
    html = katex.renderToString(latex, {
      displayMode: block,
      throwOnError: false,
      strict: false,
      trust: false,
      maxExpand: 1000,
    })
  } catch {
    return <span className={styles.rawLatex}>{latex}</span>
  }
  return (
    <span
      className={block ? styles.katexBlock : styles.katexInline}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function SubSteps({ substeps }) {
  if (!substeps?.length) return null
  return (
    <div className={styles.substeps}>
      {substeps.map((s, i) => (
        <div key={i} className={styles.substep}>
          <span className={styles.substepLabel}>{s.label}</span>
          <span className={styles.substepEq}>=</span>
          <span className={styles.substepValue}>
            <KatexDisplay latex={s.value} />
          </span>
        </div>
      ))}
    </div>
  )
}

function StepItem({ step, index }) {
  const [open, setOpen] = useState(true)

  const ruleName = step.rule?.replace(/_/g, ' ') ?? ''

  return (
    <li className={styles.step} style={{ animationDelay: `${index * 55}ms` }}>
      <button
        className={styles.stepHeader}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        type="button"
      >
        <div className={styles.stepMeta}>
          <span className={styles.stepNum}>Step {index + 1}</span>
          <span className={styles.ruleChip}>{ruleName}</span>
          <span className={`${styles.narratedBy} ${step.narrated_by === 'gemini' ? styles.gemini : styles.fallback}`}>
            {step.narrated_by === 'gemini' ? '✦ Gemini' : '⚙ Template'}
          </span>
          {step.substeps?.length > 0 && (
            <span className={styles.subChip}>{step.substeps.length} sub-steps</span>
          )}
        </div>
        <span className={`${styles.stepChevron} ${open ? styles.stepChevronOpen : ''}`}>▼</span>
      </button>

      {open && (
        <div className={styles.stepBody}>
          {/* Before → After transformation */}
          <div className={styles.transformation}>
            <div className={styles.transformRow}>
              <span className={styles.transformLabel}>Before</span>
              <div className={styles.katexWrap}>
                <KatexDisplay latex={step.before_latex} block />
              </div>
            </div>

            <div className={styles.arrowRow}>
              <span className={styles.arrow}>↓</span>
              <span className={styles.arrowLabel}>{ruleName}</span>
            </div>

            <div className={styles.transformRow}>
              <span className={styles.transformLabel}>After</span>
              <div className={styles.katexWrap}>
                <KatexDisplay latex={step.after_latex} block />
              </div>
            </div>
          </div>

          {/* Sub-steps (e.g. per-term, chain rule decomposition) */}
          <SubSteps substeps={step.substeps} />

          {/* English explanation */}
          {step.explanation && (
            <p className={styles.explanation}>{step.explanation}</p>
          )}
        </div>
      )}
    </li>
  )
}

export default function StepPanel({ result, steps = [], loading, error, isLocal }) {
  const isEmpty = !loading && !result && steps.length === 0 && !error
  const [copied, setCopied] = useState(false)

  const copyResult = () => {
    if (!result) return
    navigator.clipboard?.writeText(result).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span>Solution</span>
        <div className={styles.headerRight}>
          {isLocal && (
            <span className={styles.localBadge} title="Backend unreachable — using local math.js solver">
              local mode
            </span>
          )}
          {loading && <span className={styles.computingBadge}>computing…</span>}
          {steps.length > 0 && !loading && (
            <span className={styles.stepCount}>{steps.length} steps</span>
          )}
        </div>
      </div>

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className={styles.skeleton}>
          <div className={`${styles.skeletonBox} ${styles.skeletonResult}`} />
          {[0, 1, 2].map(i => (
            <div key={i} className={styles.skeletonStep} style={{ animationDelay: `${i * 120}ms` }}>
              <div className={styles.skeletonLine} style={{ width: '40%' }} />
              <div className={styles.skeletonLine} style={{ width: '70%' }} />
              <div className={styles.skeletonLine} style={{ width: '55%' }} />
            </div>
          ))}
        </div>
      )}

      {isEmpty && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>∫</div>
          <p className={styles.emptyText}>
            Enter an expression above and press Solve to see step-by-step working.
          </p>
        </div>
      )}

      {error && (
        <div className={styles.errorBox} role="alert">
          <span className={styles.errorCode}>Error</span>
          <span className={styles.errorMsg}>{error}</span>
        </div>
      )}

      {result && !loading && (
        <div className={styles.resultBox}>
          <div className={styles.resultHeader}>
            <span className={styles.resultLabel}>Result</span>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={copyResult}
              aria-label="Copy LaTeX result"
              title="Copy LaTeX result"
            >
              {copied ? 'Copied!' : 'Copy LaTeX'}
            </button>
          </div>
          <div className={styles.resultLatex}>
            <KatexDisplay latex={result} block />
          </div>
        </div>
      )}

      {steps.length > 0 && !loading && (
        <ol className={styles.stepList} aria-label="Solution steps">
          {steps.map((step, i) => (
            <StepItem key={i} step={step} index={i} />
          ))}
        </ol>
      )}
    </div>
  )
}
