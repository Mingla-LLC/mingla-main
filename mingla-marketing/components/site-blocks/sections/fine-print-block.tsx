// #4636 block `finePrint` — the one line of fine print with a link (Creators,
// Locals agreement line), moved as-is (R1). Inside the programme frame.
import Link from 'next/link'
import type { BlockAction, BlockProps } from './shared'

export interface FinePrintContent {
  before: string
  link: BlockAction
  after: string
}

export function FinePrintBlock({ content }: BlockProps<FinePrintContent>) {
  return (
    <p className="fine-legal">
      {content.before} <Link href={content.link.to}>{content.link.label}</Link> {content.after}
    </p>
  )
}
