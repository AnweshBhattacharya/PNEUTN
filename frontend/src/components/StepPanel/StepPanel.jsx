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

/**
 * VectorResult — renders gradient / curl results as a components table.
 * For divergence (no components), falls back to the scalar result box.
 */
function VectorResult({ operationType, components, result }) {
  const opLabel = {
    gradient: '\u2207f',
    curl: '\u2207 \u00d7 F',
    divergence: '\u2207 \u00b7 F',
  }[operationType] ?? 'Result'

  if (operationType === 'divergence' || !components?.length) {
    // Scalar result
    return (
      <div className={styles.vectorBox}>
        <span className={styles.vectorLabel}>{opLabel} =</span>
        <div className={styles.resultLatex}>
          <KatexDisplay latex={result} block />
        </div>
      </div>
    )
  }

  // Column vector: one row per component
  return (
    <div className={styles.vectorBox}>
      <span className={styles.vectorLabel}>{opLabel}</span>
      <table className={styles.vectorTable}>
        <tbody>
          {components.map(({ var: v, latex: ltx }) => (
            <tr key={v} className={styles.vectorRow}>
              <td className={styles.vectorVar}>∂f/∂{v}</td>
              <td className={styles.vectorEquals}>=</td>
              <td className={styles.vectorVal}><KatexDisplay latex={ltx} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepItem({ step, index }) {
  const [showExplanation, setShowExplanation] = useState(false)

  const ruleName = step.rule?.replace(/_/g, ' ') ?? ''
  const bodyId = `step-body-${index}`
  const hasDetail = step.explanation || step.before_latex || step.substeps?.length > 0

  return (
    <li
      className={styles.step}
      style={{ animationDelay: `${index * 40}ms` }}
      onMouseEnter={() => hasDetail && setShowExplanation(true)}
      onMouseLeave={() => setShowExplanation(false)}
    >
      {/* ── Compact card row ── */}
      <div className={styles.stepRow}>
        <span className={styles.stepNum}>{index + 1}</span>
        <span className={styles.ruleChip}>{ruleName}</span>
        <span className={styles.stepEquals}>=</span>
        <div className={styles.stepResult}>
          <KatexDisplay latex={step.after_latex} block={false} />
        </div>
        {hasDetail && (
          <button
            className={`${styles.stepInfoBtn} ${showExplanation ? styles.stepInfoBtnActive : ''}`}
            type="button"
            aria-expanded={showExplanation}
            aria-controls={bodyId}
            onClick={e => { e.stopPropagation(); setShowExplanation(v => !v) }}
            title="Explanation"
          >
            <span className={`${styles.narratedBy} ${step.narrated_by === 'gemini' ? styles.gemini : styles.fallback}`}>
              {step.narrated_by === 'gemini' ? '✦' : '⚙'}
            </span>
          </button>
        )}
      </div>

      {/* ── Explanation — always in DOM, height-animated via CSS class ── */}
      <div
        id={bodyId}
        className={`${styles.stepExplanation} ${showExplanation ? styles.stepExplanationVisible : ''}`}
        aria-hidden={!showExplanation}
      >
        {step.before_latex && (
          <div className={styles.stepBeforeRow}>
            <span className={styles.transformLabel}>from</span>
            <KatexDisplay latex={step.before_latex} block={false} />
          </div>
        )}
        {step.explanation && (
          <p className={styles.explanation}>{step.explanation}</p>
        )}
        {step.substeps?.length > 0 && (
          <SubSteps substeps={step.substeps} />
        )}
      </div>
    </li>
  )
}

export default function StepPanel({ result, steps = [], loading, error, isLocal, operationType, components }) {
  const isEmpty = !loading && !result && steps.length === 0 && !error
  const [copied, setCopied] = useState(false)

  const copyResult = () => {
    if (!result) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(result)
        .then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
        .catch(() => {})
    }
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
        operationType && ['gradient', 'curl', 'divergence'].includes(operationType)
          ? <VectorResult operationType={operationType} components={components} result={result} />
          : (
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
          )
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
