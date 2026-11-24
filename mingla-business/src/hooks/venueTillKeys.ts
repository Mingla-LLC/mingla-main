/**
 * #4490 spec 08 — the Till's query keys, in a module with no imports so a
 * screen that only needs to refresh one of them (the Menu's stock section)
 * does not pull the Till's services with it. One key factory per entity
 * (rule 4): useVenueTill re-exports this one.
 */
export const venueTillKeys = {
  all: (venueId: string) => ["venueTill", venueId] as const,
  catalog: (venueId: string) => ["venueTill", venueId, "catalog"] as const,
  checks: (venueId: string) => ["venueTill", venueId, "checks"] as const,
  sale: (venueId: string, saleId: string) => ["venueTill", venueId, "sale", saleId] as const,
  servers: (venueId: string) => ["venueTill", venueId, "servers"] as const,
};
