/**
 * #4271 — Tap to Pay door sale, as a state machine with injected dependencies.
 *
 * Order (binding):
 *   door-tap-intent create (server prices it, idempotent on clientRequestId)
 *   → connect the Tap to Pay reader at the intent's Terminal Location
 *   → retrievePaymentIntent(clientSecret)
 *   → collectPaymentMethod   (state "ready": the guest taps)
 *   → confirmPaymentIntent   (state "reading")
 *   → door-tap-intent complete, ONLY once Stripe reports "succeeded"
 *
 * One PaymentIntent per sale: a decline or a PIN-required card re-collects on
 * the SAME intent ("Try another card"), per Stripe's double-charge guidance. One
 * clientRequestId per sale, reused for every create and complete call, so a
 * retry after a lost response can never create a second charge or order.
 *
 * No ticket exists until `complete` succeeds. If `complete` fails after the
 * money moved, the state says so ("save_failed") and retrying calls `complete`
 * again with the same ids (the stripe-webhook backstop records it too).
 */
import type { TapToPayDraft } from "./tapToPayDraft";
import type {
  CreateDoorTapIntentInput,
  DoorTapCompleteResult,
  DoorTapIntent,
} from "./doorTapEdge";
import { DoorTapError } from "./doorTapEdge";
import { TAP_TO_PAY_SHORT, type TapReaderProblem } from "../../constants/tapToPayCopy";

// ---- Minimal structural views of the SDK objects we read ----------------

export interface TerminalErrorLike {
  code?: string;
  message?: string;
  nativeErrorCode?: string;
  apiError?: { code?: string; declineCode?: string; message?: string; type?: string };
  paymentIntent?: TerminalPaymentIntentLike;
}

export interface TerminalPaymentIntentLike {
  id?: string;
  status?: string;
  paymentMethod?: {
    cardPresentDetails?: { brand?: string; last4?: string } | null;
    interacPresentDetails?: { brand?: string; last4?: string } | null;
  } | null;
  latestCharge?: {
    paymentMethodDetails?: {
      cardPresentDetails?: { brand?: string; last4?: string; wallet?: { type?: string } | null } | null;
    } | null;
  } | null;
}

export interface TerminalCallResult {
  error?: TerminalErrorLike;
  paymentIntent?: TerminalPaymentIntentLike;
}

/** What the flow needs from the Terminal SDK (wired from useStripeTerminal). */
export interface TapToPayTerminalClient {
  /** mayAcceptTerms is true only on the setup button's run (see #4271 B5). Absent means false. */
  ensureReaderConnected(
    locationId: string,
    options?: { mayAcceptTerms?: boolean },
  ): Promise<{ error?: TerminalErrorLike }>;
  retrievePaymentIntent(clientSecret: string): Promise<TerminalCallResult>;
  collectPaymentMethod(paymentIntent: TerminalPaymentIntentLike): Promise<TerminalCallResult>;
  confirmPaymentIntent(paymentIntent: TerminalPaymentIntentLike): Promise<TerminalCallResult>;
  cancelCollectPaymentMethod(): Promise<unknown>;
}

/** What the flow needs from the server. */
export interface TapToPayServer {
  createIntent(input: CreateDoorTapIntentInput): Promise<DoorTapIntent>;
  completeIntent(input: { paymentIntentId: string; clientRequestId: string }): Promise<DoorTapCompleteResult>;
  /** door-tap-intent cancel: the unpaid PaymentIntent can never be charged later. */
  cancelIntent(input: { paymentIntentId: string; clientRequestId: string }): Promise<void>;
}

/**
 * What switching to a pay code found:
 *  - "switch": no money moved (the intent was cancelled, never made, or the
 *    cancel call failed and was reported); show the pay code.
 *  - "already_paid": Stripe says this tap already succeeded. Do NOT show a pay
 *    code (that would charge the guest twice); the flow records the sale.
 */
export type PayCodeSwitchOutcome = "switch" | "already_paid";

// ---- States ---------------------------------------------------------

export interface TapAmount {
  totalCents: number;
  currency: string;
}

