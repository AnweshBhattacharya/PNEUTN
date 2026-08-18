import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Button from '../components/shared/Button'
import LoadingBar from '../components/shared/LoadingBar'
import StepPanel from '../components/StepPanel/StepPanel'
import EquationPreview from '../components/EquationPreview/EquationPreview'

describe('UI Components', () => {
  describe('Button', () => {
    it('renders text and handles click events', () => {
      const handleClick = vi.fn()
      render(<Button onClick={handleClick}>Click Me</Button>)
      const btn = screen.getByRole('button', { name: /click me/i })
      expect(btn).toBeInTheDocument()
      fireEvent.click(btn)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('honors disabled prop', () => {
      const handleClick = vi.fn()
      render(<Button disabled onClick={handleClick}>Disabled</Button>)
      const btn = screen.getByRole('button', { name: /disabled/i })
      expect(btn).toBeDisabled()
      fireEvent.click(btn)
      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('LoadingBar', () => {
    it('renders status when active', () => {
      render(<LoadingBar active={true} label="Processing..." />)
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Processing...')).toBeInTheDocument()
    })

    it('renders nothing when inactive', () => {
      const { container } = render(<LoadingBar active={false} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('StepPanel', () => {
    it('renders empty state placeholder when no steps', () => {
      render(<StepPanel steps={[]} loading={false} />)
      expect(screen.getByText(/Enter an expression above and press Solve/i)).toBeInTheDocument()
    })

    it('renders error message in error box', () => {
      render(<StepPanel error="Syntax error" steps={[]} loading={false} />)
      expect(screen.getByRole('alert')).toHaveTextContent('Syntax error')
    })

    it('renders steps and toggles step expansion', () => {
      const steps = [
        {
          rule: 'power_rule',
          before_latex: 'x^2',
          after_latex: '2x',
          explanation: 'Apply the power rule',
          narrated_by: 'gemini',
        },
      ]
      render(<StepPanel result="2x" steps={steps} loading={false} />)
      expect(screen.getByText(/Step 1/i)).toBeInTheDocument()
      expect(screen.getAllByText(/power rule/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Apply the power rule')).toBeInTheDocument()
    })
  })

  describe('EquationPreview', () => {
    it('renders derivative preview equation', () => {
      render(
        <EquationPreview
          latexExpr="x^2"
          operation="derivative"
          wrt="x"
          order={1}
          boundsEnabled={false}
          boundLo="0"
          boundHi="1"
        />
      )
      expect(screen.getByText('Preview')).toBeInTheDocument()
      expect(screen.getByText('d/dx')).toBeInTheDocument()
    })

    it('renders integral preview with bounds', () => {
      render(
        <EquationPreview
          latexExpr="x^2"
          operation="integral"
          wrt="x"
          order={1}
          boundsEnabled={true}
          boundLo="0"
          boundHi="5"
        />
      )
      expect(screen.getByText('∫ dx')).toBeInTheDocument()
    })
  })
})
