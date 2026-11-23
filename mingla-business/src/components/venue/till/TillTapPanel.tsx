/**
 * #4490 spec 08 O2 — Tap to pay inside the payment sheet. The same
 * TapToPaySaleFlow and the app's one Terminal session as the event door
 * (no new native module): scope "till", TillTapServer (door-tap-intent scope
 * till). The pending payment and its carrier already exist (venue-till
 * pay_tap_start); the amount is the carrier's, never typed here.
 *
 * Shown only when tillTapOffer says "ready" (a supported phone in a build with
 * the Terminal module and entitlement). Anything the phone cannot do ends with
 * the reason and a way back to Scan to pay.
 */
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { reportNonFatal } from "../../../diagnostics/reportNonFatal";
import { cancelTillCardPayment, TillError } from "../../../services/venueTillService";
import { createTillTapServer } from "../../../services/terminal/doorTapEdge";
import { getTillStaffSession } from "../../../services/tillStaffSession";
import { TapToPaySaleFlow, type TapSaleState } from "../../../services/terminal/tapToPayFlow";
import { getTapToPaySession } from "../../../services/terminal/tapToPaySession";
import { formatCurrency } from "../../../utils/currency";
import { randomUuid } from "../../../utils/randomId";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Spinner } from "../../ui/Spinner";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import { tillTapPanelCopy, tillTapResumedCopy } from "./tillTapPanelModel";

export interface TillTapPanelProps {
  venueId: string;
  paymentId: string;
  chargedMinor: number;
  currency: string;
  onPaid: () => void;
  /** The tap ended without money (declined and given up, not on this phone…): back to choosing. */
  onScanInstead: () => void;
  onBusyChange: (busy: boolean) => void;
  /** O2 fix 3: found waiting on reopen; no reader is started, only Cancel payment. */
  resumed?: boolean;
}

const EMPTY_DRAFT = { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null, buyerName: null };

export function TillTapPanel({
  venueId,
  paymentId,
  chargedMinor,
  currency,
  onPaid,
  onScanInstead,
  onBusyChange,
  resumed = false,
}: TillTapPanelProps): React.ReactElement {
  const [state, setState] = useState<TapSaleState>({ kind: "idle" });
  const flowRef = useRef<TapToPaySaleFlow | null>(null);
  const paidRef = useRef(false);

  useEffect(() => {
    if (resumed) return undefined;
    const client = getTapToPaySession().client;
    if (client === null) {
      setState({ kind: "not_on_this_phone" });
      return undefined;
    }
    const flow = new TapToPaySaleFlow({
      scope: { kind: "till", venueId, paymentId },
      draft: EMPTY_DRAFT,
      clientRequestId: randomUuid(),
      terminal: client,
      server: createTillTapServer({ venueId, paymentId, staffSession: getTillStaffSession(venueId)?.token ?? null }),
      onState: (next) => {
        if (flowRef.current !== flow) return;
        setState(next);
      },
      report: reportNonFatal,
      onPaidAfterClose: () => {
        // The check shows it (realtime / poll); nothing to do on a closed sheet.
      },
    });
    flowRef.current = flow;
    void flow.start();
    return () => {
      flowRef.current = null;
      if (!paidRef.current) void flow.closeSale().catch((e: unknown) => reportNonFatal("till.tap-close", e));
    };
  }, [venueId, paymentId, resumed]);

  const copy = resumed ? tillTapResumedCopy() : tillTapPanelCopy(state);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  useEffect(() => {
    onBusyChange(copy.busy);
    if (state.kind === "approved" && !paidRef.current) {
      paidRef.current = true;
      onPaid();
    }
  }, [copy.busy, state.kind, onBusyChange, onPaid]);

  const scanInstead = async (): Promise<void> => {
    const flow = flowRef.current;
    flowRef.current = null;
    try {
      if (flow !== null) await flow.closeSale();
      else await cancelTillCardPayment({ venueId, paymentId });
    } catch (e) {
      reportNonFatal("till.tap-scan-instead", e);
    }
    onScanInstead();
  };

  const cancelResumed = async (): Promise<void> => {
    if (cancelBusy) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelTillCardPayment({ venueId, paymentId });
      onScanInstead();
    } catch (e) {
      setCancelError(tillErrorCopy(e instanceof TillError ? e.code : "till_failed"));
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <View style={styles.box} testID="till-tap-panel">
      <Text style={styles.big}>{formatCurrency(chargedMinor, currency, true)}</Text>
      {copy.busy ? <Spinner size={36} /> : null}
      <Text style={styles.title} accessibilityLiveRegion="polite" testID="till-tap-state">{copy.title}</Text>
      {copy.danger !== null ? <Banner tone="danger" title={copy.danger} /> : null}
      {cancelError !== null ? <Banner tone="danger" title={cancelError} /> : null}
      <View style={styles.actions}>
        {resumed ? (
          <Button label={TILL_COPY.cancelPayment} variant="secondary" size="md" fullWidth loading={cancelBusy} onPress={() => void cancelResumed()} testID="till-tap-cancel-resumed" />
        ) : null}
        {copy.canTryAnother ? (
          <Button label={TILL_COPY.tryAnotherCard} variant="primary" size="lg" fullWidth onPress={() => void flowRef.current?.tryAnotherCard()} testID="till-tap-again" />
        ) : null}
        {copy.canSaveAgain ? (
          <Button label={TILL_COPY.retry} variant="primary" size="lg" fullWidth onPress={() => void flowRef.current?.retrySave()} testID="till-tap-save-again" />
        ) : null}
        {copy.canScanInstead ? (
          <Button label={TILL_COPY.scanInstead} variant="secondary" size="md" fullWidth onPress={() => void scanInstead()} testID="till-tap-scan-instead" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", gap: space[3], paddingVertical: space[4] },
  big: { ...type.h1, color: color.text1 },
  title: { ...type.h2, color: color.text1, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: space[2] },
});
