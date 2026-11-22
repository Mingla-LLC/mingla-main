/**
 * #4490 P2-5 — Sell at the gate (`ci-sell`, `ph-sell`). A Modal on wide web, a
 * Sheet on phones. Pick counts per price (only prices on sale right now), see
 * the total with VAT, take Cash, Transfer or Pay by code. Cash and transfer
 * confirm and check the guests in at once from the places kept for walk-ins;
 * Pay by code shows a QR the guest scans and pays on their own phone.
 *
 * The server prices the sale (`venue-check-in` sell); the total shown here uses
 * the same rules (busy-time prices, the venue's VAT mode) and the result shows
 * what was actually taken. *
 * [TRANSITIONAL] #4490 spec 08 §13: door sales while the Till is off for the
 * venue (the one switch, venueOrderEntry = "pad"); exits when every venue is on
 * the Till, then this sheet, its hooks and its service calls are deleted.
 */
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { color, space, type } from "../../../../constants/designSystem";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { useSellAtGate, useSellGuestListAtGate } from "../../../../hooks/useVenueCheckIns";
import { toVenueOfferError } from "../../../../services/venueOffersService";
import { copyPublicUrl } from "../../../../utils/sharePublicUrl";
import type { GateMethod, GateSaleResult, VenueBookingSettings, VenueOffer } from "../../../../types/venueOffers";
import { randomId } from "../../../../utils/randomId";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Banner } from "../../../ui/Banner";
import { Button } from "../../../ui/Button";
import { IconChrome } from "../../../ui/IconChrome";
import { Input } from "../../../ui/Input";
import { KeyValue } from "../../../ui/KeyValue";
import { Modal } from "../../../ui/Modal";
import { NumberStepper } from "../../../ui/NumberStepper";
import { OptionCard } from "../../../ui/OptionCard";
import { Segmented } from "../../../ui/Pill";
import { Sheet } from "../../../ui/Sheet";
import { SheetScrollLayout } from "../../../ui/SheetScrollLayout";
import { gateEstimate, money, optionSellableNow, priceNow, venueClock } from "../offers/offersModel";
import { doorErrorCopy } from "./venueCheckInResult";
import { toVenuePayUrl } from "./venuePayLink";
import { VenuePayQr } from "./VenuePayQr";

const METHODS: ReadonlyArray<{ key: GateMethod; label: string; helper: string; icon: "cash" | "bank" | "qr" }> = [
  { key: "cash", label: "Cash", helper: "Take the cash now. They're checked in at once.", icon: "cash" },
  { key: "transfer", label: "Transfer", helper: "Check the transfer has arrived before you confirm.", icon: "bank" },
  { key: "pay_link", label: "Pay by code", helper: "They scan a code and pay on their phone.", icon: "qr" },
];

// OptionCard is row-only (flexBasis 0); stacked in a column it must size to its content.
const COLUMN_OPTION_CARD = { flexBasis: "auto" as const, flexGrow: 0 };

export interface VenueGateSaleProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  venueId: string | null;
  /** Live offers that can be sold at the gate. */
  offers: readonly VenueOffer[];
  settings: VenueBookingSettings | null;
  currency: string | null;
  /** "41 of the 60 kept for walk-ins are left today" when known. */
  walkInLine: string | null;
  /** Start with this offer selected (e.g. "Sell walk-in entry" after a wrong-day scan). */
  initialOfferId?: string | null;
  onSold: (result: GateSaleResult, summary: string) => void;
  /** 07-I: use the same gate-sale flow, fixed to the configured reduced Entry price. */
  guestListSale?: { entryId: string; count: number; priceOptionId: string; guestName: string } | null;
}

