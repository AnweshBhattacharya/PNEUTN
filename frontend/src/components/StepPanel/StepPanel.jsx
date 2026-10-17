/**
 * StepPanel — step-by-step solution with KaTeX + substeps + Gemini narration.
 * Improvements: click-to-pin steps, color-coded rule chips, before/after highlighting.
 */
import React, { useState } from 'react'
import katex from 'katex'
import styles from './StepPanel.module.css'

// Color palette for each calculus rule type
const RULE_COLORS = {
  power_rule:           { bg: 'hsl(217 91% 60% / 0.15)', border: 'hsl(217 91% 55%)', text: 'hsl(217 80% 65%)' },
  power_rule_integral:  { bg: 'hsl(217 91% 60% / 0.15)', border: 'hsl(217 91% 55%)', text: 'hsl(217 80% 65%)' },
  chain_rule:           { bg: 'hsl(262 83% 60% / 0.15)', border: 'hsl(262 83% 58%)', text: 'hsl(262 72% 68%)' },
  product_rule:         { bg: 'hsl(38 92% 50% / 0.15)',  border: 'hsl(38 92% 50%)',  text: 'hsl(38 85% 58%)' },
  quotient_rule:        { bg: 'hsl(24 95% 53% / 0.15)',  border: 'hsl(24 95% 50%)',  text: 'hsl(24 88% 58%)' },
  sum_rule:             { bg: 'hsl(172 66% 50% / 0.15)', border: 'hsl(172 66% 45%)', text: 'hsl(172 55% 55%)' },
  sum_rule_integral:    { bg: 'hsl(172 66% 50% / 0.15)', border: 'hsl(172 66% 45%)', text: 'hsl(172 55% 55%)' },
  constant_factor:      { bg: 'hsl(199 89% 48% / 0.15)', border: 'hsl(199 89% 45%)', text: 'hsl(199 78% 55%)' },
  trig_rule:            { bg: 'hsl(346 77% 55% / 0.15)', border: 'hsl(346 77% 52%)', text: 'hsl(346 65% 62%)' },
  trig_integral:        { bg: 'hsl(346 77% 55% / 0.15)', border: 'hsl(346 77% 52%)', text: 'hsl(346 65% 62%)' },
  log_rule:             { bg: 'hsl(142 71% 45% / 0.15)', border: 'hsl(142 71% 42%)', text: 'hsl(142 60% 50%)' },
  log_integral:         { bg: 'hsl(142 71% 45% / 0.15)', border: 'hsl(142 71% 42%)', text: 'hsl(142 60% 50%)' },
  exp_rule:             { bg: 'hsl(316 72% 55% / 0.15)', border: 'hsl(316 72% 52%)', text: 'hsl(316 62% 62%)' },
  exp_integral:         { bg: 'hsl(316 72% 55% / 0.15)', border: 'hsl(316 72% 52%)', text: 'hsl(316 62% 62%)' },
  u_substitution:       { bg: 'hsl(280 68% 58% / 0.15)', border: 'hsl(280 68% 55%)', text: 'hsl(280 58% 65%)' },
  integration_by_parts: { bg: 'hsl(280 68% 58% / 0.15)', border: 'hsl(280 68% 55%)', text: 'hsl(280 58% 65%)' },
  simplify:             { bg: 'hsl(0 0% 50% / 0.10)',    border: 'hsl(0 0% 50%)',    text: 'hsl(0 0% 65%)' },
  constant:             { bg: 'hsl(0 0% 45% / 0.10)',    border: 'hsl(0 0% 45%)',    text: 'hsl(0 0% 58%)' },
  evaluate_bounds:      { bg: 'hsl(38 92% 50% / 0.15)',  border: 'hsl(38 92% 50%)',  text: 'hsl(38 85% 58%)' },
  gradient_component:   { bg: 'hsl(199 89% 48% / 0.15)', border: 'hsl(199 89% 45%)', text: 'hsl(199 78% 55%)' },
  divergence_sum:       { bg: 'hsl(172 66% 50% / 0.15)', border: 'hsl(172 66% 45%)', text: 'hsl(172 55% 55%)' },
  curl_component:       { bg: 'hsl(316 72% 55% / 0.15)', border: 'hsl(316 72% 52%)', text: 'hsl(316 62% 62%)' },
  identify_ode:         { bg: 'hsl(38 92% 50% / 0.15)',  border: 'hsl(38 92% 50%)',  text: 'hsl(38 85% 58%)' },
  solve_method:         { bg: 'hsl(262 83% 60% / 0.15)', border: 'hsl(262 83% 58%)', text: 'hsl(262 72% 68%)' },
  general_solution:     { bg: 'hsl(142 71% 45% / 0.15)', border: 'hsl(142 71% 42%)', text: 'hsl(142 60% 50%)' },
  partial_derivative:   { bg: 'hsl(217 91% 60% / 0.15)', border: 'hsl(217 91% 55%)', text: 'hsl(217 80% 65%)' },
  default:              { bg: 'hsl(0 0% 40% / 0.08)',    border: 'hsl(0 0% 42%)',    text: 'hsl(0 0% 60%)' },
}

function getRuleColor(rule) {
  return RULE_COLORS[rule] ?? RULE_COLORS.default
}

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

