/**
 * #4490 Explorer W4 — the payment leg of the native venue checkout, and the
 * recovery check on app start / Purchases focus (spec 06 W4 rules 3-5).
 *
 * Paystack (the venue's payment page): the page is held in the shared
 * `paystackHeldHandoff` store keyed by the booking (or plan) id and the pay
 * step's idempotency key, the recovery pointer is written BEFORE the page
 * opens, the page opens in the in-app browser (`openBrowserAsync`, never an
 * auth session: I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION), the app
 * waits until the guest is back (`waitForPaymentPageClosed`), then asks the
 * server (`confirm_return`) up to 17 times, 1.5 s apart, on its own timer,
 * stopping on confirmed, failed or not paid. Stripe (the card sheet): the
 * same pointer, `initPaymentSheet` / `presentPaymentSheet` on the venue's
 * connected account, then the same polls.
 *
 * Every dependency is injected, so the whole leg is tested with stubs for
 * the browser, the card sheet, the store and the server. Nothing here logs,
 * stores or reports a payment URL, a token, a key, a name or an email.
 */
import {
  clearHeldHandoff,
  handoffGeneration,
  handoffLifetimeMs,
  holdHandoff,
  isHandoffLive,
  monotonicNow,
  readHeldHandoff,
} from "@mingla/payments-native/paystackHeldHandoff";
import type { PaymentPageReturn } from "@mingla/payments-native/paymentPageReturn";

import type { VenueConfirmOutcome } from "./venueOfferCheckoutFlow";
import type {
  createVenueCheckoutRecoveryPointer as CreatePointer,
  VenueCheckoutRecoveryKind,
  VenueCheckoutRecoveryPointer,
} from "./nativeCheckoutRecovery";
import type { VenueConfirmAnswer, VenuePaymentSession } from "../services/venueOfferCheckoutService";

/** `useReserveTable.ts:52-53` / `nativeCheckoutFlow.ts`: ~25 s at 1.5 s. */
export const VENUE_CONFIRM_POLL_INTERVAL_MS = 1500;
export const VENUE_CONFIRM_POLL_MAX_ATTEMPTS = 17;

export interface VenuePaymentServer {
  pay(input: {
    target: VenueCheckoutRecoveryKind;
    id: string;
    expectedVersion: number;
    idempotencyKey: string;
    payMode: "deposit" | "full" | null;
  }): Promise<VenuePaymentSession>;
  confirm(target: VenueCheckoutRecoveryKind, id: string): Promise<{ outcome: VenueConfirmAnswer; raw: unknown }>;
  /** The owner's read after `offer_payment_already_paid` (get / membership_get). */
  read(target: VenueCheckoutRecoveryKind, id: string): Promise<unknown>;
}

export interface VenueStripeSheet {
  init(session: Extract<VenuePaymentSession, { provider: "stripe" }>): Promise<{ error?: { code?: string } | null }>;
  present(): Promise<{ error?: { code?: string } | null }>;
}