export type TapSaleState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready"; amount: TapAmount }
  | { kind: "reading"; amount: TapAmount }
  | { kind: "saving"; amount: TapAmount }
  | { kind: "approved"; amount: TapAmount; result: DoorTapCompleteResult; cardLabel: string | null }
  | { kind: "needs_pin"; amount: TapAmount }
  | { kind: "declined"; amount: TapAmount; cardLabel: string | null }
  | { kind: "timed_out"; amount: TapAmount }
  | { kind: "unknown_result"; amount: TapAmount }
  | { kind: "cancelled"; amount: TapAmount }
  | { kind: "not_on_this_phone" }
  | { kind: "ios_update_required" }
  | { kind: "needs_setup" }
  | { kind: "reader_problem"; problem: TapReaderProblem }
  | { kind: "save_failed"; amount: TapAmount; message: string }
  | { kind: "failed"; message: string };

/**
 * Ends the host has actually been told about. Not unknown_result or save_failed:
 * those are still open, and the sweep should finish them if the app goes away.
 */
const TAP_SEEN_KINDS: ReadonlySet<TapSaleState["kind"]> = new Set<TapSaleState["kind"]>([
  "approved",
  "declined",
  "timed_out",
  "needs_pin",
  "cancelled",
  "failed",
  "reader_problem",
  "not_on_this_phone",
  "ios_update_required",
]);

/** Only a person looking at the screen has seen it. */
export const shouldReportTapSeen = (kind: TapSaleState["kind"], appState: string | null): boolean =>
  appState === "active" && TAP_SEEN_KINDS.has(kind);

// ---- Error classification ---------------------------------------------

export type TerminalFailureKind =
  | "needs_pin"
  | "declined"
  | "cancelled"
  | "timed_out"
  | "not_on_this_phone"
  | "ios_update_required"
  | "terms_not_accepted"
  | TapReaderProblem
  | "failed";

const PIN_MARKERS = ["offline_pin_required", "online_or_offline_pin_required"];

const DEVICE_CODES: ReadonlySet<string> = new Set([
  "TAP_TO_PAY_LIBRARY_NOT_INCLUDED",
  "TAP_TO_PAY_UNSUPPORTED_DEVICE",
  "TAP_TO_PAY_UNSUPPORTED_ANDROID_VERSION",
  "TAP_TO_PAY_DEVICE_TAMPERED",
  "TAP_TO_PAY_DEBUG_NOT_SUPPORTED",
  "TAP_TO_PAY_UNSUPPORTED_PROCESSOR",
  "TAP_TO_PAY_NFC_DISABLED",
  "UNSUPPORTED_SDK",
  "ANDROID_API_LEVEL_ERROR",
  "UNSUPPORTED_OPERATION",
]);

const DECLINE_CODES: ReadonlySet<string> = new Set([
  "DECLINED_BY_STRIPE_API",
  "DECLINED_BY_READER",
  "CARD_NOT_SUPPORTED",
  "TEST_CARD_IN_LIVEMODE",
]);

const CANCEL_CODES: ReadonlySet<string> = new Set(["CANCELED", "TAP_TO_PAY_READER_REQUEST_INTERRUPTED"]);

/**
 * Native (iOS) error codes come first: several of them share one SDK `code`, and
 * only the native number tells them apart. These strings do not occur on Android.
 */
const NATIVE_KINDS: Readonly<Record<string, TerminalFailureKind>> = {
  // iOS version or capabilities. Apple wants an update message.
  "2910": "ios_update_required",
  "3930": "terms_not_accepted",
  "2960": "icloud_required",
  "2970": "terms_cancelled",
  "3940": "terms_failed",
  "3910": "prepare_failed",
  "3920": "device_banned",
  "3950": "merchant_blocked",
  "3960": "merchant_blocked",
  "3970": "merchant_blocked",
};

const READER_PROBLEMS: ReadonlySet<string> = new Set<TapReaderProblem>([
  "icloud_required",
  "terms_cancelled",
  "terms_failed",
  "prepare_failed",
  "device_banned",
  "merchant_blocked",
]);

export const isTapReaderProblem = (kind: TerminalFailureKind): kind is TapReaderProblem =>
  READER_PROBLEMS.has(kind);

export const classifyTerminalError = (error: TerminalErrorLike): TerminalFailureKind => {
  const native = error.nativeErrorCode === undefined ? undefined : NATIVE_KINDS[String(error.nativeErrorCode)];
  if (native !== undefined) return native;
  const haystack = [
    error.code,
    error.nativeErrorCode,
    error.message,
    error.apiError?.code,
    error.apiError?.declineCode,
    error.apiError?.message,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (PIN_MARKERS.some((marker) => haystack.includes(marker))) return "needs_pin";
  const code = error.code ?? "";
  if (code === "TAP_TO_PAY_READER_MERCHANT_BLOCKED") return "merchant_blocked";
  if (code === "CARD_READ_TIMED_OUT") return "timed_out";
  if (CANCEL_CODES.has(code)) return "cancelled";
  if (DEVICE_CODES.has(code)) return "not_on_this_phone";
  if (DECLINE_CODES.has(code)) return "declined";
  if (error.apiError?.type === "card_error" || (error.apiError?.declineCode ?? "").length > 0) {
    return "declined";
  }
  if (error.paymentIntent?.status === "requires_payment_method") return "declined";
  return "failed";
};

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  american_express: "American Express",
  discover: "Discover",
  interac: "Interac",
};

