/**
 * FullScreenSolution.jsx — Fullscreen solution walkthrough with step player,
 * animated equation flow, and color-coded calculus theorem breakdowns.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import katex from 'katex'
import styles from './FullScreenSolution.module.css'
import { RULE_BREAKDOWNS, getStepTokens } from './ruleBreakdown'

function KatexBox({ latex, block = true, className = '' }) {
  if (!latex) return null
  let html = ''
  try {
    html = katex.renderToString(latex, {
      displayMode: block,
      throwOnError: false,
      strict: false,
    })
  } catch {
    return <span className={className}>{latex}</span>
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function FullScreenSolution({
  isOpen,
  onClose,
  steps = [],
  result = '',
  narration = null,
  ruleColors = {},
}) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [viewMode, setViewMode] = useState('player') // 'player' | 'cascade'
  const [isPlaying, setIsPlaying] = useState(false)
  const playTimerRef = useRef(null)

  const totalSteps = steps.length
  const currentStep = steps[currentIdx] || steps[0]

  const nextStep = useCallback(() => {
    setCurrentIdx(i => Math.min(i + 1, totalSteps - 1))
  }, [totalSteps])

  const prevStep = useCallback(() => {
    setCurrentIdx(i => Math.max(i - 1, 0))
  }, [])

  // Auto-play timer
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setTimeout(() => {
        if (currentIdx < totalSteps - 1) {
          nextStep()
        } else {
          setIsPlaying(false)
        }
      }, 3000)
    }
    return () => clearTimeout(playTimerRef.current)
  }, [isPlaying, currentIdx, totalSteps, nextStep])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.()
      } else if (e.key === 'ArrowRight') {
        nextStep()
      } else if (e.key === 'ArrowLeft') {
        prevStep()
      } else if (e.key === ' ') {
        e.preventDefault()
        setIsPlaying(p => !p)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, nextStep, prevStep])

  if (!isOpen || totalSteps === 0) return null

  const stepColor = ruleColors[currentStep?.rule] || {
    bg: 'rgba(59, 130, 246, 0.12)',
    border: '#3b82f6',
    text: '#60a5fa',
  }
  const breakdown = currentStep ? RULE_BREAKDOWNS[currentStep.rule] : null
  const tokens = currentStep ? getStepTokens(currentStep) : []

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Fullscreen solution walkthrough">
      {/* ── Top Bar ── */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <span className={styles.titleTag}>✦ PNEUTON FOCUS</span>
          <span>SOLUTION WALKTHROUGH</span>
        </div>

        <div className={styles.topBarCenter} role="tablist" aria-label="View mode">
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === 'player' ? styles.modeBtnActive : ''}`}
            onClick={() => { setViewMode('player'); setIsPlaying(false) }}
          >
            🎬 Step Player
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${viewMode === 'cascade' ? styles.modeBtnActive : ''}`}
            onClick={() => { setViewMode('cascade'); setIsPlaying(false) }}
          >
            📜 All Steps Flow
          </button>
        </div>

        <div className={styles.topBarRight}>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Exit fullscreen"
            title="Press Esc to exit"
          >
            ✕ Close [Esc]
          </button>
        </div>
      </header>

      {/* ── Stepper Timeline Bar (Player Mode) ── */}
      {viewMode === 'player' && (
        <nav className={styles.timelineBar} aria-label="Step timeline">
          {steps.map((s, idx) => {
            const isActive = idx === currentIdx
            const isCompleted = idx < currentIdx
            return (
              <button
                key={idx}
                type="button"
                className={`${styles.stepDot} ${isActive ? styles.stepDotActive : ''} ${isCompleted ? styles.stepDotCompleted : ''}`}
                onClick={() => { setCurrentIdx(idx); setIsPlaying(false) }}
              >
                <span>{idx + 1}</span>
                <span>{s.rule?.replace(/_/g, ' ')}</span>
              </button>
            )
          })}
        </nav>
      )}

      {/* ── Main Container ── */}
      <main className={styles.mainContainer}>
        {viewMode === 'player' ? (
          <>
            {/* ── Hero Transformation Stage ── */}
            <section className={styles.heroStage} aria-label="Current transformation step">
              <div className={styles.stageHeader}>
                <span className={styles.stepCounterBadge}>
                  STEP {currentIdx + 1} OF {totalSteps}
                </span>
                <span
                  className={styles.rulePill}
                  style={{ background: stepColor.bg, borderColor: stepColor.border, color: stepColor.text }}
                >
                  {currentStep.rule?.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Transformation Flow (Before -> Beam -> After) */}
              <div className={styles.flowGraphic}>
                <div className={`${styles.flowBox} ${styles.flowBoxActive}`}>
                  <span className={styles.flowBoxLabel}>Expression to Transform</span>
                  <KatexBox latex={currentStep.before_latex || currentStep.after_latex} className={styles.flowLatex} />
                </div>

                <div className={styles.flowBeam}>
                  <span className={styles.beamArrow}>➔</span>
                  <span className={styles.beamLabel}>Apply {currentStep.rule?.replace(/_/g, ' ')}</span>
                </div>

                <div className={`${styles.flowBox} ${styles.flowBoxActive}`}>
                  <span className={styles.flowBoxLabel}>Resulting Expression</span>
                  <KatexBox latex={currentStep.after_latex} className={styles.flowLatex} />
                </div>
              </div>
            </section>

            {/* ── Calculus Rule Theorem & Token Breakdown ── */}
            {breakdown && (
              <section className={styles.breakdownCard} aria-label="Calculus theorem breakdown">
                <div className={styles.breakdownHeader}>
                  <span className={styles.breakdownTitle}>Calculus Theorem: {breakdown.title}</span>
                  <span className={styles.beamLabel}>{breakdown.desc}</span>
                </div>

                <div className={styles.breakdownFormula}>
                  <KatexBox latex={breakdown.formula} />
                </div>

                {tokens.length > 0 && (
                  <div className={styles.tokenChipsGrid} aria-label="Identified formula components">
                    {tokens.map((tok, i) => (
                      <div
                        key={i}
                        className={styles.tokenChip}
                        style={{ background: tok.bg, borderColor: tok.border, color: tok.color }}
                      >
                        <div className={styles.tokenChipHeader}>
                          <span>{tok.label || tok.tag}</span>
                          <span>[{tok.tag}]</span>
                        </div>
                        <div className={styles.tokenChipValue}>
                          <KatexBox latex={tok.value} block={false} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Explanation / Narration Card ── */}
            {currentStep.explanation && (
              <section className={styles.narrationCard} aria-label="Step explanation">
                <span className={styles.narrationIcon}>
                  {currentStep.narrated_by === 'gemini' ? '✦' : '⚙'}
                </span>
                <p className={styles.narrationText}>{currentStep.explanation}</p>
              </section>
            )}
          </>
        ) : (
          /* ── Cascade Flow Mode ── */
          <div className={styles.cascadeList} aria-label="All steps connected cascade">
            {steps.map((step, idx) => {
              const color = ruleColors[step.rule] || stepColor
              const stepTokens = getStepTokens(step)
              const stepBreakdown = RULE_BREAKDOWNS[step.rule]

              return (
                <React.Fragment key={idx}>
                  <div className={styles.cascadeItem}>
                    <div className={styles.stageHeader}>
                      <span className={styles.stepCounterBadge}>STEP {idx + 1}</span>
                      <span
                        className={styles.rulePill}
                        style={{ background: color.bg, borderColor: color.border, color: color.text }}
                      >
                        {step.rule?.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className={styles.flowLatex}>
                      <KatexBox latex={step.after_latex} />
                    </div>

                    {stepBreakdown && stepTokens.length > 0 && (
                      <div className={styles.tokenChipsGrid} style={{ marginTop: 8 }}>
                        {stepTokens.map((t, ti) => (
                          <div
                            key={ti}
                            className={styles.tokenChip}
                            style={{ background: t.bg, borderColor: t.border, color: t.color }}
                          >
                            <span className={styles.tokenChipHeader}>{t.label}</span>
                            <KatexBox latex={t.value} block={false} />
                          </div>
                        ))}
                      </div>
                    )}

                    {step.explanation && (
                      <p className={styles.narrationText} style={{ marginTop: 8, opacity: 0.85 }}>
                        {step.explanation}
                      </p>
                    )}
                  </div>

                  {idx < steps.length - 1 && (
                    <div className={styles.cascadeConnector}>
                      <span>↓</span>
                    </div>
                  )}
                </React.Fragment>
              )
            })}

            {/* Final Result Card */}
            {result && (
              <>
                <div className={styles.cascadeConnector}>
                  <span>✓</span>
                </div>
                <div
                  className={styles.cascadeItem}
                  style={{ borderLeftWidth: 4, borderLeftColor: 'var(--accent)', background: 'var(--surface-base)' }}
                >
                  <span className={styles.stepCounterBadge}>FINAL ANSWER</span>
                  <div className={styles.flowLatex} style={{ fontSize: 22 }}>
                    <KatexBox latex={result} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* ── Bottom Controls Dock (Player Mode) ── */}
      {viewMode === 'player' && (
        <footer className={styles.bottomDock}>
          <button
            type="button"
            className={styles.dockBtn}
            onClick={prevStep}
            disabled={currentIdx === 0}
          >
            ◄ Prev Step
          </button>

          <div className={styles.dockCenter}>
            <button
              type="button"
              className={`${styles.dockBtn} ${styles.playBtn}`}
              onClick={() => setIsPlaying(p => !p)}
            >
              {isPlaying ? '❚❚ Pause' : '▶ Auto-Play'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--content-tertiary)', letterSpacing: '0.04em' }}>
              Space to {isPlaying ? 'pause' : 'play'} · Arrows to navigate
            </span>
          </div>

          <button
            type="button"
            className={styles.dockBtn}
            onClick={nextStep}
            disabled={currentIdx === totalSteps - 1}
          >
            Next Step ►
          </button>
        </footer>
      )}
    </div>
  )
}