export interface VenuePaymentDeps {
  server: VenuePaymentServer;
  openBrowser(url: string): Promise<{ type?: string }>;
  waitForClosed(result: { type?: string }): Promise<PaymentPageReturn>;
  /** Null when the card sheet cannot run on this device. */
  stripe: VenueStripeSheet | null;
  createPointer: typeof CreatePointer;
  persistPointer(pointer: VenueCheckoutRecoveryPointer): Promise<boolean>;
  clearPointerFor(id: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
}

export interface VenuePaymentInput {
  target: VenueCheckoutRecoveryKind;
  id: string;
  expectedVersion: number;
  idempotencyKey: string;
  payMode: "deposit" | "full" | null;
  accountId: string;
  holdUntil: string | null;
  /** Fired once the provider session is known (the sheet moves to "waiting"). */
  onSession?: (provider: "paystack" | "stripe") => void;
  /** Fired when the guest is back from the page (the sheet moves to "checking"). */
  onPageClosed?: () => void;
}

export type VenuePaymentResult =
  | { kind: "outcome"; outcome: VenueConfirmOutcome; raw: unknown }
  /** `pay` was refused before any page opened: the step's error (Try again, same key). */
  | { kind: "error"; code: string }
  /** The account signed out mid-flow: nothing more may be done for it. */
  | { kind: "aborted" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Is the server's own read of the booking (or plan) already confirmed? */
export function readSaysConfirmed(target: VenueCheckoutRecoveryKind, raw: unknown): boolean {
  if (!isObject(raw)) return false;
  return target === "venue_offer" ? raw.state === "confirmed" : raw.status === "active";
}

const codeOf = (error: unknown): string => {
  const code = isObject(error) ? (error as { code?: unknown }).code : null;
  return typeof code === "string" && code.length > 0 ? code : "venue_request_failed";
};

/** Fire a callback without letting it break the money path. */
const safely = (fn: (() => void) | undefined): void => {
  if (fn === undefined) return;
  try {
    fn();
  } catch {
    // A listener bug must never change what happens to a payment.
  }
};

/**
 * Poll `confirm_return` until the server gives a verdict, or the polls run
 * out ("pending"). While the page may still be open ("unconfirmed"), a
 * `not_paid` answer is not read as the guest leaving: Paystack reports
 * "abandoned" from initialize onward
 * (I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES).
 */
export async function pollVenueConfirm(
  deps: Pick<VenuePaymentDeps, "server" | "sleep" | "pollIntervalMs" | "pollMaxAttempts">,
  target: VenueCheckoutRecoveryKind,
  id: string,
  pageMayBeOpen = false,
): Promise<{ outcome: VenueConfirmOutcome; raw: unknown }> {
  const max = deps.pollMaxAttempts ?? VENUE_CONFIRM_POLL_MAX_ATTEMPTS;
  const interval = deps.pollIntervalMs ?? VENUE_CONFIRM_POLL_INTERVAL_MS;
  let last: unknown = null;
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      const answer = await deps.server.confirm(target, id);
      last = answer.raw ?? last;
      if (answer.outcome === "confirmed" || readSaysConfirmed(target, answer.raw)) {
        return { outcome: "confirmed", raw: answer.raw };
      }
      if (answer.outcome === "failed") return { outcome: "failed", raw: answer.raw };
      if (answer.outcome === "not_paid" && !pageMayBeOpen) return { outcome: "not_paid", raw: answer.raw };
    } catch (error) {
      // A hold that ran out while paying ends here; anything else (no answer,
      // a 5xx) is transient: keep asking within the budget.
      if (codeOf(error) === "offer_hold_expired") return { outcome: "expired", raw: last };
    }
    if (attempt < max - 1) await deps.sleep(interval);
  }
  return { outcome: "pending", raw: last };
}

/**
 * Pay one held booking (or plan month) and wait for the server's verdict.
 */
