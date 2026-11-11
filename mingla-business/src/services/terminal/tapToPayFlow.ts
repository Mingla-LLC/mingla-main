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
  DoorTapErrorCode,
  DoorTapIntent,
} from "./doorTapEdge";
import { DoorTapError } from "./doorTapEdge";
import { randomUuid } from "../../utils/randomId";
import { type TapReaderProblem } from "../../constants/tapToPayCopy";

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
 *  - "blocked": the result is unknown and the cancel didn't land, so nothing says
 *    this tap can't still charge. No pay code.
 */
export type PayCodeSwitchOutcome = "switch" | "already_paid" | "blocked";

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
  /**
   * `refusal` marks a hard server refusal for this event (tax added at
   * checkout): retrying or a pay code gets the same answer, so the screen only
   * offers the way back.
   */
  | { kind: "failed"; message: string; refusal?: "tax_added_at_checkout" };

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
        return "Card taps aren't available for this brand. Use a pay code instead.";
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
      case "buyer_name_invalid":
        return "Check the buyer's name and try again.";
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
  /**
   * A tap Stripe reports paid after the host closed the sale (closeSale). It is
   * recorded (saved) or left to the webhook backstop (not saved yet); either way
   * the app tells the host, so they don't take the money again.
   */
  onPaidAfterClose?: (outcome: { amount: TapAmount; saved: boolean }) => void;
}

/**
 * No ready screen waits on an intent older than this. The age counts from the
 * intent's creation (the first create call for its clientRequestId, which is no
 * later than the server's created_at), not from each ready window, so "Try again"
 * or "Try another card" never re-arms it. Past the limit the screen shows the
 * sale cancelled, and the next try cancels the old intent on the server and
 * makes a fresh one. The server's unfinished-tap sweep (door-tap-intent,
 * UNFINISHED_AFTER_MS = 15 minutes from created_at) only runs after it, so it
 * never cancels or pushes about a sale the host is still looking at.
 */
export const TAP_READY_LIMIT_MS = 10 * 60 * 1000;

/** Shown after a pay code that couldn't be made stopped a tap that was starting. */
export const TAP_RESTART_MESSAGE = "The tap stopped. Try again to take the card.";

/** A stale intent's cancel didn't land: its state is unconfirmed, so no "nothing was charged". */
export const TAP_REPLACE_FAILED_MESSAGE = "Couldn't start a new payment. Check your connection and try again.";

/** A clock that wall-clock changes don't move (falls back to Date.now). */
const monotonicNow = (): number => {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
};

/** Create failures after which the server may still have made the intent. */
const UNCLEAR_CREATE_FAILURES: ReadonlySet<DoorTapErrorCode> = new Set<DoorTapErrorCode>([
  "network_error",
  "server_error",
  "invalid_response",
  "unknown",
]);

const amountOf = (intent: DoorTapIntent): TapAmount => ({
  totalCents: intent.totalCents,
  currency: intent.currency,
});

/** When an intent's clock started, on both clocks. */
interface IntentClock {
  monotonic: number;
  wall: number;
}

const startIntentClock = (): IntentClock => ({ monotonic: monotonicNow(), wall: Date.now() });

/**
 * How old the intent is. The monotonic clock (performance.now) stops while the
 * phone sleeps (CLOCK_UPTIME_RAW on iOS, CLOCK_MONOTONIC on Android), but the
 * server's sweep keeps counting; the wall clock counts sleep but can be moved.
 * The larger of the two is used, so a sleep or a forward clock change can only
 * make the window shorter, never longer.
 */
const intentAgeMs = (clock: IntentClock): number =>
  Math.max(monotonicNow() - clock.monotonic, Date.now() - clock.wall);

