/**
 * #4490 spec 08 O1 — `pay-receipt`: after a payment, send the guest a
 * receipt by text, email or both (at most three sends per payment, counted by
 * the server). The receipt itself is the server's: the link the guest gets is
 * built when the message is sent. "No receipt" moves on.
 *
 * Print receipt arrives with the printing package (O3); "Receipt sent to …"
 * for a guest who paid on their own phone arrives with Scan to pay (O2).
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { TillError } from "../../../services/venueTillService";
import { StationError } from "../../../services/venueStationService";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { PhoneField, usePhoneEntry } from "../../ui/PhoneField";
import { TILL_COPY, tillErrorCopy } from "./tillCopy";
import { STATION_COPY, stationErrorCopy } from "../station/stationCopy";
import { receiptChannelsReady, receiptPhoneStartCountry, type ReceiptChannel } from "./tillModel";

export interface ReceiptStepProps {
  currency: string;
  /** Sends already made for this payment (the server counts them). */
  sendsUsed: number;
  onSend: (input: {
    channel: ReceiptChannel;
    phone: string | null;
    phoneCountryIso: string | null;
    email: string | null;
  }) => Promise<{ sendsLeft: number }>;
  onSkip?: () => void;
  /**
   * #4490 spec 08 O3: "Print receipt" — a server-made PDF the device prints
   * (openFloorPdf). Absent: no print button. Throws a StationError on failure.
   */
  onPrint?: () => Promise<void>;
  testID?: string;
}

export function ReceiptStep({ currency, sendsUsed, onSend, onSkip, onPrint, testID }: ReceiptStepProps): React.ReactElement {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const print = async (): Promise<void> => {
    if (onPrint === undefined || printing) return;
    setPrinting(true);
    setPrintError(null);
    try {
      await onPrint();
    } catch (err) {
      setPrintError(stationErrorCopy(err instanceof StationError ? err.code : "floor_pdf_failed"));
    } finally {
      setPrinting(false);
    }
  };
  const phone = usePhoneEntry({ startCountries: [receiptPhoneStartCountry(currency)] });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<ReceiptChannel | null>(null);
  const [sent, setSent] = useState<{ channel: ReceiptChannel; sendsLeft: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const ready = receiptChannelsReady({ phoneE164: phone.e164, phoneEmpty: phone.isEmpty, email });
  const limitReached = (sent?.sendsLeft ?? 3 - sendsUsed) <= 0;

  const send = async (channel: ReceiptChannel): Promise<void> => {
    if (busy !== null) return;
    setShowErrors(true);
    if (!ready[channel]) return;
    setBusy(channel);
    setError(null);
    try {
      const result = await onSend({
        channel,
        phone: channel === "email" ? null : phone.e164,
        phoneCountryIso: channel === "email" ? null : phone.countryIso,
        email: channel === "text" ? null : email.trim(),
      });
      setSent({ channel, sendsLeft: result.sendsLeft });
    } catch (err) {
      setError(tillErrorCopy(err instanceof TillError ? err.code : "till_failed"));
    } finally {
      setBusy(null);
    }
  };

  const emailError =
    showErrors && email.trim().length > 0 && !ready.email ? TILL_COPY.receiptEmailInvalid : null;

  return (
    <View style={styles.box} testID={testID}>
      <Text style={styles.heading} accessibilityRole="header">{TILL_COPY.receipt}</Text>
      {sent !== null ? (
        <Banner
          tone="ok"
          title={TILL_COPY.receiptSent}
          body={sent.sendsLeft > 0 ? TILL_COPY.receiptSendsLeft(sent.sendsLeft) : TILL_COPY.receiptLimit}
          testID="till-receipt-sent"
        />
      ) : null}
      {limitReached && sent === null ? <Text style={styles.muted}>{TILL_COPY.receiptLimit}</Text> : null}
      {!limitReached ? (
        <>
          <PhoneField
            entry={phone}
            accessibilityLabel={TILL_COPY.receiptPhone}
            showErrors={showErrors && !phone.isEmpty}
            placeholder={TILL_COPY.receiptPhone}
            testID="till-receipt-phone"
          />
          <Input
            variant="email"
            value={email}
            onChangeText={setEmail}
            placeholder={TILL_COPY.receiptEmail}
            accessibilityLabel={TILL_COPY.receiptEmail}
            error={emailError}
            testID="till-receipt-email"
          />
          {error !== null ? <Banner tone="danger" title={error} /> : null}
          <View style={styles.row}>
            <Button label={TILL_COPY.receiptText} variant="secondary" size="md" style={styles.grow}
              disabled={busy !== null || !ready.text} loading={busy === "text"} onPress={() => void send("text")} testID="till-receipt-text" />
            <Button label={TILL_COPY.receiptEmailButton} variant="secondary" size="md" style={styles.grow}
              disabled={busy !== null || !ready.email} loading={busy === "email"} onPress={() => void send("email")} testID="till-receipt-email-send" />
            <Button label={TILL_COPY.receiptBoth} variant="secondary" size="md" style={styles.grow}
              disabled={busy !== null || !ready.both} loading={busy === "both"} onPress={() => void send("both")} testID="till-receipt-both" />
          </View>
        </>
      ) : null}
      {onPrint !== undefined ? (
        <>
          {printError !== null ? <Banner tone="danger" title={printError} testID="till-receipt-print-error" /> : null}
          <Button label={STATION_COPY.printReceipt} variant="secondary" size="md" leadingIcon="receipt"
            loading={printing} disabled={printing} onPress={() => void print()} testID="till-receipt-print" />
        </>
      ) : null}
      {onSkip !== undefined && sent === null ? (
        <Button label={TILL_COPY.noReceipt} variant="ghost" size="md" disabled={busy !== null} onPress={onSkip} testID="till-receipt-skip" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space[3] },
  heading: { ...type.row, color: color.text1 },
  muted: { ...type.small, color: color.text2 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  grow: { flexGrow: 1 },
});