export async function runVenuePayment(deps: VenuePaymentDeps, input: VenuePaymentInput): Promise<VenuePaymentResult> {
  const generation = handoffGeneration();
  const gone = (): boolean => handoffGeneration() !== generation;

  const finish = async (outcome: VenueConfirmOutcome, raw: unknown): Promise<VenuePaymentResult> => {
    if (outcome !== "pending") {
      // Confirmed, failed, not paid or expired: this payment's page and pointer are spent.
      clearHeldHandoff(input.id, generation);
      await deps.clearPointerFor(input.id);
    }
    return { kind: "outcome", outcome, raw };
  };

  // 1. The session: a page held for this booking and this key, or a new `pay`.
  let session: VenuePaymentSession | null = null;
  const held = readHeldHandoff(input.id, input.idempotencyKey);
  if (held !== null && isHandoffLive(held)) {
    session = { provider: "paystack", authorizationUrl: held.authorizationUrl };
  } else {
    try {
      session = await deps.server.pay({
        target: input.target,
        id: input.id,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        payMode: input.payMode,
      });
    } catch (error) {
      if (gone()) return { kind: "aborted" };
      const code = codeOf(error);
      if (code === "offer_payment_already_paid") {
        // Rule 5: an earlier attempt went through. Treat as success and re-read.
        let raw: unknown = null;
        try {
          raw = await deps.server.read(input.target, input.id);
        } catch {
          raw = null;
        }
        return finish("confirmed", raw);
      }
      if (code === "offer_payment_already_pending") {
        // A payment is still in flight at the provider: ask the server about it.
        const polled = await pollVenueConfirm(deps, input.target, input.id);
        if (gone()) return { kind: "aborted" };
        return finish(polled.outcome, polled.raw);
      }
      if (code === "offer_hold_expired") return finish("expired", null);
      return { kind: "error", code };
    }
    if (gone()) return { kind: "aborted" };
    if (session.provider === "paystack") {
      const wall = Date.now();
      holdHandoff(input.id, {
        fingerprint: input.idempotencyKey,
        authorizationUrl: session.authorizationUrl,
        checkoutSessionId: input.id,
        buyerStatusToken: "",
        cachedAt: wall,
        cachedAtMono: monotonicNow(),
        lifetimeMs: handoffLifetimeMs(undefined),
      });
    }
  }

  // 2. Rule 4: the recovery pointer goes down BEFORE any page opens.
  const pointer = deps.createPointer({
    kind: input.target,
    id: input.id,
    accountId: input.accountId,
    provider: session.provider,
    holdUntil: input.holdUntil,
    now: deps.now(),
  });
  if (pointer !== null) await deps.persistPointer(pointer);
  if (gone()) return { kind: "aborted" };
  safely(() => input.onSession?.(session.provider));

  // 3a. Paystack: the page in the in-app browser, then the polls.
  if (session.provider === "paystack") {
    let opened: { type?: string };
    try {
      opened = await deps.openBrowser(session.authorizationUrl);
    } catch {
      // The page was provably never shown: nothing was paid. Release it.
      clearHeldHandoff(input.id, generation);
      await deps.clearPointerFor(input.id);
      return { kind: "error", code: "offer_payment_unavailable" };
    }
    if (opened.type === "locked") {
      await deps.clearPointerFor(input.id);
      return { kind: "error", code: "offer_payment_unavailable" };
    }
    const pageReturn = await deps.waitForClosed(opened);
    if (gone()) return { kind: "aborted" };
    safely(input.onPageClosed);
    const polled = await pollVenueConfirm(deps, input.target, input.id, pageReturn === "unconfirmed");
    if (gone()) return { kind: "aborted" };
    return finish(polled.outcome, polled.raw);
  }

  // 3b. Stripe: the card sheet on the venue's account, then the polls (the
  // webhook confirms the attempt; `confirm_return` reads it).
  if (deps.stripe === null) {
    await deps.clearPointerFor(input.id);
    return { kind: "error", code: "offer_payment_unavailable" };
  }
  const init = await deps.stripe.init(session);
  if (gone()) return { kind: "aborted" };
  if (init.error) {
    await deps.clearPointerFor(input.id);
    return { kind: "error", code: "offer_payment_unavailable" };
  }
  const presented = await deps.stripe.present();
  if (gone()) return { kind: "aborted" };
  if (presented.error) {
    // Closed the card sheet, or the card was declined: nothing was taken.
    return finish(presented.error.code === "Canceled" ? "not_paid" : "failed", null);
  }
  safely(input.onPageClosed);
  const polled = await pollVenueConfirm(deps, input.target, input.id);
  if (gone()) return { kind: "aborted" };
  return finish(polled.outcome, polled.raw);
}

// ─── recovery on app start and on Purchases focus (rule 4) ───────────────

export interface VenueRecoveryDeps {
  readPointer(): Promise<VenueCheckoutRecoveryPointer | null>;
  clearPointer(): Promise<void>;
  confirmOffer(groupId: string): Promise<unknown>;
  readMember(subscriptionId: string): Promise<unknown>;
  /** Refresh Purchases (its key factory) after an answer. */
  onAnswered?(pointer: VenueCheckoutRecoveryPointer): void;
}

export type VenueRecoveryResult = "none" | "foreign" | "answered" | "no_answer";

/**
 * A live pointer for the signed-in account: ask the server once
 * (`confirm_return` for a booking, `membership_get` for a plan), then clear
 * it. A pointer for another account is cleared without a call; an expired or
 * unreadable one was already cleared by the read. With no answer (offline),
 * the pointer stays for the next check, bounded by its own expiry.
 */
export async function recoverVenueCheckout(deps: VenueRecoveryDeps, accountId: string | null): Promise<VenueRecoveryResult> {
  if (accountId === null || accountId.length === 0) return "none";
  const pointer = await deps.readPointer();
  if (pointer === null) return "none";
  if (pointer.accountId !== accountId) {
    await deps.clearPointer();
    return "foreign";
  }
  try {
    if (pointer.kind === "venue_offer") await deps.confirmOffer(pointer.id);
    else await deps.readMember(pointer.id);
  } catch (error) {
    const code = codeOf(error);
    // The server answered "not yours / not found": nothing to recover here.
    if (code === "offer_booking_not_found" || code === "membership_not_found" || code === "invalid_request") {
      await deps.clearPointer();
      return "answered";
    }
    return "no_answer";
  }
  await deps.clearPointer();
  safely(() => deps.onAnswered?.(pointer));
  return "answered";
}
