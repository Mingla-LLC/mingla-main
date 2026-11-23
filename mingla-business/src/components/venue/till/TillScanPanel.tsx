/**
 * #4490 spec 08 O2 — Scan to pay inside the payment sheet: the code, the QR,
 * the server's amount, a countdown, "Text them the link" (three per code) and
 * the guest's progress. A bank transfer confirms itself: once the guest is
 * paying, staff can carry on and the check updates when the bank lands it.
 * The state is read from the server every few seconds while the panel is open
 * (bounded by the code's own life); the Till's realtime and 15 s poll carry it
 * after the sheet closes.
 */
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import {
  TillError,
  type TillPayCodeStatus,
} from "../../../services/venueTillService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { PhoneField, usePhoneEntry } from "../../ui/PhoneField";
import { Pill } from "../../ui/Pill";
import { TillPayQr } from "./TillPayQr";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import { tillSoldOutSentence } from "../stock/stockModel";
import { receiptPhoneStartCountry } from "./tillModel";
import { cardTotalDiffers, countdown, scanPanelState, spacedCode } from "./tillPayModel";

export const SCAN_POLL_MS = 3000;

export interface TillScanPanelProps {
  code: string;
  payUrl: string;
  expiresAt: string | null;
  amountMinor: number;
  tipMinor: number;
  chargedMinor: number;
  currency: string;
  fetchStatus: (code: string) => Promise<TillPayCodeStatus>;
  cancelCode: (code: string) => Promise<void>;
  textLink: (input: { code: string; phone: string; phoneCountryIso: string | null }) => Promise<{ textLinksLeft: number }>;
  onPaid: (status: TillPayCodeStatus) => void;
  onMakeNew: () => void;
  onChooseAnother: () => void;
  onBackToTill: () => void;
}

