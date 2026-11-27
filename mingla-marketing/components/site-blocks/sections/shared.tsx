// #4636 — small pieces every block shares: the `*italic*` text renderer, the
// action (button / link / app hand-off) renderer and the colour → class map.
// Rendering only; the rules live in lib/site-blocks/registry.ts.
import { Fragment, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRight, Mail } from 'lucide-react'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import type { Colour } from '@/lib/site-blocks/registry'

/** A button or link: `{ label, to, track }` (see the registry). */
export interface BlockAction {
  label?: string
  to: string
  /** The analytics label of an app hand-off. */
  track?: string
}

/** The block-wide props every section component takes. */
export interface BlockProps<C> {
  content: C
  colour?: Colour
  /** Stable id prefix for this block's headings (aria-labelledby). */
  blockId: string
}

/** `*words*` → <em>words</em>; the rest stays plain text nodes (as the coded JSX). */
export function Em({ text }: { text: string }): ReactNode {
  const parts = text.split('*')
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : part ? <Fragment key={i}>{part}</Fragment> : null))}
    </>
  )
}

/** The #4339 landing template's variant: every run wrapped (non-italic runs in <span>). */
export function EmSpans({ text }: { text: string }): ReactNode {
  const parts = text.split('*')
  return (
    <>
      {parts.map((part, i) => (part === '' ? null : i % 2 === 1 ? <em key={i}>{part}</em> : <span key={i}>{part}</span>))}
    </>
  )
}

/** The `.sec` class for a colour (the classes the sections already have). */
export function secClass(colour: Colour | undefined, fallback: Colour = 'paper'): string {
  switch (colour ?? fallback) {
    case 'night':
      return 'sec dark'
    case 'cream':
      return 'sec sandbg'
    case 'moss':
      return 'sec moss'
    default:
      return 'sec'
  }
}

export function isApp(action: BlockAction | undefined): boolean {
  return action?.to === 'app:explorer' || action?.to === 'app:host'
}

interface ActionButtonProps {
  action: BlockAction
  className: string
  /** Analytics label when the action has none. */
  location: string
  /** `prop`: the hand-off's own arrow (no space); `inline`: " <ArrowRight/>" after the label. */
  arrow?: 'none' | 'prop' | 'inline'
  /** An icon before the label (the mailto buttons). */
  icon?: 'mail'
  extra?: Record<string, string>
}

/** One action, rendered exactly as the coded sections render it. */
export function ActionButton({ action, className, location, arrow = 'none', icon, extra = {} }: ActionButtonProps): ReactNode {
  const label = action.label
  const inlineArrow = arrow === 'inline' ? <> <ArrowRight aria-hidden="true" /></> : null
  if (action.to === 'app:explorer') {
    return (
      <ExplorerHandoffButton location={action.track ?? location} className={className} withArrow={arrow === 'prop'}>
        {label === undefined && inlineArrow === null ? undefined : (
          <>
            {label ?? 'Use Mingla'}
            {inlineArrow}
          </>
        )}
      </ExplorerHandoffButton>
    )
  }
  if (action.to === 'app:host') {
    return (
      <HostHandoffButton location={action.track ?? location} className={className} withArrow={arrow === 'prop'}>
        {label === undefined ? undefined : (
          <>
            {label}
            {inlineArrow}
          </>
        )}
      </HostHandoffButton>
    )
  }
  const body = (
    <>
      {icon === 'mail' ? (
        <>
          <Mail aria-hidden="true" />{' '}
        </>
      ) : null}
      {label}
      {inlineArrow}
    </>
  )
  if (action.to.startsWith('/')) {
    return (
      <Link className={className} href={action.to} {...extra}>
        {body}
      </Link>
    )
  }
  return (
    <a className={className} href={action.to} {...extra}>
      {body}
    </a>
  )
}
