// ---------------------------------------------------------------
// #2902 — DESIGN PREVIEW provenance contract.
//
// The rejected mockup pass failed because figures, media and capability claims
// had no traceable origin. Every datum rendered by a design-preview surface
// MUST carry one of these labels, and the label MUST be visible in the UI.
//
// This file is the single owner of what each label MEANS. It is deliberately
// free of React so both server and client components can import it.
// ---------------------------------------------------------------

export type Provenance =
  /** Verbatim first-party record from Mingla's place pool / product database. */
  | 'first-party'
  /** A real, shipped Mingla capability, evidenced in product source. */
  | 'product-capability'
  /** Invented figures shown only to demonstrate a product surface. */
  | 'illustrative'
  /** A required asset that does not exist yet. Renders as an honest gap. */
  | 'missing-asset'

/** The exact user-visible string for each provenance class. Never paraphrase. */
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  'first-party': 'Real Mingla place data',
  'product-capability': 'Shipped Mingla capability',
  illustrative: 'Illustrative product demo',
  'missing-asset': 'Asset required — not yet produced',
}

/**
 * Longer explanation surfaced in a title/tooltip so a reviewer can audit a
 * figure without reading source.
 */
export const PROVENANCE_DETAIL: Record<Provenance, string> = {
  'first-party':
    'Name, category, rating, review count and photo come verbatim from Mingla’s place pool (Supabase storage, Lagos city snapshot).',
  'product-capability':
    'Describes behaviour that exists in shipped Mingla source. No performance or outcome is claimed.',
  illustrative:
    'The numbers in this panel are invented to demonstrate the product surface. They are not measured, not averages, and not a promise.',
  'missing-asset':
    'This slot needs a real, owned or licensed asset before the page can ship. Nothing has been generated to fill it.',
}
