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
} as const;