export function TillScanPanel(props: TillScanPanelProps): React.ReactElement {
  const { code, fetchStatus, onPaid } = props;
  const [status, setStatus] = useState<TillPayCodeStatus | null>(null);
  const [now, setNow] = useState(Date.now());
  const [texting, setTexting] = useState(false);
  const [textBusy, setTextBusy] = useState(false);
  const [textNote, setTextNote] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = usePhoneEntry({ startCountries: [receiptPhoneStartCountry(props.currency)] });

  const expiresAt = status?.expiresAt ?? props.expiresAt;
  const panel = scanPanelState(
    {
      status: status?.status ?? "open",
      paymentState: status?.paymentState ?? "pending",
      payStarted: status?.payStarted ?? false,
      expiresAt,
    },
    now,
  );

  const read = useCallback(async (): Promise<void> => {
    try {
      const next = await fetchStatus(code);
      setStatus(next);
      if (next.paymentState === "paid") onPaid(next);
    } catch {
      // A missed read is retried on the next tick; nothing changes on screen.
    }
  }, [code, fetchStatus, onPaid]);

  useEffect(() => {
    if (panel === "paid" || panel === "cancelled" || panel === "expired") return undefined;
    void read();
    const poll = setInterval(() => void read(), SCAN_POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [panel, read]);

  const money = (m: number): string => formatCurrency(m, props.currency, true);
  const left = countdown(expiresAt, now);

  const sendText = async (): Promise<void> => {
    if (phone.e164 === null || textBusy) return;
    setTextBusy(true);
    setError(null);
    try {
      const r = await props.textLink({ code, phone: phone.e164, phoneCountryIso: phone.countryIso });
      setTextNote(TILL_COPY.linkSent(r.textLinksLeft));
      setTexting(false);
    } catch (err) {
      setError(err instanceof TillError && err.code === "item_sold_out" ? tillSoldOutSentence("pay", err.item, null) : tillErrorCopy(err instanceof TillError ? err.code : "till_failed"));
    } finally {
      setTextBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await props.cancelCode(code);
      setAskCancel(false);
      props.onChooseAnother();
    } catch (err) {
      setAskCancel(false);
      setError(err instanceof TillError && err.code === "item_sold_out" ? tillSoldOutSentence("pay", err.item, null) : tillErrorCopy(err instanceof TillError ? err.code : "till_failed"));
      void read();
    } finally {
      setBusy(false);
    }
  };

  if (texting) {
    return (
      <View style={styles.box} testID="till-scan-text">
        <Text style={styles.muted}>{TILL_COPY.textLinkBody}</Text>
        <PhoneField entry={phone} accessibilityLabel={TILL_COPY.theirMobile} testID="till-scan-phone" />
        {error !== null ? <Banner tone="danger" title={error} /> : null}
        <Button label={TILL_COPY.sendLink} variant="primary" size="lg" fullWidth loading={textBusy} disabled={phone.e164 === null} onPress={() => void sendText()} testID="till-scan-send" />
        <Button label={TILL_COPY.noGoBack} variant="secondary" size="md" fullWidth disabled={textBusy} onPress={() => setTexting(false)} />
      </View>
    );
  }

  if (panel === "expired" || panel === "cancelled") {
    return (
      <View style={[styles.box, styles.center]} testID="till-scan-expired">
        <TillPayQr url={props.payUrl} size={180} dim />
        <Pill variant="error">{TILL_COPY.expired}</Pill>
        <Text style={styles.title}>{TILL_COPY.codeExpired}</Text>
        <Text style={styles.muted}>{TILL_COPY.expiredStillLands}</Text>
        <Button label={TILL_COPY.makeNewCode} variant="primary" size="lg" fullWidth onPress={props.onMakeNew} testID="till-scan-new" />
        <Button label={TILL_COPY.chooseAnotherWay} variant="secondary" size="md" fullWidth onPress={props.onChooseAnother} />
      </View>
    );
  }

  const paying = panel === "paying";
  return (
    <View style={[styles.box, styles.center]} testID="till-scan-panel">
      <TillPayQr url={props.payUrl} size={200} dim={paying} testID="till-scan-qr" />
      <Text style={styles.code} testID="till-scan-code">{spacedCode(code)}</Text>
      <Text style={styles.big} testID="till-scan-amount">{money(props.amountMinor + props.tipMinor)}</Text>
      {cardTotalDiffers(props.amountMinor, props.tipMinor, props.chargedMinor) ? (
        <Text style={styles.muted}>{TILL_COPY.cardIncludesFees(money(props.chargedMinor))}</Text>
      ) : null}
      <View style={styles.pills}>
        <Pill variant="info">{paying ? TILL_COPY.guestPaying : TILL_COPY.waitingToScan}</Pill>
        {!paying && left !== null ? <Pill variant="muted">{TILL_COPY.expiresIn(left)}</Pill> : null}
      </View>
      {paying ? (
        <>
          <Text style={styles.body} testID="till-scan-waiting-bank">{TILL_COPY.waitingForBank}</Text>
          <Text style={styles.muted}>{TILL_COPY.codeOpenHour}</Text>
        </>
      ) : (
        <Text style={styles.muted}>{TILL_COPY.scanAsk}</Text>
      )}
      {textNote !== null ? <Banner tone="ok" title={textNote} /> : null}
      {error !== null ? <Banner tone="danger" title={error} /> : null}
      <View style={styles.actions}>
        {!paying && (status?.textLinksLeft ?? 3) > 0 ? (
          <Button label={TILL_COPY.textTheLink} variant="secondary" size="md" fullWidth onPress={() => setTexting(true)} testID="till-scan-text-open" />
        ) : null}
        <Button label={TILL_COPY.backToTill} variant={paying ? "primary" : "secondary"} size={paying ? "lg" : "md"} fullWidth onPress={props.onBackToTill} testID="till-scan-back" />
        <Button label={TILL_COPY.cancelPayment} variant="ghost" size="md" fullWidth onPress={() => setAskCancel(true)} testID="till-scan-cancel" />
      </View>
      <ConfirmDialog
        visible={askCancel}
        title={TILL_COPY.cancelPaymentAsk}
        description={TILL_COPY.cancelScanBody}
        confirmLabel={TILL_COPY.cancelPayment}
        cancelLabel={TILL_COPY.keepWaiting}
        destructive
        confirmLoading={busy}
        onConfirm={() => void cancel()}
        onClose={() => setAskCancel(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space[3], paddingVertical: space[2] },
  center: { alignItems: "center" },
  code: { ...type.mono, color: color.text2, letterSpacing: 2 },
  big: { ...type.h1, color: color.text1 },
  title: { ...type.h2, color: color.text1, textAlign: "center" },
  body: { ...type.body, color: color.text1, textAlign: "center", maxWidth: 320 },
  muted: { ...type.small, color: color.text2, textAlign: "center", maxWidth: 320 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "center" },
  actions: { alignSelf: "stretch", gap: space[2] },
});
