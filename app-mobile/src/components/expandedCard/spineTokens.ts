/**
 * THE EXPANDED SHEET'S BODY — the one token table. Issue #1605 wave 4.
 *
 * Two materials, two jobs, and the split is the whole information architecture:
 * the HERO is glass over a photograph and carries identity; the BODY is white
 * paper and carries everything you read and everything you commit to. Glass over
 * white returns white — a 0.12 white lift over #FFFFFF is a 1.00:1 boundary,
 * i.e. nothing — so the body is not glass, it is paper, and it stays white.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL: COLOUR IS SUBTRACTED, HARD
 *
 * Before this wave, Weather, Busyness, Practical details and Experiences were
 * each an orange-tinted rounded box (bg #fef7f0, border rgba(235,120,37,0.20),
 * radius 10-12) and the effect was that every group shouted in the same voice.
 * Groups are made by A HEADING AND A RULE, which costs one line and no colour.
 *
 * Every colour that left has the measured reason it left recorded next to it, so
 * nobody re-adds one by taste:
 *
 *   #9CA3AF as text                2.54:1  -> #6B7280 (4.83:1)
 *   rgba(194,65,12,0.5) at 9pt     2.20:1  -> DELETED, not recoloured. A 9pt
 *                                            half-alpha caption is not information.
 *   #D97706 category text          3.19:1  -> the category is on the plate now
 *   #10B981 on its own 0.15 tint   2.20:1  -> #14532D on #DCFCE7 (8.30:1)
 *   #EF4444 on its own 0.15 tint   3.09:1  -> #7F1D1D on #FEE2E2 (8.20:1)
 *   #6366F1 indigo + white label   4.47:1  -> the Save button is unfilled
 *   white on #EB7825               2.90:1  -> #16110D on #EB7825 (6.47:1)
 *   #EB7825 fill, un-ringed        2.90:1  -> ringed 1pt #C2410C (5.18:1 on paper)
 *
 * Two darks (#1F2937, #333338) and two oranges (#EB7825, #EA580C) collapse to
 * one each. THE NEAR-BLACK LABEL ON THE ACCENT FILL IS NOT A PREFERENCE — it is
 * the only colour rule in the system that changes something you can see, and it
 * exists because white on the brand orange fails AA outright.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 *
 * No plate value, no scrim value, no radius the hero uses, no type size the hero
 * uses. Those live in `@mingla/card-identity` and this file must never restate
 * one — that is I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE. This table governs the
 * PAPER only.
 */

/** Every measured ratio below is against `SPINE.paper` unless stated. */
export const SPINE = {
  paper: '#FFFFFF',
  /** 20, not 16 — the content column is 362 on a 402 screen. */
  gutter: 20,
  sectionPaddingVertical: 20,
  /** 1pt full-bleed. 1.24:1 — decorative, and it is the entire grouping device. */
  rule: '#E5E7EB',
  /** Reading surfaces. */
  prose: '#374151',        // 10.31:1
  proseSize: 16,
  proseLineHeight: 24,
  /** Section headings: 13/700 uppercase, letterSpacing 0.6. */
  heading: '#6B7280',      // 4.83:1
  headingSize: 13,
  headingLetterSpacing: 0.6,
  /** Fact rows. */
  factLabel: '#6B7280',    // 4.83:1
  factLabelSize: 14,
  factValue: '#111827',    // 17.74:1
  factValueSize: 15,
  factRowMinHeight: 44,
  /** Secondary prose (stop meta, tips, condition tails). */
  muted: '#4B5563',        // 7.56:1
  /** Links and the today-marker. The ONE accent that is legible as text. */
  link: '#C2410C',         // 5.18:1
  /** The brand accent, as a FILL only. Never as text on paper (2.90:1). */
  accentFill: '#EB7825',
  /** The ring that gives the accent fill an SC 1.4.11 boundary on paper. */
  accentRing: '#C2410C',   // 5.18:1 vs paper, 1.79:1 vs the fill it rings
  /** The label ON the accent fill. White measures 2.90:1 and FAILS AA. */
  onAccent: '#16110D',     // 6.47:1
  accentPressed: '#D96C1E',
  /** Open / closed, both far above the 4.5 floor on their own tints. */
  openText: '#14532D',
  openFill: '#DCFCE7',     // 8.30:1
  closedText: '#7F1D1D',
  closedFill: '#FEE2E2',   // 8.20:1
  /** Error copy. */
  error: '#B91C1C',        // 6.47:1
  /** Neutral chip / thumbnail / pressed-row fills. */
  chipFill: '#F3F4F6',
  pressedRow: '#F9FAFB',
  hairline: '#D1D5DB',
  /** Skeleton. 1.16:1 against paper — decorative by construction. */
  skeleton: '#ECEEF1',
  skeletonRadius: 8,
  skeletonPulseMs: 1200,
  disabledLabel: '#6B7280', // 4.83:1
} as const;

/** The action band. Its HEIGHT never changes — the same silhouette discipline the plate obeys. */
export const ACTION_BAND = {
  /** 20 + 52 + 20 = 92. Fixed, whether Reserve renders or not. */
  height: 92,
  padding: 20,
  gap: 10,
  buttonHeight: 52,   // a 44pt target with 8pt of slack
  buttonRadius: 26,
  labelSize: 14,
  iconSize: 20,
  reserveIconSize: 18,
} as const;

/** The Plan / Companion-stops list. Rows are a FIXED height so the list can be scanned. */
export const STOP_ROW = {
  /** 72pt collapsed, always. 2 stops = 172pt, 3 = 272pt, 10 = 972pt. */
  height: 72,
  gap: 12,
  thumb: 56,
  thumbRadius: 10,
  indexSize: 18,
  indexRadius: 9,
  indexLabelSize: 11,
  nameSize: 15,
  metaSize: 13,
  chevronSize: 16,
  /**
   * #1705 — the "what this stop is for" line. The row's `height` became a
   * `minHeight` for it: a fixed 72 clipped the line outright, and a stop only
   * grows when it actually HAS a purpose, so a plan of unclassifiable stops is
   * pixel-identical to before.
   */
  purposeIconSize: 13,
  purposeLineHeight: 18,
  /** The travel connector between rows. Rendered ONLY with real travel data. */
  connectorHeight: 28,
  badgeSize: 11,
  badgeRadius: 10,
  /** The expanded stop's own photo strip. */
  photoStripHeight: 140,
  photoStripRadius: 8,
} as const;

/** The body gallery strip (single place only — a plan's photos live on its stops). */
export const GALLERY = {
  height: 120,
  itemWidth: 160,
  itemRadius: 12,
  gap: 8,
} as const;