/** "Visa contactless ending 4242" — or null when the SDK gave no card details. */
export const cardLabelFor = (paymentIntent: TerminalPaymentIntentLike | undefined): string | null => {
  const details =
    paymentIntent?.paymentMethod?.cardPresentDetails ??
    paymentIntent?.latestCharge?.paymentMethodDetails?.cardPresentDetails ??
    null;
  if (details === null || typeof details.last4 !== "string" || details.last4.length === 0) {
    return null;
  }
  const brandKey = (details.brand ?? "").toLowerCase();
  const brand = CARD_BRAND_LABEL[brandKey] ?? (brandKey.length > 0 ? brandKey[0].toUpperCase() + brandKey.slice(1) : "Card");
  return `${brand} contactless ending ${details.last4}`;
};

const serverMessage = (error: unknown): string => {
  if (error instanceof DoorTapError) {
    switch (error.code) {
      case "door_access_denied":
        return "You don't have permission to take payments at this door. Ask the brand owner.";
      case "tap_not_available":
        return `${TAP_TO_PAY_SHORT} isn't available for this brand. Use a pay code instead.`;
      case "stripe_account_not_ready":
        return "Card payments aren't set up for this brand yet. Use cash or a pay code.";
      case "door_tax_added_at_checkout":
        return "Card payments at the door aren't available for this event yet because tax is added at checkout. Take cash, or send guests to the event page.";
      case "door_ticket_capacity_exceeded":
        return "There aren't enough tickets left for this sale.";
      case "ticket_not_valid_on_chosen_days":
        return "These tickets aren't valid on the chosen date.";
      case "invalid_lines":
        return "Pick at least one ticket and try again.";
      case "network_error":
        return "Couldn't reach Mingla. Check your connection and try again.";
      default:
        return "Couldn't start the payment. Try again.";
    }
  }
  return "Couldn't start the payment. Try again.";
};

// ---- Flow -------------------------------------------------------------

export interface TapToPaySaleFlowInput {
  eventId: string;
  draft: TapToPayDraft;
  clientRequestId: string;
  terminal: TapToPayTerminalClient;
  server: TapToPayServer;
  onState: (state: TapSaleState) => void;
  /** Called right before Apple's tap screen is asked for. */
  onBeforeCollect?: () => void;
  /** Non-fatal reporter (reportNonFatal in the app). */
  report?: (scope: string, error: unknown, extra?: Record<string, unknown>) => void;
}

export class TapToPaySaleFlow {
  private readonly input: TapToPaySaleFlowInput;
  private intent: DoorTapIntent | null = null;
  private paymentIntent: TerminalPaymentIntentLike | null = null;
  private collectedPaymentIntent: TerminalPaymentIntentLike | null = null;
  private succeededPaymentIntentId: string | null = null;
  private lastCardLabel: string | null = null;
  private busy = false;
  private state: TapSaleState = { kind: "idle" };

  constructor(input: TapToPaySaleFlowInput) {
    this.input = input;
  }

  getState(): TapSaleState {
    return this.state;
  }

  private emit(state: TapSaleState): void {
    this.state = state;
    this.input.onState(state);
  }

  private amount(): TapAmount {
    const intent = this.intent;
    if (intent === null) throw new Error("tap flow: no intent");
    return { totalCents: intent.totalCents, currency: intent.currency };
  }

