import { cn } from '@/lib/cn'
import {
  PROVENANCE_DETAIL,
  PROVENANCE_LABEL,
  type Provenance,
} from '@/lib/design-preview/provenance'

// #2902 — the label that makes a figure auditable. Every panel carrying numbers
// we did not measure renders one of these, in the panel, at rest — not in a
// tooltip, not in a footnote, not only in source.

interface ProvenanceChipProps {
  kind: Provenance
  className?: string
  /** `bare` drops the dot for use inside dense product chrome. */
  variant?: 'default' | 'bare'
}

const TONE: Record<Provenance, string> = {
  'first-party': 'text-[var(--color-success)] ring-[rgba(63,139,92,0.28)] bg-[rgba(63,139,92,0.10)]',
  'product-capability':
    'text-[var(--color-success)] ring-[rgba(63,139,92,0.28)] bg-[rgba(63,139,92,0.10)]',
  illustrative:
    'text-[var(--color-warning)] ring-[rgba(201,123,38,0.30)] bg-[rgba(201,123,38,0.10)]',
  'missing-asset': 'text-[var(--color-danger)] ring-[rgba(184,58,46,0.30)] bg-[rgba(184,58,46,0.10)]',
}

export function ProvenanceChip({ kind, className, variant = 'default' }: ProvenanceChipProps) {
  return (
    <span
      title={PROVENANCE_DETAIL[kind]}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ring-1 ring-inset',
        TONE[kind],
        className,
      )}
    >
      {variant === 'default' ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      ) : null}
      {PROVENANCE_LABEL[kind]}
    </span>
  )
}
