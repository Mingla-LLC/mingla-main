/**
 * useAttendanceClaimArm — issue #2323.
 *
 * THE ONE OWNER of "this confirmation screen has a finalized order, so mint its
 * attendance claim link". Every ticket-confirmation screen (event, trip,
 * experience) calls this hook and nothing else.
 *
 * ─── WHAT WAS BROKEN, MEASURED ON PRODUCTION 2026-08-19 ─────────────────────
 *
 * The founder bought a FREE two-day ticket, installed Explorer, signed in with
 * a phone that MATCHES `orders.buyer_phone_e164`, and his ticket was nowhere in
 * the app. Measured on the live database:
 *
 *   order 0485b385-…  free, session 72f19024-… status `free_completed`
 *   orders.attendance_identity_claim_armed_at → NULL
 *   attendance_claim_deliveries for the order → 0
 *
 * and over the whole production table:
 *
 *   free_completed  orders 9  armed 0     ← never, not once
 *   paid_completed  orders 5  armed 1     ← the one order created after #2241
 *                                           set ATTENDANCE_CLAIM_PEPPER
 *
 * Arming is written only by `arm_order_identity_attendance_claim`, reachable
 * only from the `attendance-claim-link` edge function, which only the
 * confirmation screen calls. So the free arm had never fired.
 *
 * ─── WHY (instrumented on the DEPLOYED confirmation screen, not read from
 *     source — desktop Chrome AND a real Samsung Galaxy A72 / Chrome 151) ────
 *
 * `attendance-claim-link` requests observed while a completed FREE order was
 * rendered on `host.usemingla.com/checkout/{id}/confirm`: **ZERO**. The screen
 * never called it. The card sat on "Preparing your Mingla link…" forever.
 *
 * The two former call sites both hung off the PAID Stripe return leg:
 *
 *   1. inside the `?cs=` sync-confirm effect — which returns early on
 *      `if (!/[?&]cs=/.test(search)) return;`
 *   2. inside `useOrderRealtimeSubscription`'s `onOrderReady` — which only ever
 *      subscribes because that same `?cs=` effect set `realtimePending`
 *
 * A free reservation reaches /confirm through neither: `buyer.tsx` calls
 * `recordResult(...)` then `router.replace('…/confirm')` with no query string
 * at all. Two call sites, both on one arrival path, and a third arrival path
 * with no call site — the exact shape of bug that a single owner prevents.
 *
 * ─── THE CONTRACT ───────────────────────────────────────────────────────────
 *
 * Arm from the RESULT, never from the arrival path. The moment a confirmation
 * screen holds a finalized order plus the possession proof that authorised it
 * (`checkoutSessionId` + `buyerStatusToken`), the claim is minted — once, and
 * exactly once per session id. How the buyer got to the screen is irrelevant.
 *
 * The claim stays an ENHANCEMENT and never a gate (#2217): loading, errored,
 * rate-limited or terminally ineligible, the screen still renders and the app
 * card still reaches the right store.
 *
 * SECURITY IS UNCHANGED. This hook adds no new authority: it forwards the same
 * `buyerStatusToken` possession proof the edge function already required, and
 * the server still verifies it against `buyer_status_token_hash`. It cannot
 * arm an order the caller cannot already prove it owns. A guessed identifier
 * still claims nothing — that is `attendance-claim-identity`'s job and #2217's
 * revert proof still covers it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { readCheckoutResumePayload } from "../components/checkout/checkoutPersistence";
import type { AttendanceClaimLinkResult } from "../services/attendanceClaimLinkService";

export type AttendanceClaimPhase =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "unavailable"
  | "terminal"
  | "rate";

/**
 * The shape this hook needs off the cart's `OrderResult`. Declared structurally
 * so the hook has no import edge back into CartContext.
 */