function VectorResult({ operationType, components, result }) {
  const opLabel = {
    gradient: '\u2207f',
    curl: '\u2207 \u00d7 F',
    divergence: '\u2207 \u00b7 F',
  }[operationType] ?? 'Result'

  if (operationType === 'divergence' || !components?.length) {
    return (
      <div className={styles.vectorBox}>
        <span className={styles.vectorLabel}>{opLabel} =</span>
        <div className={styles.resultLatex}>
          <KatexDisplay latex={result} block />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.vectorBox}>
      <span className={styles.vectorLabel}>{opLabel}</span>
      <table className={styles.vectorTable}>
        <tbody>
          {components.map(({ var: v, latex: ltx }) => (
            <tr key={v} className={styles.vectorRow}>
              <td className={styles.vectorVar}>{'\u2202'}f/{'\u2202'}{v}</td>
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
  const [pinned, setPinned] = useState(false)

  const ruleName = step.rule?.replace(/_/g, ' ') ?? ''
  const bodyId = `step-body-${index}`
  const hasDetail = !!(step.explanation || step.before_latex || step.substeps?.length > 0)
  const color = getRuleColor(step.rule)

  return (
    <li className={styles.step} style={{ animationDelay: `${index * 40}ms` }}>
      {/* Row: click anywhere to toggle */}
      <div
        className={`${styles.stepRow} ${pinned ? styles.stepRowPinned : ''}`}
        onClick={() => hasDetail && setPinned(v => !v)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
        role={hasDetail ? 'button' : undefined}
        aria-expanded={hasDetail ? pinned : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onKeyDown={e => {
          if (hasDetail && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setPinned(v => !v)
          }
        }}
      >
        <span className={styles.stepNum}>Step {index + 1}</span>
        <span
          className={styles.ruleChip}
          style={{ background: color.bg, borderColor: color.border, color: color.text }}
        >
          {ruleName}
        </span>
        <span className={styles.stepEquals}>=</span>
        <div className={styles.stepResult}>
          <KatexDisplay latex={step.after_latex} block={false} />
        </div>
        {hasDetail && (
          <button
            className={`${styles.stepInfoBtn} ${pinned ? styles.stepInfoBtnActive : ''}`}
            type="button"
            aria-label={pinned ? 'Close explanation' : 'Show explanation'}
            onClick={e => { e.stopPropagation(); setPinned(v => !v) }}
            title={pinned ? 'Click to close' : 'Click to pin explanation open'}
          >
            {pinned
              ? <span className={styles.pinClose}>{'\u00d7'}</span>
              : <span className={`${styles.narratedBy} ${step.narrated_by === 'gemini' ? styles.gemini : styles.fallback}`}>
                  {step.narrated_by === 'gemini' ? '\u2726' : '\u2699'}
                </span>
            }
          </button>
        )}
      </div>

      {/* Pinned explanation panel */}
      <div
        id={bodyId}
        className={`${styles.stepExplanation} ${pinned ? styles.stepExplanationVisible : ''}`}
        aria-hidden={!pinned}
        style={pinned ? { borderTopColor: color.border } : {}}
      >
        {/* Color-coded before -> after */}
        {step.before_latex && step.after_latex && (
          <div className={styles.arrowRow}>
            <span className={styles.beforeBadge} style={{ borderColor: color.border, color: color.text }}>
              <KatexDisplay latex={step.before_latex} />
            </span>
            <span className={styles.arrow} style={{ color: color.text }}>{'\u2192'}</span>
            <span className={styles.afterBadge} style={{ borderColor: color.border, color: color.text }}>
              <KatexDisplay latex={step.after_latex} />
            </span>
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

export default function StepPanel({ result, steps = [], loading, error, isLocal, operationType, components, narration }) {
  const isEmpty = !loading && !result && steps.length === 0 && !error
  const [copied, setCopied] = useState(false)

  const copyResult = () => {
    if (!result) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(result)
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
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
          {loading && <span className={styles.computingBadge}>computing{'\u2026'}</span>}
          {steps.length > 0 && !loading && (
            <span className={styles.stepCount}>{steps.length} steps</span>
          )}
        </div>
      </div>

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
          <div className={styles.emptyIcon}>{'\u222b'}</div>
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

      {narration?.summary && !loading && (
        <div className={styles.summaryBox}>
          <span className={styles.summaryIcon}>{'\u2726'}</span>
          <p className={styles.summaryText}>{narration.summary}</p>
        </div>
      )}

      {result && !loading && (
        operationType && ['gradient', 'curl', 'divergence'].includes(operationType)
          ? <VectorResult operationType={operationType} components={components} result={result} />
          : (
            <div className={styles.resultBox}>
              <div className={styles.resultHeader}>
                <span className={styles.resultLabel}>Result</span>
                <button type="button" className={styles.copyBtn} onClick={copyResult}
                  aria-label="Copy LaTeX result" title="Copy LaTeX result">
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
        <>
          <div className={styles.stepsHint}>
            <span>Click any step to pin its explanation open.</span>
          </div>
          <ol className={styles.stepList} aria-label="Solution steps">
            {steps.map((step, i) => (
              <StepItem key={i} step={step} index={i} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
