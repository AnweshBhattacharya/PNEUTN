/**
 * Button.jsx — RawBlock brutalist button component.
 *
 * Variants: primary | secondary | ghost | destructive
 * Sizes:    sm | md | lg
 *
 * See DESIGN.md §Components > Buttons for the full spec.
 */
import React from 'react'
import styles from './Button.module.css'

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  onClick,
  type = 'button',
  id,
  className = '',
  ...rest
}) {
  const cls = [
    styles.btn,
    styles[variant],
    styles[size],
    disabled ? styles.disabled : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      id={id}
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  )
}
