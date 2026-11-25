/**
 * #4490 P3-2 — the door step for a group (`ci-balance`): "9 of 14 in", what
 * they still owe, and the way to settle it before anyone goes in.
 *
 * With money still owed: **Take ₦X** (cash, transfer, card at the venue or
 * other; people with money rights only), or **Pay on their phone** (the
 * guest's own pay link as a QR, any door staff), or Check in anyway (the
 * venue's call; the balance stays owed). With nothing owed: pick how many go
 * in now and check them in. Open booking shows the whole booking.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import { useBalancePayLink, useBookingMoneyAction } from "../../../../hooks/useVenueBooking";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import type { CheckInPass, OfflineMethod } from "../../../../types/venueOffers";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { MoneyField } from "../../../ui/MoneyField";
import { NumberStepper } from "../../../ui/NumberStepper";
import { Segmented } from "../../../ui/Pill";
import { OFFLINE_METHODS } from "../bookings/bookingModel";
import { money, offerErrorCopy } from "../offers/offersModel";
import { VenuePayQr } from "./VenuePayQr";
import { toVenuePayUrl } from "./venuePayLink";
import { shortBookingReference } from "../../../../utils/venueBookingReference";
export { needsGroupStep, passIdFromCode } from "./venueCheckInResult";

export interface VenueGroupCheckInProps {
  pass: CheckInPass;
  brandId: string | null;
  venueId: string | null;
  currency: string | null;
  canManageMoney: boolean;
  admitting: boolean;
  onAdmit: (count: number) => void;
  onOpenBooking: (groupId: string) => void;
  onClose: () => void;
  onToast: (text: string) => void;
  /** Re-read the door list (after the guest pays on their phone). */
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function VenueGroupCheckIn({
  pass,
  brandId,
  venueId,
  currency,
  canManageMoney,
  admitting,
  onAdmit,
  onOpenBooking,
  onClose,
  onToast,
  onRefresh,
  refreshing = false,
}: VenueGroupCheckInProps): React.ReactElement {
  const cur = pass.currencyCode ?? currency;
  const balance = Math.max(0, pass.balanceDueMinor ?? 0);
  const remaining = Math.max(0, pass.admits - pass.admittedCount);
  const [count, setCount] = useState(remaining);
  const [taking, setTaking] = useState(false);
  const [amount, setAmount] = useState<number | null>(balance);
  const [method, setMethod] = useState<OfflineMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const take = useBookingMoneyAction(brandId, venueId, pass.groupId);
  const link = useBalancePayLink(venueId);
  useEffect(() => {
    setCount(remaining);
  }, [remaining]);
  useEffect(() => {
    setAmount(balance);
  }, [balance]);

  const payUrl = link.data !== undefined ? toVenuePayUrl(link.data.payUrl) : null;
  const amountIssue =
    amount === null || amount <= 0 ? "Enter the amount" : amount > balance ? `They owe ${money(balance, cur)}` : null;

  return (
    <View style={styles.host} testID="venue-checkin-group">
      <Text style={styles.title} accessibilityRole="header">{pass.holderName}</Text>
      <Text style={styles.meta}>
        {pass.offerName} · {pass.admittedCount} of {pass.admits} in{pass.reference !== null ? ` · ${shortBookingReference(pass.reference)}` : ""}
      </Text>

      {balance > 0 ? (
        <Banner
          tone="warning"
          title={`Balance due ${money(balance, cur)}`}
          body="Take it before they go in, or let them pay on their phone."
          testID="venue-checkin-balance"
        />
      ) : (
        <Text style={styles.paid}>Paid in full</Text>
      )}

      {balance > 0 && taking ? (
        <View style={styles.block} testID="venue-checkin-take-form">
          <MoneyField label="Amount" valueMinor={amount} onChangeMinor={setAmount} currency={cur} error={amount !== null ? amountIssue : null} testID="venue-checkin-take-amount" />
          <Text style={styles.label}>How they paid</Text>
          <Segmented options={OFFLINE_METHODS} value={method} onChange={setMethod} accessibilityLabel="How they paid" testID="venue-checkin-take-method" />
          <View style={styles.row}>
            <Button label="Back" variant="ghost" size="md" onPress={() => setTaking(false)} disabled={take.isPending} />
            <Button
              label={amount !== null && amount > 0 ? `Take ${money(amount, cur)}` : "Take payment"}
              variant="primary"
              size="md"
              loading={take.isPending}
              disabled={amountIssue !== null}
              testID="venue-checkin-take-confirm"
              onPress={() => {
                if (amount === null || amountIssue !== null) return;
                setError(null);
                take.mutate(
                  { kind: "take_at_door", amountMinor: amount, method },
                  {
                    onSuccess: (r) => {
                      setTaking(false);
                      onToast(r.balanceMinor > 0 ? `Taken. ${money(r.balanceMinor, cur)} still to pay` : `Paid in full. ${pass.holderName} can go in`);
                    },
                    onError: (e) => {
                      const err = toVenueOfferError(e);
                      setError(err.code === "not_authorized" ? "Only people who handle money can take payments. Show the pay code instead." : offerErrorCopy(err.code, err.detail));
                    },
                  },
                );
              }}
            />
          </View>
        </View>
      ) : null}

      {balance > 0 && payUrl !== null ? (
        <View style={styles.block} testID="venue-checkin-paylink">
          <VenuePayQr url={payUrl} size={200} testID="venue-checkin-paylink-qr" />
          <Text style={styles.meta}>They scan this with their phone camera and pay the {money(balance, cur)} there. Then check again.</Text>
          {onRefresh !== undefined ? (
            <Button label="Check again" variant="secondary" size="md" loading={refreshing} onPress={onRefresh} testID="venue-checkin-paylink-refresh" />
          ) : null}
        </View>
      ) : null}

      {balance > 0 && !taking ? (
        <View style={styles.row}>
          {canManageMoney ? (
            <Button label={`Take ${money(balance, cur)}`} variant="primary" size="md" leadingIcon="cash" onPress={() => setTaking(true)} testID="venue-checkin-take" />
          ) : null}
          <Button
            label={payUrl !== null ? "Show code again" : "Pay on their phone"}
            variant="secondary"
            size="md"
            leadingIcon="qr"
            loading={link.isPending}
            onPress={() => {
              setError(null);
              if (pass.groupId === null) return;
              link.mutate(
                { groupId: pass.groupId },
                {
                  onError: (e) => {
                    const err = toVenueOfferError(e);
                    setError(offerErrorCopy(err.code, err.detail));
                  },
                },
              );
            }}
            testID="venue-checkin-paylink-open"
          />
        </View>
      ) : null}
      {!canManageMoney && balance > 0 ? <Text style={styles.hint}>Only people who handle money can take it here. The pay code works for anyone.</Text> : null}

      {remaining > 0 ? (
        <View style={styles.block}>
          {remaining > 1 ? (
            <NumberStepper label="Going in now" value={count} min={1} max={remaining} onChange={setCount} testID="venue-checkin-group-count" />
          ) : null}
          <Button
            label={balance > 0 ? `Check in ${count} without paying` : `Check in ${count}`}
            variant={balance > 0 ? "ghost" : "primary"}
            size="md"
            loading={admitting}
            onPress={() => onAdmit(count)}
            testID="venue-checkin-group-admit"
          />
        </View>
      ) : (
        <Text style={styles.paid}>Everyone on this booking is in.</Text>
      )}

      {error !== null ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <View style={styles.row}>
        {pass.groupId !== null ? (
          <Button label="Open booking" variant="ghost" size="sm" onPress={() => onOpenBooking(pass.groupId as string)} testID="venue-checkin-open-booking" />
        ) : null}
        <Button label="Close" variant="ghost" size="sm" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: space[3] },
  title: { ...type.h1, color: color.text1 },
  meta: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  label: { ...type.small, color: color.text2 },
  paid: { ...type.small, color: color.success },
  error: { ...type.caption, color: color.errorText },
  block: { gap: space[2] },
  row: { flexDirection: "row", gap: space[2], flexWrap: "wrap", alignItems: "center" },
});