  /** Begin (or resume) the sale. Safe to call again after a failure. */
  async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.succeededPaymentIntentId !== null) {
        await this.complete();
        return;
      }
      this.emit({ kind: "starting" });
      if (this.intent === null) {
        try {
          this.intent = await this.input.server.createIntent({
            eventId: this.input.eventId,
            eventDateId: this.input.draft.eventDateId,
            lines: this.input.draft.lines,
            clientRequestId: this.input.clientRequestId,
            buyerPhone: this.input.draft.buyerPhone,
            phoneCountryIso: this.input.draft.phoneCountryIso,
          });
        } catch (error) {
          if (error instanceof DoorTapError && error.code === "tap_not_available") {
            this.emit({ kind: "not_on_this_phone" });
            return;
          }
          this.emit({ kind: "failed", message: serverMessage(error) });
          return;
        }
      }
      // A sale never accepts Apple's terms: terms-not-accepted goes to setup.
      const connected = await this.input.terminal.ensureReaderConnected(this.intent.locationId, {
        mayAcceptTerms: false,
      });
      if (connected.error) {
        this.emitTerminalFailure(connected.error, "Couldn't start Tap to Pay on this phone. Try again.");
        return;
      }
      if (this.paymentIntent === null) {
        const retrieved = await this.input.terminal.retrievePaymentIntent(this.intent.clientSecret);
        if (retrieved.error || retrieved.paymentIntent === undefined) {
          this.emit({ kind: "failed", message: "Couldn't start the payment. Nothing was charged. Try again." });
          return;
        }
        this.paymentIntent = retrieved.paymentIntent;
      }
      await this.collectAndConfirm();
    } finally {
      this.busy = false;
    }
  }

  /** After a decline, PIN request or cancel: tap again on the SAME intent. */
  async tryAnotherCard(): Promise<void> {
    if (this.intent === null || this.paymentIntent === null) {
      await this.start();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    try {
      await this.collectAndConfirm();
    } finally {
      this.busy = false;
    }
  }

  /** Stop waiting for a tap. */
  async cancel(): Promise<void> {
    if (this.state.kind !== "ready") return;
    await this.input.terminal.cancelCollectPaymentMethod();
  }

  /**
   * "Show a pay code instead". Stops waiting for a tap, then cancels the open
   * PaymentIntent on the server (door-tap-intent cancel) before the caller
   * makes a pay code, so the abandoned tap can never be charged too. A failed
   * cancel never blocks the pay code; it is reported. A PaymentIntent Stripe
   * reports as succeeded is recorded instead of replaced.
   */
  async abandonForPayCode(): Promise<PayCodeSwitchOutcome> {
    if (this.succeededPaymentIntentId !== null) {
      await this.retrySave();
      return "already_paid";
    }
    if (this.state.kind === "ready") {
      try {
        await this.input.terminal.cancelCollectPaymentMethod();
      } catch (error) {
        this.input.report?.("door-tap.cancel-collect", error);
      }
    }
    const intent = this.intent;
    if (intent === null) return "switch";
    try {
      await this.input.server.cancelIntent({
        paymentIntentId: intent.paymentIntentId,
        clientRequestId: this.input.clientRequestId,
      });
    } catch (error) {
      if (error instanceof DoorTapError && error.code === "payment_succeeded") {
        this.succeededPaymentIntentId = intent.paymentIntentId;
        await this.retrySave();
        return "already_paid";
      }
      this.input.report?.("door-tap.cancel-intent", error, {
        payment_intent_id: intent.paymentIntentId,
        code: error instanceof DoorTapError ? error.code : null,
      });
    }
    return "switch";
  }

  private emitTerminalFailure(error: TerminalErrorLike, fallbackMessage: string): void {
    const kind = classifyTerminalError(error);
    if (kind === "not_on_this_phone") {
      this.emit({ kind: "not_on_this_phone" });
      return;
    }
    if (kind === "ios_update_required") {
      this.emit({ kind: "ios_update_required" });
      return;
    }
    if (kind === "terms_not_accepted") {
      this.emit({ kind: "needs_setup" });
      return;
    }
    if (isTapReaderProblem(kind)) {
      this.emit({ kind: "reader_problem", problem: kind });
      return;
    }
    if (this.intent === null) {
      this.emit({ kind: "failed", message: fallbackMessage });
      return;
    }
    const amount = this.amount();
    if (kind === "needs_pin") this.emit({ kind: "needs_pin", amount });
    else if (kind === "declined") {
      this.emit({ kind: "declined", amount, cardLabel: cardLabelFor(error.paymentIntent ?? this.paymentIntent ?? undefined) });
    } else if (kind === "timed_out") this.emit({ kind: "timed_out", amount });
    else if (kind === "cancelled") this.emit({ kind: "cancelled", amount });
    else this.emit({ kind: "failed", message: fallbackMessage });
  }

  private async collectAndConfirm(): Promise<void> {
    const amount = this.amount();
    const current = this.paymentIntent;
    if (current === null) return;

    this.emit({ kind: "ready", amount });
    this.input.onBeforeCollect?.();
    const collected = await this.input.terminal.collectPaymentMethod(current);
    if (collected.error || collected.paymentIntent === undefined) {
      if (collected.error?.paymentIntent !== undefined) this.paymentIntent = collected.error.paymentIntent;
      this.emitTerminalFailure(collected.error ?? {}, "The card couldn't be read. Nothing was charged. Try again.");
      return;
    }
    this.paymentIntent = collected.paymentIntent;

    this.collectedPaymentIntent = collected.paymentIntent;
    await this.confirm();
  }

  private async confirm(): Promise<void> {
    const amount = this.amount();
    const collected = this.collectedPaymentIntent;
    if (collected === null) return;
    this.emit({ kind: "reading", amount });
    const confirmed = await this.input.terminal.confirmPaymentIntent(collected);
    if (confirmed.error || confirmed.paymentIntent === undefined) {
      const error = confirmed.error ?? {};
      const after = error.paymentIntent;
      if (after !== undefined) this.paymentIntent = after;
      // Stripe: with no PaymentIntent back, or a timed-out request, the status
      // is unknown and the answer is to confirm the same intent again. Nothing
      // here may say "not charged" or offer a second way to pay.
      if (
        error.code === "REQUEST_TIMED_OUT" ||
        (after === undefined && classifyTerminalError(error) !== "needs_pin")
      ) {
        this.emit({ kind: "unknown_result", amount });
        return;
      }
      if (after?.status === "succeeded") {
        await this.recordSucceeded(after);
        return;
      }
      // "Nothing was charged" is only true when Stripe says it needs a new card.
      if (after?.status !== "requires_payment_method" && classifyTerminalError(error) !== "needs_pin") {
        this.emit({ kind: "unknown_result", amount });
        return;
      }
      this.collectedPaymentIntent = null;
      this.emitTerminalFailure(error, "The payment didn't go through. Nothing was charged. Try again.");
      return;
    }
    this.paymentIntent = confirmed.paymentIntent;
    if (confirmed.paymentIntent.status !== "succeeded") {
      this.collectedPaymentIntent = null;
      this.emit({ kind: "declined", amount, cardLabel: cardLabelFor(confirmed.paymentIntent) });
      return;
    }
    await this.recordSucceeded(confirmed.paymentIntent);
  }

  private async recordSucceeded(paymentIntent: TerminalPaymentIntentLike): Promise<void> {
    this.collectedPaymentIntent = null;
    this.succeededPaymentIntentId = this.intent?.paymentIntentId ?? null;
    this.lastCardLabel = cardLabelFor(paymentIntent);
    await this.complete();
  }

  /** "Try again" on an unknown result: confirm the SAME intent. */
  async retryConfirm(): Promise<void> {
    if (this.busy || this.state.kind !== "unknown_result") return;
    this.busy = true;
    try {
      await this.confirm();
    } finally {
      this.busy = false;
    }
  }

  /** The host closed the sale. An open intent is cancelled unless it's mid-confirm or paid. */
  async closeSale(): Promise<void> {
    const kind = this.state.kind;
    if (kind === "reading" || kind === "saving" || kind === "approved" || kind === "save_failed") return;
    await this.abandonForPayCode();
  }

  /** What a receipt or the sweep's "seen" call needs. */
  getReceiptFacts(): { paymentIntentId: string | null; feeCents: number | null; clientRequestId: string } {
    return {
      paymentIntentId: this.intent?.paymentIntentId ?? null,
      feeCents: this.intent?.feeCents ?? null,
      clientRequestId: this.input.clientRequestId,
    };
  }

  private async complete(): Promise<void> {
    const paymentIntentId = this.succeededPaymentIntentId;
    if (paymentIntentId === null) return;
    const amount = this.amount();
    this.emit({ kind: "saving", amount });
    try {
      const result = await this.input.server.completeIntent({
        paymentIntentId,
        clientRequestId: this.input.clientRequestId,
      });
      this.emit({ kind: "approved", amount, result, cardLabel: this.lastCardLabel });
    } catch {
      this.emit({
        kind: "save_failed",
        amount,
        message: "The card was charged, but the sale didn't save yet. Don't charge again. Tap Try again to finish.",
      });
    }
  }

  /** Retry recording a payment that already succeeded. */
  async retrySave(): Promise<void> {
    if (this.busy || this.succeededPaymentIntentId === null) return;
    this.busy = true;
    try {
      await this.complete();
    } finally {
      this.busy = false;
    }
  }
}
