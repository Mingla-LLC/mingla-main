/**
 * #4514 — the ONE query-key factory for brand forms (Constitution #4).
 * Registered in docs/QUERY_KEY_REGISTRY.md. Kept in its own leaf file so the
 * manage-page tile can use the keys without importing the service.
 */
export const brandFormKeys = {
  all: ["brand-forms"] as const,
  list: (brandId: string) => ["brand-forms", "list", brandId] as const,
  detail: (formId: string) => ["brand-forms", "detail", formId] as const,
  eventAttachment: (eventId: string) => ["brand-forms", "event-attachment", eventId] as const,
  responses: (formId: string, eventId: string | null, filter: string) =>
    ["brand-forms", "responses", formId, eventId ?? "all", filter] as const,
  tile: (eventId: string) => ["brand-forms", "tile", eventId] as const,
  counts: (brandId: string) => ["brand-forms", "counts", brandId] as const,
  rosterAnswers: (eventId: string) => ["brand-forms", "roster-answers", eventId] as const,
  /** Wave 4: reach and cost of one "Ask guests to answer" / "Remind" before sending. */
  requestPreview: (formId: string, eventId: string, kind: string, audience: string, channels: string, subjects: string) =>
    ["brand-forms", "request-preview", formId, eventId, kind, audience, channels, subjects] as const,
  /** Wave 4 review: the host's delivery log for one form on one page (optionally one guest). */
  requestLog: (formId: string, eventId: string, subject: string) =>
    ["brand-forms", "request-log", formId, eventId, subject] as const,
  /** #4541 R8.3: who opened full answers at the door on one page (event manager and up). */
  doorReads: (eventId: string) => ["brand-forms", "door-reads", eventId] as const,
  /** #4541 R1.9: one guest's answers on guest detail and order detail. */
  guestAnswers: (eventId: string, subjectKind: string, subjectId: string) =>
    ["brand-forms", "guest-answers", eventId, subjectKind, subjectId] as const,
  /** #4541 R4.2: the live forms the Blast composer's "+ Form" picker lists. */
  blastPicker: (brandId: string) => ["brand-forms", "blast-picker", brandId] as const,
  /** The key of a read that is switched off because its id is missing (never fetched). */
  idle: (
    read:
      | "list"
      | "counts"
      | "detail"
      | "responses"
      | "event-attachment"
      | "tile"
      | "roster-answers"
      | "request-preview"
      | "request-log"
      | "door-reads"
      | "guest-answers"
      | "blast-picker",
  ) =>
    ["brand-forms", read, "none"] as const,
} as const;