export interface AttendanceClaimOrder {
  checkoutSessionId?: string;
  /**
   * issue #2323 — the possession proof, carried on the order result itself.
   *
   * Previously the token only ever existed in the paid leg's closure or in
   * sessionStorage, so the free path (which has the token in hand at
   * `recordResult` time) simply dropped it. Carrying it here makes every
   * arrival path self-sufficient and works on native, where sessionStorage
   * does not exist at all.
   */
  buyerStatusToken?: string;
}

export interface AttendanceClaimArm {
  phase: AttendanceClaimPhase;
  /**
   * The minted link, or null in every non-ready phase.
   *
   * Deliberately the WHOLE result rather than just the deep link: #2217's
   * suite asserts the confirmation routes read `link.appClaimUrl`, and that
   * assertion is worth keeping exactly as written.
   */
  link: AttendanceClaimLinkResult | null;
  /** Re-mint after a transient failure. */
  retry: () => void;
}

const webSessionStorage = (): Storage | undefined =>
  Platform.OS === "web"
    ? (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage
    : undefined;

/**
 * Resolve the possession proof for a finalized order.
 *
 * Preference order is deliberate:
 *   1. the token carried ON the result — the only source that exists on every
 *      surface and every arrival path,
 *   2. the sessionStorage resume payload — the web-only #2150 record, kept as
 *      a fallback so an order result restored from an older shape still arms.
 *
 * The storage fallback is matched on `checkoutSessionId`: a stale entry from a
 * DIFFERENT checkout must never authorise this one.
 */
export const resolveBuyerStatusToken = (
  order: AttendanceClaimOrder | null,
  eventId: string | null,
  storage: Storage | undefined,
): { sessionId: string; token: string } | null => {
  if (order === null) return null;
  const sessionId = order.checkoutSessionId ?? "";
  if (sessionId.length === 0) return null;
  const carried = order.buyerStatusToken ?? "";
  if (carried.length > 0) return { sessionId, token: carried };
  if (eventId === null) return null;
  const stored = readCheckoutResumePayload(storage, eventId);
  if (stored === null) return null;
  if (stored.checkoutSessionId !== sessionId) return null;
  if (stored.buyerStatusToken.length === 0) return null;
  return { sessionId, token: stored.buyerStatusToken };
};

export function useAttendanceClaimArm(
  order: AttendanceClaimOrder | null,
  eventId: string | null,
): AttendanceClaimArm {
  const [state, setState] = useState<{
    phase: AttendanceClaimPhase;
    link: AttendanceClaimLinkResult | null;
    authority: { sessionId: string; token: string } | null;
  }>({ phase: "idle", link: null, authority: null });

  const prepare = useCallback((sessionId: string, token: string): void => {
    setState({ phase: "loading", link: null, authority: { sessionId, token } });
    void import("../services/attendanceClaimLinkService").then(({ createAttendanceClaimLink }) =>
      createAttendanceClaimLink(sessionId, token)
    ).then((link) => {
      setState({ phase: "ready", link, authority: { sessionId, token } });
    }).catch((error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : null;
      const phase: AttendanceClaimPhase = code === "rate_limited"
        ? "rate"
        : code === "configuration"
        ? "unavailable"
        : code === "invalid" || code === "ineligible"
        ? "terminal"
        : "error";
      setState({ phase, link: null, authority: { sessionId, token } });
    });
  }, []);

  // One mint per checkout session, whichever arrival path produced the order.
  const armedForRef = useRef<string | null>(null);
  useEffect(() => {
    const authority = resolveBuyerStatusToken(order, eventId, webSessionStorage());
    if (authority === null) return;
    if (armedForRef.current === authority.sessionId) return;
    armedForRef.current = authority.sessionId;
    prepare(authority.sessionId, authority.token);
  }, [order, eventId, prepare]);

  const retry = useCallback((): void => {
    const authority = state.authority;
    if (authority !== null) prepare(authority.sessionId, authority.token);
  }, [state.authority, prepare]);

  return {
    phase: state.phase,
    link: state.phase === "ready" ? state.link : null,
    retry,
  };
}
