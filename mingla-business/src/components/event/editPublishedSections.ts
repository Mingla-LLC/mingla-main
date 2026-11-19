/**
 * ORCH-1172 — pure section-config model for EditPublishedScreen.
 *
 * Extracted from EditPublishedScreen.tsx so the section-list logic (which
 * sections show for ticketed vs RSVP edit) is unit-testable WITHOUT pulling the
 * react-native component module into the node/ts-jest default test config.
 *
 * Ticketed sections: Basics / When / Where / Cover / Visual / Tickets / Settings.
 * RSVP sections (ORCH-1172): Basics / When / Where / Cover / Visual / RSVP —
 *   Tickets + generic Settings DROPPED (RsvpStep5Setup owns visibility +
 *   discoverable + the privacy toggles; RSVP has no ticket concept), and the
 *   `rsvp-setup` card sits right after Cover (mirrors the create wizard order).
 */

export type SectionKey =
  | "basics"
  | "when"
  | "where"
  | "cover"
  | "visual"
  | "tickets"
  | "settings"
  // ORCH-1172 — RSVP-only host-control section (mounts RsvpStep5Setup, the
  // SAME component the create RSVP wizard uses). Never shown in ticketed mode.
  | "rsvp-setup";

export interface SectionConfig {
  key: SectionKey;
  label: string;
  /** Step index for `validateStep(N, draft)`. null → not validated by the ticketed validator. */
  stepIndex: number | null;
}

export const SECTIONS: readonly SectionConfig[] = [
  { key: "basics", label: "Basics", stepIndex: 0 },
  { key: "when", label: "When", stepIndex: 1 },
  { key: "where", label: "Where", stepIndex: 2 },
  { key: "cover", label: "Cover", stepIndex: 3 },
  { key: "visual", label: "Visual", stepIndex: null },
  { key: "tickets", label: "Tickets", stepIndex: 4 },
  { key: "settings", label: "Settings", stepIndex: 5 },
];

// ORCH-1172 — RSVP edit sections (RSVP setup right after Cover). `rsvp-setup`
// is stepIndex null: the ticketed validateStep MUST NOT run against an RSVP
// draft (validateRsvpStep(4) has no required fields; cross-field rules are
// UI-enforced inside RsvpStep5Setup).
export const RSVP_SECTIONS: readonly SectionConfig[] = [
  { key: "basics", label: "Basics", stepIndex: 0 },
  { key: "when", label: "When", stepIndex: 1 },
  { key: "where", label: "Where", stepIndex: 2 },
  { key: "cover", label: "Cover", stepIndex: 3 },
  { key: "visual", label: "Visual", stepIndex: null },
  { key: "rsvp-setup", label: "RSVP", stepIndex: null },
];

/**
 * Pure section-list selector. rsvpMode → the RSVP section list (Tickets +
 * generic Settings dropped, RSVP setup added after Cover); otherwise the
 * byte-identical ticketed SECTIONS.
 */
export const sectionsForMode = (
  rsvpMode: boolean,
): readonly SectionConfig[] => (rsvpMode ? RSVP_SECTIONS : SECTIONS);