export class TapToPaySaleFlow {
  private readonly input: TapToPaySaleFlowInput;
  private intent: DoorTapIntent | null = null;
  private paymentIntent: TerminalPaymentIntentLike | null = null;
  private collectedPaymentIntent: TerminalPaymentIntentLike | null = null;
  /**
   * The tap Stripe charged, with what recording it needs. Kept apart from
   * `intent`, which a close or a replacement may forget while a confirm or a
   * complete is still answering.
   */
  private succeeded: { paymentIntentId: string; clientRequestId: string; amount: TapAmount } | null = null;
  private lastCardLabel: string | null = null;
  private busy = false;
  private state: TapSaleState = { kind: "idle" };
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  /** One per intent: a stale intent is replaced under a new id (see TAP_READY_LIMIT_MS). */
  private clientRequestId: string;
  /** When the first create call for clientRequestId was sent. */
  private intentClockStart: IntentClock | null = null;
  /**
   * Set by closeSale and abandonForPayCode: no path may create, retrieve or
   * collect after it. An intent that arrives after it is cancelled on the server
   * at once (recorded instead if Stripe says it was paid).
   */
  private closed = false;
  /** closeSale only: the screen is gone, so a late payment is reported via onPaidAfterClose. */
  private hostLeft = false;
  /** Request ids for which an intent may exist on the server (see createIntent). */
  private readonly intentMayExist = new Set<string>();
  /** reopen() arrived while a step was running: applied when it ends (endStep). */
  private reopenPending = false;
  /** A charged tap found while a step was running: recorded when it ends (endStep). */
  private saveWhenStopped = false;
  /** recheckOnForeground stopped a stale ready screen: replaced when the step ends. */
  private replaceWhenStopped = false;
  /** Stripe reported the current intent canceled (the sweep, or a cancel elsewhere): the next try replaces it. */
  private intentCanceled = false;

  constructor(input: TapToPaySaleFlowInput) {
    this.input = input;
    this.clientRequestId = input.clientRequestId;
  }

  /** How long the ready screen may still wait on the current intent. */
  private readyTimeLeftMs(): number {
    if (this.intentClockStart === null) return TAP_READY_LIMIT_MS;
    return TAP_READY_LIMIT_MS - intentAgeMs(this.intentClockStart);
  }

  /**
   * The current intent reached TAP_READY_LIMIT_MS: cancel it on the server and
   * forget it, so the next collect is on a fresh intent under a new id. Returns
   * false when it must not be replaced: Stripe says it already succeeded (the sale
   * is recorded instead) or the cancel didn't land (the host is told to try again).
   */
  private async replaceStaleIntent(): Promise<boolean> {
    const intent = this.intent;
    if (intent === null || (this.readyTimeLeftMs() > 0 && !this.intentCanceled)) return true;
    this.emit({ kind: "starting" });
    try {
      await this.input.server.cancelIntent({
        paymentIntentId: intent.paymentIntentId,
        clientRequestId: this.clientRequestId,
      });
    } catch (error) {
      if (error instanceof DoorTapError && error.code === "payment_succeeded") {
        this.markSucceeded(intent, this.clientRequestId);
        await this.complete();
        return false;
      }
      this.input.report?.("door-tap.replace-stale-intent", error, {
        payment_intent_id: intent.paymentIntentId,
        code: error instanceof DoorTapError ? error.code : null,
      });
      // The old intent's state is unconfirmed, so this never says nothing was charged.
      this.emit({ kind: "failed", message: TAP_REPLACE_FAILED_MESSAGE });
      return false;
    }
    this.forgetIntent();
    return !this.closed;
  }

  /** The current intent is cancelled on the server: the next sale starts a fresh one. */
  private forgetIntent(): void {
    this.intent = null;
    this.paymentIntent = null;
    this.collectedPaymentIntent = null;
    this.clientRequestId = randomUuid();
    this.intentClockStart = null;
    this.intentCanceled = false;
  }

  /**
   * Stripe says the intent is canceled: no money can move on it, so the host is
   * shown the tap as cancelled (not an unknown result), and "Try again" starts a
   * fresh intent.
   */
  private emitIntentCanceled(amount: TapAmount): void {
    this.intentCanceled = true;
    this.collectedPaymentIntent = null;
    this.emit({ kind: "cancelled", amount });
  }

  /** Stripe charged this intent: remember it with its own id and amount for recording. */
  private markSucceeded(intent: DoorTapIntent, clientRequestId: string): void {
    this.succeeded = { paymentIntentId: intent.paymentIntentId, clientRequestId, amount: amountOf(intent) };
  }

