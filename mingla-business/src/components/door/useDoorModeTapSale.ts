/**
 * #4389 Door mode — Tap to Pay run from the door sale screen itself.
 *
 * The money logic is the existing TapToPaySaleFlow on the app's one Stripe
 * Terminal session (TapToPayTerminalHost); only where its states are shown
 * changes. Apple's own sheet takes the card over this screen, so a happy sale
 * never changes screen: ready/reading/saving show on the Charge button, approved
 * shows the green Paid overlay.
 *
 * - One flow per sale attempt, so one clientRequestId per attempt. A second
 *   Charge while a flow runs never starts another. A retry with the same basket
 *   taps again on the SAME intent (tryAnotherCard), so a decline then a retry is
 *   one order; a changed basket closes the old intent first.
 * - Anything a door screen can't show in place (setup, an iOS update, not on
 *   this phone, the Terminal session failing) hands the basket to the existing
 *   Tap to Pay route, which owns those states, via `handOff`.
 * - The basket is never cleared here: a failure leaves the tickets as they were.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { tapPaidAfterCloseCopy } from "../../constants/tapToPayCopy";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { doorSaleKeys } from "../../hooks/useEventDoorSales";
import { postHogService } from "../../services/postHogService";
import {
  cancelDoorTapIntent,
  completeDoorTapIntent,
  createDoorTapIntent,
  markDoorTapOutcomeSeen,
} from "../../services/terminal/doorTapEdge";
import type { TapToPayDraft } from "../../services/terminal/tapToPayDraft";
import {
  shouldReportTapSeen,
  TapToPaySaleFlow,
  type TapAmount,
  type TapSaleState,
} from "../../services/terminal/tapToPayFlow";
import { useTapToPayTerminal } from "../../services/terminal/tapToPaySession";
import { consumeDoorTapPress, markDoorTapPress } from "../../services/terminal/tapTiming";
import { getTapToPaySession } from "../../services/terminal/tapToPaySession";
import { formatCurrency, majorFromMinor } from "../../utils/currency";
import { randomUuid } from "../../utils/randomId";

export const formatTapAmount = (amount: TapAmount): string =>
  formatCurrency(majorFromMinor(amount.totalCents, amount.currency), amount.currency);

/** States the door screen hands to the Tap to Pay route instead of showing in place. */
export const TAP_HANDOFF_KINDS: ReadonlySet<TapSaleState["kind"]> = new Set([
  "needs_setup",
  "not_on_this_phone",
  "ios_update_required",
]);

/** A retry with the same basket taps again on the same intent. */
const SAME_INTENT_RETRY: ReadonlySet<TapSaleState["kind"]> = new Set([
  "declined",
  "needs_pin",
  "timed_out",
  "cancelled",
]);

/** A flow in these states may be thrown away (closeSale cancels its intent). */
const DISCARDABLE: ReadonlySet<TapSaleState["kind"]> = new Set([
  "idle",
  "starting",
  "ready",
  "declined",
  "needs_pin",
  "timed_out",
  "cancelled",
  "failed",
  "reader_problem",
  "approved",
  ...TAP_HANDOFF_KINDS,
]);

export interface DoorModeTapSale {
  state: TapSaleState;
  /** Charge: start, retry on the same intent, or replace a stale basket. */
  charge: (draft: TapToPayDraft, basketKey: string) => void;
  /** Close the current attempt (method change, basket change, leaving). */
  discard: () => void;
  /** After the Paid overlay: the next sale is a new attempt. */
  reset: () => void;
  checkAgain: () => Promise<void>;
  saveAgain: () => Promise<void>;
  receiptFacts: () => { paymentIntentId: string | null; feeCents: number | null };
  busy: boolean;
}

