/**
 * issue #3281 — reads a tier's extras from a server payload. The server always
 * returns them normalized (`issue_3281_normalize_tier_extras`), so this only
 * tells a list from "not loaded". Kept tiny and apart from `ticketExtras.ts`:
 * the eager service mappers import it, and the boot payload has a byte budget.
 */

import type { TicketExtraStub } from "../store/draftEventStore";

export const extrasFromServer = (
  value: unknown,
): TicketExtraStub[] | undefined =>
  Array.isArray(value) ? (value as TicketExtraStub[]) : undefined;