  /**
   * An intent that came back after the sale was closed: cancel it on the server
   * at once and never collect on it. If Stripe says it was paid, record the sale.
   */
  private async settleIntentAfterClose(intent: DoorTapIntent, clientRequestId: string): Promise<void> {
    try {
      await this.input.server.cancelIntent({ paymentIntentId: intent.paymentIntentId, clientRequestId });
      // That request id now names a cancelled intent: a later start (after a
      // reopen) must not replay it, so it gets a fresh id and clock.
      if (this.intent?.paymentIntentId === intent.paymentIntentId || this.clientRequestId === clientRequestId) {
        this.forgetIntent();
      }
    } catch (error) {
      if (error instanceof DoorTapError && error.code === "payment_succeeded") {
        this.markSucceeded(intent, clientRequestId);
        await this.complete();
        return;
      }
      this.input.report?.("door-tap.cancel-after-close", error, {
        payment_intent_id: intent.paymentIntentId,
        code: error instanceof DoorTapError ? error.code : null,
      });
    }
  }

  getState(): TapSaleState {
    return this.state;
  }

  private emit(state: TapSaleState): void {
    this.clearReadyTimer();
    this.state = state;
    if (state.kind === "ready") {
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null;
        this.cancel().catch((error: unknown) => this.input.report?.("door-tap.ready-limit", error));
      }, Math.max(0, this.readyTimeLeftMs()));
      // Node (tests) only: a waiting screen's timer never keeps the process alive.
      (this.readyTimer as { unref?: () => void }).unref?.();
    }
    this.input.onState(state);
  }

  private clearReadyTimer(): void {
    if (this.readyTimer === null) return;
    clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }


  /** Begin (or resume) the sale. Safe to call again after a failure. */
  async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.succeeded !== null) {
        await this.complete();
        return;
      }
      if (this.closed) return;
      if (!(await this.replaceStaleIntent())) return;
      this.emit({ kind: "starting" });
      if (this.intent === null) {
        if (!(await this.createIntent())) return;
        // A replayed create (its first answer was lost) hands back the intent the
        // first call made, which can already be past the limit: replace it before
        // any ready screen or Apple's sheet.
        if (this.readyTimeLeftMs() <= 0) {
          if (!(await this.replaceStaleIntent())) return;
          if (!(await this.createIntent())) return;
        }
      }
      const intent = this.intent;
      if (intent === null || this.closed) return;
      // A sale never accepts Apple's terms: terms-not-accepted goes to setup.
      const connected = await this.input.terminal.ensureReaderConnected(intent.locationId, {
        mayAcceptTerms: false,
      });
      if (this.closed) return;
      if (connected.error) {
        this.emitTerminalFailure(connected.error, "Couldn't get this phone ready to take cards. Try again.");
        return;
      }
      if (this.paymentIntent === null) {
        const retrieved = await this.input.terminal.retrievePaymentIntent(intent.clientSecret);
        if (this.closed) return;
        if (retrieved.error || retrieved.paymentIntent === undefined) {
          this.emit({ kind: "failed", message: "Couldn't start the payment. Nothing was charged. Try again." });
          return;
        }
        this.paymentIntent = retrieved.paymentIntent;
        if (retrieved.paymentIntent.status === "canceled") {
          this.emitIntentCanceled(amountOf(intent));
          return;
        }
      }
      await this.collectAndConfirm();
    } finally {
      this.endStep();
    }
  }

  /** door-tap-intent create for the current request id. False when nothing usable came back. */
  private async createIntent(): Promise<boolean> {
    // A replayed create returns the intent the first call made: keep its clock.
    if (this.intentClockStart === null) this.intentClockStart = startIntentClock();
    const clientRequestId = this.clientRequestId;
    let created: DoorTapIntent;
    try {
      created = await this.input.server.createIntent({
        eventId: this.input.eventId,
        eventDateId: this.input.draft.eventDateId,
        lines: this.input.draft.lines,
        clientRequestId,
        buyerPhone: this.input.draft.buyerPhone,
        phoneCountryIso: this.input.draft.phoneCountryIso,
        buyerName: this.input.draft.buyerName ?? null,
      });
    } catch (error) {
      // An unclear failure (lost answer, server error) may have made an intent
      // for this id, so its clock keeps running from then on, whatever a later
      // call says: the server checks access, release and the brand before it
      // looks for a replay, so a later refusal can't prove no intent exists.
      // Only a refusal for an id that never had an unclear answer (and never
      // got an intent back) starts the next try on a fresh clock.
      if (!(error instanceof DoorTapError) || UNCLEAR_CREATE_FAILURES.has(error.code)) {
        this.intentMayExist.add(clientRequestId);
      } else if (!this.intentMayExist.has(clientRequestId)) {
        this.intentClockStart = null;
      }
      if (this.closed) return false;
      // The brand's address is incomplete: not this phone's fault. Setup says
      // what to add (TAP_ADDRESS_MISSING_COPY), with the draft kept.
      if (error instanceof DoorTapError && error.code === "tap_not_available" && error.detail === "address_missing") {
        this.emit({ kind: "needs_setup" });
        return false;
      }
      if (error instanceof DoorTapError && error.code === "tap_not_available") {
        this.emit({ kind: "not_on_this_phone" });
        return false;
      }
      if (error instanceof DoorTapError && error.code === "door_tax_added_at_checkout") {
        this.emit({ kind: "failed", message: serverMessage(error), refusal: "tax_added_at_checkout" });
        return false;
      }
      this.emit({ kind: "failed", message: serverMessage(error) });
      return false;
    }
    this.intentMayExist.add(clientRequestId);
    if (this.closed) {
      await this.settleIntentAfterClose(created, clientRequestId);
      return false;
    }
    this.intent = created;
    return true;
  }

  /** After a decline, PIN request or cancel: tap again on the SAME intent. */
  async tryAnotherCard(): Promise<void> {
    if (this.closed) return;
    if (this.intent === null || this.paymentIntent === null) {
      await this.start();
      return;
    }
    if (this.busy) return;
    if (this.readyTimeLeftMs() <= 0 || this.intentCanceled) {
      await this.start();
      return;
    }
    this.busy = true;
    try {
      await this.collectAndConfirm();
    } finally {
      this.endStep();
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
    // A card being read or a sale being saved may already have charged: never a
    // second way to pay (the same states closeSale leaves alone).
    if (this.state.kind === "reading" || this.state.kind === "saving") return "blocked";
    this.closed = true;
    if (this.succeeded !== null) {
      await this.saveSucceeded();
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
        clientRequestId: this.clientRequestId,
      });
    } catch (error) {
      if (error instanceof DoorTapError && error.code === "payment_succeeded") {
        this.markSucceeded(intent, this.clientRequestId);
        await this.saveSucceeded();
        return "already_paid";
      }
      this.input.report?.("door-tap.cancel-intent", error, {
        payment_intent_id: intent.paymentIntentId,
        code: error instanceof DoorTapError ? error.code : null,
      });
      if (this.state.kind === "unknown_result" && !this.hostLeft) {
        // The sale stays on screen: its only way on is confirming the same intent.
        this.closed = false;
        return "blocked";
      }
      return "switch";
    }
    if (this.intent?.paymentIntentId === intent.paymentIntentId) this.forgetIntent();
    return "switch";
  }

  /**
   * The pay code couldn't be made after abandonForPayCode: the tap screen stays,
   * so a new tap may start again (on a fresh intent: the old one was cancelled).
   */
  reopen(): void {
    if (this.hostLeft) return;
    // A step still running (a create, retrieve or cancel in flight) saw the flow
    // closed and will stop at its next check; reopening under it would let it
    // carry on with an intent that was cancelled. Reopen once it has ended.
    if (this.busy) {
      this.reopenPending = true;
      return;
    }
    this.applyReopen();
  }

  private applyReopen(): void {
    this.reopenPending = false;
    this.closed = false;
    // A start that stopped because of the close left the screen on "Starting…":
    // give the host a way on. Try again starts a fresh intent.
    if (this.state.kind === "starting" || this.state.kind === "idle") {
      this.emit({ kind: "failed", message: TAP_RESTART_MESSAGE });
    }
  }

  /** Ends a step started with `busy = true`; runs what waited for it. */
  private endStep(): void {
    this.busy = false;
    if (this.reopenPending) this.applyReopen();
    if (this.saveWhenStopped) {
      this.saveWhenStopped = false;
      this.retrySave().catch((error: unknown) => this.input.report?.("door-tap.save-after-stop", error));
      return;
    }
    if (this.replaceWhenStopped) {
      this.replaceWhenStopped = false;
      if (!this.closed && this.state.kind === "cancelled") {
        this.tryAnotherCard().catch((error: unknown) => this.input.report?.("door-tap.replace-on-wake", error));
      }
    }
  }

  /** Records a charged tap now, or as soon as the step in flight ends. */
  private async saveSucceeded(): Promise<void> {
    if (this.busy) {
      this.saveWhenStopped = true;
      return;
    }
    await this.retrySave();
  }

  /**
   * The app came back to the foreground. The ready timer is a JS timer that a
   * sleeping phone holds back, so a ready screen can wake past the limit: stop
   * the tap and, once it has stopped, start a fresh intent.
   */
  async recheckOnForeground(): Promise<void> {
    if (this.closed || this.state.kind !== "ready" || this.readyTimeLeftMs() > 0) return;
    this.clearReadyTimer();
    this.replaceWhenStopped = true;
    await this.cancel();
  }

  private emitTerminalFailure(error: TerminalErrorLike, fallbackMessage: string, stepAmount?: TapAmount): void {
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
    const amount = stepAmount ?? (this.intent === null ? null : amountOf(this.intent));
    if (amount === null) {
      this.emit({ kind: "failed", message: fallbackMessage });
      return;
    }
    if (kind === "needs_pin") this.emit({ kind: "needs_pin", amount });
    else if (kind === "declined") {
      this.emit({ kind: "declined", amount, cardLabel: cardLabelFor(error.paymentIntent ?? this.paymentIntent ?? undefined) });
    } else if (kind === "timed_out") this.emit({ kind: "timed_out", amount });
    else if (kind === "cancelled") this.emit({ kind: "cancelled", amount });
    else this.emit({ kind: "failed", message: fallbackMessage });
  }

  /**
   * The intent one collect-and-confirm step works on, captured at its start: a
   * close or a replacement may forget `this.intent` while the step is waiting.
   */
  private stepContext(): { intent: DoorTapIntent; clientRequestId: string; amount: TapAmount } | null {
    const intent = this.intent;
    if (intent === null) return null;
    return { intent, clientRequestId: this.clientRequestId, amount: amountOf(intent) };
  }

  private async collectAndConfirm(): Promise<void> {
    if (this.closed) return;
    const step = this.stepContext();
    const current = this.paymentIntent;
    if (step === null || current === null) return;
    const { amount } = step;

    this.emit({ kind: "ready", amount });
    this.input.onBeforeCollect?.();
    const collected = await this.input.terminal.collectPaymentMethod(current);
    if (collected.error || collected.paymentIntent === undefined) {
      if (collected.error?.paymentIntent !== undefined) this.paymentIntent = collected.error.paymentIntent;
      if (collected.error?.paymentIntent?.status === "canceled") {
        this.emitIntentCanceled(amount);
        return;
      }
      this.emitTerminalFailure(collected.error ?? {}, "The card couldn't be read. Nothing was charged. Try again.", amount);
      return;
    }
    // The card was read as the host closed: never charge it. The close's server
    // cancel finishes the intent (Stripe can't charge a card that was only read).
    if (this.closed) return;
    this.paymentIntent = collected.paymentIntent;

    this.collectedPaymentIntent = collected.paymentIntent;
    await this.confirm(step);
  }

  private async confirm(step: { intent: DoorTapIntent; clientRequestId: string; amount: TapAmount }): Promise<void> {
    const { amount } = step;
    const collected = this.collectedPaymentIntent;
    if (collected === null) return;
    this.emit({ kind: "reading", amount });
    const confirmed = await this.input.terminal.confirmPaymentIntent(collected);
    if (confirmed.error || confirmed.paymentIntent === undefined) {
      const error = confirmed.error ?? {};
      const after = error.paymentIntent;
      if (after !== undefined) this.paymentIntent = after;
      if (after?.status === "succeeded") {
        await this.recordSucceeded(after, step);
        return;
      }
      if (after?.status === "canceled") {
        this.emitIntentCanceled(amount);
        return;
      }
      // Stripe: with no PaymentIntent back, or a timed-out request, the status is
      // unknown and the answer is to confirm the same intent again. "Nothing was
      // charged" is only true when Stripe says it needs a new card, so anything
      // else (processing included) may not say that or offer a second way to pay.
      if (
        error.code === "REQUEST_TIMED_OUT" ||
        (after !== undefined && after.status !== "requires_payment_method") ||
        (after === undefined && classifyTerminalError(error) !== "needs_pin")
      ) {
        this.emit({ kind: "unknown_result", amount });
        return;
      }
      this.collectedPaymentIntent = null;
      this.emitTerminalFailure(error, "The payment didn't go through. Nothing was charged. Try again.", amount);
      return;
    }
    this.paymentIntent = confirmed.paymentIntent;
    if (confirmed.paymentIntent.status === "canceled") {
      this.emitIntentCanceled(amount);
      return;
    }
    if (confirmed.paymentIntent.status === "requires_payment_method") {
      this.collectedPaymentIntent = null;
      this.emit({ kind: "declined", amount, cardLabel: cardLabelFor(confirmed.paymentIntent) });
      return;
    }
    if (confirmed.paymentIntent.status !== "succeeded") {
      // processing, requires_capture or anything else Stripe hasn't settled: the
      // result is unknown. Keep the collected intent so "Check again" confirms it.
      this.emit({ kind: "unknown_result", amount });
      return;
    }
    await this.recordSucceeded(confirmed.paymentIntent, step);
  }

  private async recordSucceeded(
    paymentIntent: TerminalPaymentIntentLike,
    step: { intent: DoorTapIntent; clientRequestId: string },
  ): Promise<void> {
    this.collectedPaymentIntent = null;
    this.markSucceeded(step.intent, step.clientRequestId);
    this.lastCardLabel = cardLabelFor(paymentIntent);
    await this.complete();
  }

  /** "Check again" on an unknown result: confirm the SAME intent. */
  async retryConfirm(): Promise<void> {
    if (this.busy || this.state.kind !== "unknown_result") return;
    const step = this.stepContext();
    if (step === null) return;
    this.busy = true;
    try {
      await this.confirm(step);
    } finally {
      this.endStep();
    }
  }

  /** The host closed the sale. An open intent is cancelled unless it's mid-confirm or paid. */
  async closeSale(): Promise<void> {
    this.closed = true;
    this.hostLeft = true;
    this.clearReadyTimer();
    const kind = this.state.kind;
    if (kind === "reading" || kind === "saving" || kind === "approved" || kind === "save_failed") return;
    await this.abandonForPayCode();
  }

  /** What a receipt or the sweep's "seen" call needs. */
  getReceiptFacts(): { paymentIntentId: string | null; feeCents: number | null; clientRequestId: string } {
    return {
      paymentIntentId: this.succeeded?.paymentIntentId ?? this.intent?.paymentIntentId ?? null,
      feeCents: this.intent?.feeCents ?? null,
      clientRequestId: this.succeeded?.clientRequestId ?? this.clientRequestId,
    };
  }

  private async complete(): Promise<void> {
    const succeeded = this.succeeded;
    if (succeeded === null) return;
    const { paymentIntentId, clientRequestId, amount } = succeeded;
    this.emit({ kind: "saving", amount });
    try {
      const result = await this.input.server.completeIntent({ paymentIntentId, clientRequestId });
      this.emit({ kind: "approved", amount, result, cardLabel: this.lastCardLabel });
      if (this.hostLeft) this.input.onPaidAfterClose?.({ amount, saved: true });
    } catch {
      this.emit({
        kind: "save_failed",
        amount,
        message: "The card was charged, but the sale didn't save yet. Don't charge again. Tap Save again to finish.",
      });
      if (this.hostLeft) this.input.onPaidAfterClose?.({ amount, saved: false });
    }
  }

  /** Retry recording a payment that already succeeded. */
  async retrySave(): Promise<void> {
    if (this.busy || this.succeeded === null) return;
    this.busy = true;
    try {
      await this.complete();
    } finally {
      this.endStep();
    }
  }
}