export const useDoorModeTapSale = (input: {
  eventId: string;
  /** The Tap to Pay route takes over (setup, update, not on this phone). */
  handOff: (draft: TapToPayDraft) => void;
}): DoorModeTapSale => {
  const { eventId, handOff } = input;
  const queryClient = useQueryClient();
  const terminal = useTapToPayTerminal();
  const [state, setState] = useState<TapSaleState>({ kind: "idle" });
  const flowRef = useRef<TapToPaySaleFlow | null>(null);
  const basketRef = useRef<string | null>(null);
  const draftRef = useRef<TapToPayDraft | null>(null);
  // A Charge pressed while the Terminal session was still starting.
  // #4389 — `restarted`: Terminal had failed to start (e.g. the app opened with
  // the server unreachable), so this Charge restarted it; `sawStart` turns true
  // once that restart is under way, so the old failure is not read as the new one.
  const pendingRef = useRef<{ draft: TapToPayDraft; basketKey: string; restarted?: boolean; sawStart?: boolean } | null>(null);
  const handOffRef = useRef(handOff);
  handOffRef.current = handOff;

  const discard = useCallback((): void => {
    const flow = flowRef.current;
    pendingRef.current = null;
    if (flow === null) return;
    if (!DISCARDABLE.has(flow.getState().kind)) return;
    flowRef.current = null;
    basketRef.current = null;
    setState({ kind: "idle" });
    void flow.closeSale().catch((error: unknown) => reportNonFatal("door-mode.tap-close", error));
  }, []);

  const begin = useCallback(
    (draft: TapToPayDraft, basketKey: string): void => {
      const client = getTapToPaySession().client;
      if (client === null) return;
      const flow = new TapToPaySaleFlow({
        eventId,
        draft,
        clientRequestId: randomUuid(),
        terminal: client,
        server: {
          createIntent: createDoorTapIntent,
          completeIntent: completeDoorTapIntent,
          cancelIntent: cancelDoorTapIntent,
        },
        onState: (next) => {
          if (flowRef.current !== flow) return;
          setState(next);
        },
        onBeforeCollect: () => {
          const timing = consumeDoorTapPress();
          if (timing !== null) postHogService.capture("door_tap_ui_ms", { ms: timing.ms, warm: timing.warm });
        },
        report: reportNonFatal,
        // The host left the door screen mid-tap: a native alert still reaches them.
        onPaidAfterClose: ({ amount, saved }) => {
          void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
          const copy = tapPaidAfterCloseCopy(formatTapAmount(amount), saved);
          Alert.alert(copy.title, copy.body);
        },
      });
      flowRef.current = flow;
      basketRef.current = basketKey;
      draftRef.current = draft;
      void flow.start();
    },
    [eventId, queryClient],
  );

  const charge = useCallback(
    (draft: TapToPayDraft, basketKey: string): void => {
      // Already waiting for the Terminal session: the same press, not a new sale.
      if (pendingRef.current !== null) return;
      const flow = flowRef.current;
      if (flow !== null) {
        const kind = flow.getState().kind;
        if (basketRef.current === basketKey) {
          if (SAME_INTENT_RETRY.has(kind)) {
            markDoorTapPress(getTapToPaySession().readerReady);
            void flow.tryAnotherCard();
            return;
          }
          if (kind === "failed" || kind === "reader_problem") {
            void flow.start();
            return;
          }
          // In flight (starting, ready, reading, saving) or settled: never a second charge.
          if (kind !== "approved") return;
        }
        if (!DISCARDABLE.has(kind)) return;
        discard();
      }
      markDoorTapPress(getTapToPaySession().readerReady);
      const session = getTapToPaySession();
      if (session.status === "unavailable") {
        handOffRef.current(draft);
        return;
      }
      // #4389 — a phone already set up for this brand whose Terminal start
      // failed earlier: start it again and carry on with this Charge ("Getting
      // ready…" in place), instead of sending the host to the setup screen.
      if (session.status === "error") {
        pendingRef.current = { draft, basketKey, restarted: true, sawStart: false };
        setState({ kind: "starting" });
        session.retryInitialize();
        return;
      }
      if (session.status !== "ready" || session.client === null) {
        pendingRef.current = { draft, basketKey };
        setState({ kind: "starting" });
        return;
      }
      begin(draft, basketKey);
    },
    [begin, discard],
  );

  // A Charge that waited for the Terminal session.
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null) return;
    if (terminal.status === "ready" && terminal.client !== null) {
      pendingRef.current = null;
      begin(pending.draft, pending.basketKey);
    } else if (terminal.status === "initializing") {
      pending.sawStart = true;
    } else if (terminal.status === "error" && pending.restarted === true && pending.sawStart !== true) {
      // Still the earlier failure: the restart has not begun yet.
      return;
    } else if (terminal.status === "error" || terminal.status === "unavailable") {
      pendingRef.current = null;
      setState({ kind: "idle" });
      handOffRef.current(pending.draft);
    }
  }, [begin, terminal.status, terminal.client]);

  // States the Tap to Pay route owns: close this attempt and hand the basket over.
  useEffect(() => {
    if (!TAP_HANDOFF_KINDS.has(state.kind)) return;
    const draft = draftRef.current;
    discard();
    if (draft !== null) handOffRef.current(draft);
  }, [state.kind, discard]);

  // Side effects of the end states, the same as the Tap to Pay screen's.
  useEffect(() => {
    if (state.kind === "approved") {
      void queryClient.invalidateQueries({ queryKey: doorSaleKeys.byEvent(eventId) });
      postHogService.capture("door_sale_recorded", {
        method: "tap_to_pay",
        has_phone: draftRef.current?.buyerPhone != null,
        ticket_count: draftRef.current?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0,
      });
    } else if (state.kind === "needs_pin" || state.kind === "declined" || state.kind === "failed") {
      postHogService.capture("door_sale_failed", { reason: `tap_${state.kind}` });
    }
  }, [state, queryClient, eventId]);

  // The host saw how the tap ended, so the server needn't push about it later.
  useEffect(() => {
    const report = (appState: string | null): void => {
      const facts = flowRef.current?.getReceiptFacts();
      if (!shouldReportTapSeen(state.kind, appState) || !facts?.paymentIntentId) return;
      void markDoorTapOutcomeSeen({
        paymentIntentId: facts.paymentIntentId,
        clientRequestId: facts.clientRequestId,
      }).catch((error: unknown) => reportNonFatal("door-mode.tap-seen", error));
    };
    report(AppState.currentState);
    if (AppState.currentState === "active") return undefined;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") report(next);
    });
    return () => subscription.remove();
  }, [state.kind]);

  // A phone that slept while waiting: the flow rechecks the intent's age.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void flowRef.current?.recheckOnForeground().catch((error: unknown) => reportNonFatal("door-mode.tap-wake", error));
    });
    return () => subscription.remove();
  }, []);

  // Leaving the door screen closes an open attempt (a paid one is still recorded).
  useEffect(
    () => () => {
      const flow = flowRef.current;
      flowRef.current = null;
      void flow?.closeSale().catch((error: unknown) => reportNonFatal("door-mode.tap-close", error));
    },
    [],
  );

  const reset = useCallback((): void => {
    flowRef.current = null;
    basketRef.current = null;
    draftRef.current = null;
    setState({ kind: "idle" });
  }, []);

  const checkAgain = useCallback(async (): Promise<void> => {
    await flowRef.current?.retryConfirm();
  }, []);

  const saveAgain = useCallback(async (): Promise<void> => {
    await flowRef.current?.retrySave();
  }, []);

  const receiptFacts = useCallback(() => {
    const facts = flowRef.current?.getReceiptFacts();
    return { paymentIntentId: facts?.paymentIntentId ?? null, feeCents: facts?.feeCents ?? null };
  }, []);

  const busy =
    state.kind === "starting" || state.kind === "ready" || state.kind === "reading" || state.kind === "saving";

  return { state, charge, discard, reset, checkAgain, saveAgain, receiptFacts, busy };
};
