/**
 * accountDeletionErrors — what a refused or failed Host account deletion means,
 * and the words the Host sees for it (#3660).
 *
 * No React Native or Expo import, on purpose: this is plain logic so it can be
 * tested in plain Jest.
 *
 * The server contract (`delete-user`, side = "business"):
 *   200 — deleted.
 *   409 — `{ code: "account_deletion_blocked", blockers: [...] }`. NOTHING was changed.
 *   500 — `{ code: "account_deletion_failed" }`. NOTHING was changed.
 *
 * The decision is made on `code`, never on message text.
 */

export interface DeletionBlockerItem {
  id: string;
  title: string;
}

export interface DeletionBlocker {
  code: string;
  count: number;
  items?: DeletionBlockerItem[];
}

/** The server refused: something on the account has to be finished first. */
export class AccountDeletionBlockedError extends Error {
  readonly blockers: DeletionBlocker[];
  constructor(blockers: DeletionBlocker[]) {
    super("account_deletion_blocked");
    this.name = "AccountDeletionBlockedError";
    this.blockers = blockers;
    Object.setPrototypeOf(this, AccountDeletionBlockedError.prototype);
  }
}

/** The request did not complete. Nothing was changed. */
export class AccountDeletionFailedError extends Error {
  constructor(message = "account_deletion_failed") {
    super(message);
    this.name = "AccountDeletionFailedError";
    Object.setPrototypeOf(this, AccountDeletionFailedError.prototype);
  }
}

export const ACCOUNT_DELETION_FAILED_MESSAGE =
  "We couldn't delete your account. Nothing was changed. Try again, or contact support if it keeps happening.";

export const ACCOUNT_DELETION_BLOCKED_TITLE = "You can't delete your account yet";

export const ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE =
  "Something on your account needs attention before it can be deleted. Contact support.";

/** Shown in the "what you'll lose" list when the Host has partner connections. */
export const ACCOUNT_DELETION_PARTNER_LINKS_LINE =
  "Your partner connections will end and you'll stop earning from them.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a blocker list from an untrusted payload. Entries without a string
 * `code` are dropped; a missing or non-numeric `count` becomes 0.
 */
export function normalizeDeletionBlockers(value: unknown): DeletionBlocker[] {
  if (!Array.isArray(value)) return [];
  const blockers: DeletionBlocker[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.code !== "string") continue;
    const blocker: DeletionBlocker = {
      code: entry.code,
      count:
        typeof entry.count === "number" && Number.isFinite(entry.count)
          ? entry.count
          : 0,
    };
    if (Array.isArray(entry.items)) {
      const items: DeletionBlockerItem[] = [];
      for (const item of entry.items) {
        if (
          isRecord(item) &&
          typeof item.id === "string" &&
          typeof item.title === "string"
        ) {
          items.push({ id: item.id, title: item.title });
        }
      }
      blocker.items = items;
    }
    blockers.push(blocker);
  }
  return blockers;
}

/**
 * Turns a non-2xx `delete-user` response into the error the screen acts on.
 * 409 + `code === "account_deletion_blocked"` is a block; anything else,
 * including a body that could not be read, is a failure.
 */
export function parseDeletionFailure(status: number, body: unknown): Error {
  if (
    status === 409 &&
    isRecord(body) &&
    body.code === "account_deletion_blocked"
  ) {
    return new AccountDeletionBlockedError(
      normalizeDeletionBlockers(body.blockers),
    );
  }
  return new AccountDeletionFailedError();
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** One plain-English line per blocker. An unknown code gets the generic line. */
export function describeDeletionBlocker(blocker: DeletionBlocker): string {
  const n = blocker.count;
  switch (blocker.code) {
    case "tickets_sold": {
      const titles = (blocker.items ?? []).map((item) => item.title);
      const more = n - titles.length;
      const named =
        titles.length === 0
          ? ""
          : `: ${titles.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
      return `${n} live or upcoming ${plural(n, "event has", "events have")} tickets or RSVPs${named}. Cancel the event and buyers are refunded through the normal refund process, or wait until it has ended.`;
    }
    case "checkout_in_progress":
      return "Someone is buying a ticket right now. Try again in a few minutes.";
    case "upcoming_reservations":
      return `You have ${n} upcoming table ${plural(n, "reservation", "reservations")}. Cancel them or wait until they've passed.`;
    case "upcoming_stays":
      return `You have ${n} stay ${plural(n, "booking that is", "bookings that are")} still open. Cancel or complete them first.`;
    case "open_menu_orders":
      return `You have ${n} open menu ${plural(n, "order", "orders")}. Complete or cancel them first.`;
    case "money_in_motion":
      return "A payout or refund on your account is still in progress. Try again once it has settled, or contact support.";
    case "partner_payment_in_progress":
      return "A partner payment to you is still in progress. Try again once it has settled, or contact support.";
    default:
      return ACCOUNT_DELETION_UNKNOWN_BLOCKER_MESSAGE;
  }
}
