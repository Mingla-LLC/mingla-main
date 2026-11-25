/**
 * #4490 spec 08 — the guest's pay page (/pay/till/<code>): anonymous, no
 * account. Split from tillPayModel.ts (which re-exports it) so the guest page
 * never loads the Till's own words and models.
 */

export interface TillPayView {
  status: "open" | "opened" | "paid" | "expired" | "cancelled" | "failed";
  expiresAt: string | null;
  provider: "stripe" | "paystack" | null;
  venueName: string;
  currency: string;
  lines: Array<{ name: string; quantity: number; amountMinor: number }>;
  subtotalMinor: number;
  serviceChargeMinor: number;
  paidBeforeMinor: number;
  tipMinor: number;
  feesMinor: number;
  amountMinor: number;
  paid: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const mapTillPayView = (v: unknown): TillPayView => {
  const o = obj(v);
  const status = String(o.status ?? "open");
  return {
    status: (["open", "opened", "paid", "expired", "cancelled", "failed"].includes(status) ? status : "open") as TillPayView["status"],
    expiresAt: typeof o.expiresAt === "string" ? o.expiresAt : null,
    provider: o.provider === "stripe" || o.provider === "paystack" ? o.provider : null,
    venueName: typeof o.venueName === "string" ? o.venueName : "",
    currency: typeof o.currency === "string" ? o.currency : "NGN",
    lines: (Array.isArray(o.lines) ? o.lines : []).map((l) => {
      const line = obj(l);
      return { name: String(line.name ?? ""), quantity: n(line.quantity), amountMinor: n(line.amountMinor) };
    }),
    subtotalMinor: n(o.subtotalMinor),
    serviceChargeMinor: n(o.serviceChargeMinor),
    paidBeforeMinor: n(o.paidBeforeMinor),
    tipMinor: n(o.tipMinor),
    feesMinor: Math.max(n(o.feesMinor), 0),
    amountMinor: n(o.amountMinor),
    paid: o.paid === true,
  };
};

export type GuestPayState =
  | "loading"
  | "not_found"
  | "error"
  | "details"
  | "confirming"
  | "paid"
  /** Closed with no money seen: never "you were not charged" (the door rule). */
  | "closed";

/**
 * What the guest sees. Back from the provider (`?paid=1`), the page keeps
 * confirming until the server says paid or the bounded polls run out; a
 * closed code is only ever "closed", never "not charged".
 */
export const guestPayState = (input: {
  loading: boolean;
  notFound: boolean;
  error: boolean;
  view: TillPayView | null;
  returned: boolean;
  pollsLeft: number;
}): GuestPayState => {
  if (input.notFound) return "not_found";
  if (input.view === null) return input.error ? "error" : "loading";
  if (input.view.paid || input.view.status === "paid") return "paid";
  // Back from the provider: confirm while reads are left, then say it is still
  // being confirmed (never "not charged") with a way to check again.
  if (input.returned) return input.pollsLeft > 0 ? "confirming" : "closed";
  if (input.view.status === "open" || input.view.status === "opened") return "details";
  return "closed";
};

/** The return check is bounded (N143): this many reads, this far apart. */
export const GUEST_PAY_POLLS = 10;
export const GUEST_PAY_POLL_MS = 3000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The guest's form: name and email in words; the phone is the PhoneField's. */
export const guestPayFormErrors = (input: { name: string; email: string }): { name: string | null; email: string | null } => {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";
  return {
    name: name.length >= 2 ? null : "Add your name.",
    email: !EMAIL.test(email)
      ? "Check the email address."
      : /(^|\.)(test|invalid|example|localhost|local)$/.test(domain)
      ? "That email address can't get receipts. Use another one."
      : null,
  };
};