export function VenueGateSale({
  visible,
  onClose,
  brandId,
  venueId,
  offers,
  settings,
  currency,
  walkInLine,
  initialOfferId = null,
  onSold,
  guestListSale = null,
}: VenueGateSaleProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const { height } = useWindowDimensions();
  const sell = useSellAtGate(brandId, venueId);
  const sellGuestList = useSellGuestListAtGate(brandId, venueId);
  const [offerId, setOfferId] = useState<string | null>(initialOfferId ?? offers[0]?.id ?? null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<GateMethod>("cash");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [payTotal, setPayTotal] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // One key per attempt: a double tap replays, a new sale gets a new key.
  const [attemptKey, setAttemptKey] = useState(() => `gate-${randomId()}`);

  useEffect(() => {
    if (!visible) return;
    const guestOffer = guestListSale === null
      ? null
      : offers.find((candidate) => candidate.options.some((option) => option.id === guestListSale.priceOptionId)) ?? null;
    setOfferId(guestOffer?.id ?? initialOfferId ?? offers[0]?.id ?? null);
    setCounts(guestListSale === null ? {} : { [guestListSale.priceOptionId]: guestListSale.count });
    setMethod("cash");
    setName(guestListSale?.guestName ?? "");
    setEmail("");
    setError(null);
    setPayUrl(null);
    setPayTotal(null);
    setCopyState("idle");
    setAttemptKey(`gate-${randomId()}`);
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const offer = offers.find((o) => o.id === offerId) ?? offers[0] ?? null;
  const clock = venueClock(settings?.timezone ?? "Africa/Lagos");
  const sellable = useMemo(
    () => (offer === null
      ? []
      : guestListSale === null
        ? offer.options.filter((o) => optionSellableNow(o, clock))
        : offer.options.filter((o) => o.id === guestListSale.priceOptionId)),
    // clock is read once per render; options change only with the offer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guestListSale, offer],
  );
  const notNow = offer === null || guestListSale !== null ? [] : offer.options.filter((o) => !sellable.includes(o));
  const estimate = gateEstimate({
    options: sellable,
    counts,
    vatMode: settings?.vatMode ?? "added",
    vatRateBps: settings?.vatRateBps ?? null,
    clock,
  });
  const vatPct = settings?.vatRateBps != null ? `${settings.vatRateBps / 100}%` : "";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const selling = guestListSale === null ? sell.isPending : sellGuestList.isPending;
  const canTake = offer !== null && estimate.guests > 0 && !selling && (method !== "pay_link" || emailOk);
  const takeLabel =
    method === "pay_link"
      ? `Show pay code · ${money(estimate.totalMinor, currency)}`
      : `Take ${money(estimate.totalMinor, currency)}`;

  const take = (): void => {
    if (offer === null || !canTake) return;
    setError(null);
    const buyer = {
      ...(name.trim().length > 0 ? { name: name.trim() } : {}),
      ...(email.trim().length > 0 ? { email: email.trim() } : {}),
    };
    const input = guestListSale === null
      ? {
          offeringId: offer.id,
          lines: estimate.lines.length === 0 ? [] : sellable.filter((o) => (counts[o.id] ?? 0) > 0).map((o) => ({ priceOptionId: o.id, guests: counts[o.id] ?? 0 })),
          method,
          buyer,
          idempotencyKey: attemptKey,
        }
      : {
          entryId: guestListSale.entryId,
          count: guestListSale.count,
          method,
          buyer,
          idempotencyKey: attemptKey,
        };
    const mutation = guestListSale === null ? sell : sellGuestList;
    mutation.mutate(
      input as never,
      {
        onSuccess: (result) => {
          const summary = estimate.lines.map((l) => `${l.name} × ${l.guests}`).join(", ");
          const total = money(result.totalMinor > 0 ? result.totalMinor : estimate.totalMinor, result.currencyCode ?? currency);
          if (method === "pay_link") {
            const url = toVenuePayUrl(result.payUrl);
            if (url === null) {
              setError("The pay code couldn't be made. Take cash or a transfer instead.");
              return;
            }
            setPayUrl(url);
            setPayTotal(total);
            onSold(result, `${summary} · waiting for ${total} by pay code`);
            return;
          }
          onSold(result, `${summary} · ${total} ${method === "cash" ? "cash" : "by transfer"} · checked in`);
        },
        onError: (e) => {
          const err = toVenueOfferError(e);
          setError(doorErrorCopy(err.code, err.detail));
          setAttemptKey(`gate-${randomId()}`);
        },
      },
    );
  };

  const payUrlProof = payUrl === null ? null : toVenuePayUrl(payUrl);
  const body = payUrlProof !== null ? (
    <View style={styles.payBody} testID="gate-sale-pay-code">
      <Text style={styles.title}>Ask them to scan this</Text>
      <Text style={styles.meta}>{guestListSale === null ? `They pay ${payTotal} on their phone. Their pass appears once it's paid; scan it to check them in.` : `They pay ${payTotal} on their phone. Their guest-list arrival is checked in when payment completes.`}</Text>
      <VenuePayQr url={payUrlProof} size={Math.min(240, Math.round(height * 0.3))} testID="gate-sale-qr" />
      <Button
        label={copyState === "copied" ? "Link copied" : "Copy link"}
        variant="secondary"
        size="md"
        leadingIcon={copyState === "copied" ? "check" : "copy"}
        onPress={() => {
          copyPublicUrl(payUrlProof).then(
            () => setCopyState("copied"),
            () => setCopyState("failed"),
          );
        }}
        testID="gate-sale-copy-link"
      />
      {copyState === "failed" ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">Couldn&apos;t copy the link. Let them scan the code instead.</Text>
      ) : (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {copyState === "copied" ? "Send it by message. It opens their pass and payment." : "Or send the link by message."}
        </Text>
      )}
      <Text style={styles.linkText} selectable numberOfLines={1}>{payUrlProof.split("#")[0]}</Text>
    </View>
  ) : (
    <View style={styles.body}>
      {offers.length === 0 ? (
        <Banner tone="info" title="Nothing to sell at the gate" body="Publish an Entry offer first. Live Entry can be sold here from the places kept for walk-ins." />
      ) : (
        <>
          {offers.length > 1 && guestListSale === null ? (
            <Segmented
              options={offers.map((o) => ({ key: o.id, label: o.name }))}
              value={offer?.id ?? offers[0].id}
              onChange={(id) => {
                setOfferId(id);
                setCounts({});
              }}
              accessibilityLabel="Offer"
              testID="gate-sale-offer"
            />
          ) : null}
          {sellable.length === 0 ? (
            <Banner tone="warning" title="Not on sale right now" body="None of this offer's prices can be sold at this time of day." />
          ) : null}
          {sellable.map((o) => (
            <View key={o.id} style={styles.line}>
              {guestListSale === null ? (
                <NumberStepper
                  label={o.name}
                  value={counts[o.id] ?? 0}
                  min={0}
                  max={Math.min(o.guestMax, 50)}
                  onChange={(n) => setCounts((c) => ({ ...c, [o.id]: n }))}
                  testID={`gate-sale-count-${o.id}`}
                />
              ) : (
                <Text style={styles.label}>{o.name} × {guestListSale.count}</Text>
              )}
              <Text style={styles.hint}>
                {money(priceNow(o, clock), currency)} each{o.eligibility !== null ? ` · check ${o.eligibility.label}` : ""}
              </Text>
            </View>
          ))}
          {notNow.length > 0 ? (
            <Text style={styles.hint}>Not sold right now: {notNow.map((o) => o.name).join(", ")}.</Text>
          ) : null}
          {estimate.guests > 0 ? (
            <KeyValue
              items={[
                ...estimate.lines.map((l) => ({ key: l.name, label: `${l.guests} × ${l.name}`, value: money(l.amountMinor, currency) })),
                ...(settings?.vatMode === "added" && estimate.vatMinor > 0
                  ? [{ key: "vat", label: `VAT ${vatPct}`, value: money(estimate.vatMinor, currency) }]
                  : []),
                { key: "total", label: "To pay", value: money(estimate.totalMinor, currency), separator: true, total: true },
                ...(settings?.vatMode === "included" && estimate.vatMinor > 0
                  ? [{ key: "vatin", label: `Includes VAT ${vatPct}`, value: money(estimate.vatMinor, currency), muted: true }]
                  : []),
              ]}
              testID="gate-sale-total"
            />
          ) : null}
          <Text style={styles.label}>How they pay</Text>
          <View style={styles.methods}>
            {METHODS.map((m) => (
              <OptionCard
                key={m.key}
                label={m.label}
                helper={m.helper}
                icon={m.icon}
                selected={method === m.key}
                onPress={() => setMethod(m.key)}
                testID={`gate-sale-method-${m.key}`}
                style={COLUMN_OPTION_CARD}
              />
            ))}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Guest name (optional)</Text>
            <Input value={name} onChangeText={(v) => setName(v.slice(0, 80))} placeholder="Walk-in" accessibilityLabel="Guest name" testID="gate-sale-name" />
          </View>
          {method === "pay_link" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Guest email</Text>
              <Input
                value={email}
                onChangeText={(v) => setEmail(v.slice(0, 200))}
                variant="email"
                placeholder="name@example.com"
                accessibilityLabel="Guest email"
                error={email.length > 0 && !emailOk ? "Enter an email like name@example.com" : null}
                testID="gate-sale-email"
              />
              <Text style={styles.hint}>Their receipt and pass go here.</Text>
            </View>
          ) : null}
          {walkInLine !== null ? <Text style={styles.meta}>{walkInLine}</Text> : null}
        </>
      )}
      {error !== null ? <Banner tone="danger" title="Couldn't take this sale" body={error} testID="gate-sale-error" /> : null}
    </View>
  );

  const footer =
    payUrlProof !== null ? (
      <View style={styles.footer}>
        <View style={styles.grow}>
          <Button label="Done" variant="primary" size="lg" fullWidth onPress={onClose} testID="gate-sale-done" />
        </View>
      </View>
    ) : (
      <View style={styles.footer}>
        <Button label="Cancel" variant="secondary" size="lg" onPress={onClose} disabled={selling} testID="gate-sale-cancel" />
        <View style={styles.grow}>
          <Button
            label={takeLabel}
            variant="primary"
            size="lg"
            fullWidth
            onPress={take}
            disabled={!canTake}
            loading={selling}
            testID="gate-sale-take"
          />
        </View>
      </View>
    );

  if (isWideDesktop) {
    return (
      <Modal visible={visible} onClose={onClose} maxWidth={560} dismissOnScrimTap={!sell.isPending} testID="gate-sale">
        <View style={styles.modal}>
          <View style={styles.head}>
            <Text style={styles.heading} accessibilityRole="header">Sell at the gate</Text>
            <IconChrome icon="close" size={36} accessibilityLabel="Close" onPress={onClose} disabled={sell.isPending} />
          </View>
          <ScrollView style={{ maxHeight: Math.max(300, height * 0.62) }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
          {footer}
        </View>
      </Modal>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} snapPoint={0.9} dismissDisabled={sell.isPending} testID="gate-sale">
      <View style={styles.sheetHost}>
        <Text style={[styles.heading, styles.sheetHeading]} accessibilityRole="header">Sell at the gate</Text>
        <SheetScrollLayout footer={footer} keyboardAware contentStyle={styles.scroll}>
          {body}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  modal: { padding: space[5], gap: space[3] },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  heading: { ...type.h2, color: color.text1 },
  sheetHost: { flex: 1 },
  sheetHeading: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[2] },
  scroll: { gap: space[3], paddingBottom: space[4], paddingHorizontal: space[1] },
  body: { gap: space[3] },
  payBody: { gap: space[3], alignItems: "center", paddingVertical: space[2] },
  title: { ...type.h2, color: color.text1, textAlign: "center" },
  line: { alignSelf: "stretch", gap: space[1] },
  label: { ...type.small, color: color.text2 },
  meta: { ...type.small, color: color.text2, textAlign: "left" },
  hint: { ...type.caption, color: color.text3 },
  error: { ...type.caption, color: color.errorText },
  linkText: { ...type.caption, color: color.text4, textAlign: "center" },
  field: { gap: space[1] },
  methods: { gap: space[2] },
  footer: { flexDirection: "row", gap: space[2], paddingTop: space[3], paddingHorizontal: space[1] },
  grow: { flex: 1 },
});
