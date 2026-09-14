/**
 * offeringRefundPolicy — issue #3284 [refund terms on events and experiences].
 *
 * THE ONE client reader of the `refundPolicy` key that the public event bundle
 * (`pg_direct_event_checkout_bundle`) and the public experience reader
 * (`pg_public_experience_by_slug`) emit. Every public adapter — business web,
 * business native, consumer iOS/Android — turns its payload into a
 * `RefundPolicyReadState` here, and the shared bodies decide what to render from
 * that state alone.
 *
 * I-3284-UNKNOWN-IS-NOT-NONE. There are THREE states, not two:
 *   - `set`     — the organiser published terms; the ladder renders them.
 *   - `none`    — the key is present and JSON null: the organiser published no
 *                 terms. A PAID offering says so plainly; a free one says nothing.
 *   - `unknown` — the key is ABSENT (a cache or a server from before #3284, or a
 *                 deck seed that never carried it) or its value fails the shape
 *                 check. Nothing renders. Telling a guest "no refund policy set"
 *                 about an offering that HAS one would invent data (rule 9).
 *
 * The shape check mirrors `validate_refund_policy` (migration 20260612000000):
 * kind is one of four, 1–8 tiers, each tier an integer `days_before_start >= 0`
 * and an integer `refund_pct` 0–100, days strictly descending and percentages
 * non-increasing. A value the database could never have stored is treated as
 * unreadable, never rendered as a broken ladder.
 *
 * Pure and dependency-free: no React, no react-native, no app `src/` import
 * (I-MOR-0827-PACKAGE-ISOLATION). Apps import it by the deep specifier
 * `@mingla/offering-rendering/offeringRefundPolicy`, which a partial
 * `jest.mock()` of the package barrel cannot intercept (see the #2539 note in
 * index.ts).
 */

/** One refund window: at least `days_before_start` whole days out → `refund_pct`%. */
export interface OfferingRefundTier {
  days_before_start: number;
  refund_pct: number;
}

/** A published refund policy. Structurally identical to the trip policy shape. */
export interface OfferingRefundPolicy {
  kind: "flexible" | "standard" | "strict" | "custom";
  tiers: OfferingRefundTier[];
}

export type RefundPolicyReadState =
  | { status: "set"; policy: OfferingRefundPolicy }
  | { status: "none" }
  | { status: "unknown" };

/** The state every surface uses when it has no refund-terms read at all. */
export const UNKNOWN_REFUND_POLICY_STATE: RefundPolicyReadState = {
  status: "unknown",
};

const POLICY_KINDS: ReadonlySet<string> = new Set([
  "flexible",
  "standard",
  "strict",
  "custom",
]);

const MAX_TIERS = 8;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/**
 * Returns a clean copy of `value` when it is a policy `validate_refund_policy`
 * would accept, otherwise null. Only the two known tier keys are copied, so
 * nothing unexpected from a payload reaches the renderer.
 */
export function parseOfferingRefundPolicy(
  value: unknown,
): OfferingRefundPolicy | null {
  if (!isPlainRecord(value)) return null;
  const kind = value.kind;
  if (typeof kind !== "string" || !POLICY_KINDS.has(kind)) return null;
  const rawTiers = value.tiers;
  if (!Array.isArray(rawTiers)) return null;
  if (rawTiers.length === 0 || rawTiers.length > MAX_TIERS) return null;

  const tiers: OfferingRefundTier[] = [];
  let previousDays = -1;
  let previousPct = 101;
  for (const rawTier of rawTiers) {
    if (!isPlainRecord(rawTier)) return null;
    const days = rawTier.days_before_start;
    const pct = rawTier.refund_pct;
    if (!isWholeNumber(days) || days < 0) return null;
    if (!isWholeNumber(pct) || pct < 0 || pct > 100) return null;
    if (previousDays >= 0 && days >= previousDays) return null;
    if (pct > previousPct) return null;
    tiers.push({ days_before_start: days, refund_pct: pct });
    previousDays = days;
    previousPct = pct;
  }
  return { kind: kind as OfferingRefundPolicy["kind"], tiers };
}

/**
 * Read the `refundPolicy` key of a public offering payload into its three-state
 * form. `payload` is the whole payload object, because an ABSENT key and a null
 * VALUE mean different things (see the header).
 */
export function readRefundPolicyState(payload: unknown): RefundPolicyReadState {
  if (!isPlainRecord(payload)) return UNKNOWN_REFUND_POLICY_STATE;
  if (!Object.prototype.hasOwnProperty.call(payload, "refundPolicy")) {
    return UNKNOWN_REFUND_POLICY_STATE;
  }
  const raw = payload.refundPolicy;
  // JSON cannot carry `undefined`; a key holding it was never a server answer.
  if (raw === undefined) return UNKNOWN_REFUND_POLICY_STATE;
  if (raw === null) return { status: "none" };
  const policy = parseOfferingRefundPolicy(raw);
  return policy === null
    ? UNKNOWN_REFUND_POLICY_STATE
    : { status: "set", policy };
}
