/**
 * #4420 — the support ticket query keys on their own, with no service import.
 *
 * Help & Support's shell decides "A person" vs "Ari" from the host's open
 * conversation before the support chunk loads. It reads the SAME cache entry
 * as useSupportTickets (one key per entity), so the key factory lives here
 * where the shell can import it without pulling the support service into
 * the web boot chunk.
 */
export const supportTicketKeys = {
  all: ["support", "tickets"] as const,
  byUser: (userId: string): readonly [string, string, string] =>
    ["support", "tickets", userId] as const,
  thread: (ticketId: string): readonly [string, string, string] =>
    ["support", "thread", ticketId] as const,
};

export const SUPPORT_TICKETS_DISABLED_KEY = ["support", "tickets", "disabled"] as const;

export const SUPPORT_TICKETS_STALE_TIME_MS = 30 * 1000; // tickets change as staff reply — keep it fresh
