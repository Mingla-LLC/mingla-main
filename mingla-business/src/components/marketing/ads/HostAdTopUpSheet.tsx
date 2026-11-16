/**
 * #4238 W6a — "Top up Ads credit" from the builder's Review step (design v9).
 * Every amount is what the Host pays; the 15% Mingla fee is said once, under
 * it. The way to pay is described by currency, never by a provider's name.
 * Pay: quote → start → the secure payment window → apply. On web the window
 * is a redirect that returns to this draft's Review step, where the builder
 * applies the payment (useHostAdTopUpReturn).
 */
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { color, edge, radius, space, type } from "../../../constants/designSystem";
import { useAdCreditTopUpPay } from "../../../payments/useAdCreditTopUpPay";
import { mapAdCreditQuoteError } from "../../../services/adCreditQuoteErrors";
import {
  applyAdCreditTopUp,
  quoteAdCreditTopUp,
  startAdCreditTopUp,
} from "../../../services/adCreditService";
import { minorFromMajor } from "../../../utils/currency";
import { randomId } from "../../../utils/randomId";
import { hb } from "./hostAdBuilderCopy";
import { builderStyles as bs, Note } from "./HostAdBuilderBits";
import { hostAdCeilMajor, hostAdCreditFromPay, hostAdFeeOfPay } from "./hostAdBuilderModel";

export function HostAdTopUpSheet(props: {
  visible: boolean;
  brandId: string;
  currency: string;
  /** The plain difference the launch needs, in pay terms. */
  neededCents: number;
  /** Where the secure payment window returns on web (this draft's Review). */
  returnPath: string;
  money: (cents: number) => string;
  onClose: () => void;
  onApplied: () => void;
  /**
   * #4238 W6b: false where no amount is "needed" (Promote home, a paused
   * ad): the first tile is a suggestion, not labelled "What you need".
   */
  showNeed?: boolean;
  /** #4238 W6b: the amount tiles on Promote home (pay terms). */
  options?: readonly number[];
}): React.ReactElement {
  const presentPay = useAdCreditTopUpPay();
  const larger = hostAdCeilMajor(Math.max(props.neededCents * 2, props.neededCents + 100_00));
  const options = props.options && props.options.length > 0 ? [...props.options] : [props.neededCents, larger];
  const showNeed = props.showNeed !== false && !props.options;
  const [picked, setPicked] = useState<number | "other">(props.neededCents);
  const [otherText, setOtherText] = useState("");
  const [phase, setPhase] = useState<"pick" | "paying">("pick");
  const [error, setError] = useState<string | null>(null);
  // #4238 rework 1 (tester P2-3): one payment attempt key per amount. A
  // cancel, a failed payment or a new amount starts a NEW attempt (a new
  // payment reference), so a cancelled Naira payment never blocks the next
  // one; a transport retry of the same amount keeps the same key.
  const idemRef = useRef<{ amount: number; key: string } | null>(null);
  useEffect(() => {
    if (!props.visible) return;
    setPicked(props.neededCents);
    setOtherText("");
    setPhase("pick");
    setError(null);
    idemRef.current = null;
  }, [props.visible, props.neededCents]);
  const amount =
    picked === "other"
      ? (() => {
          const major = Number(otherText.replace(/,/g, ""));
          return Number.isFinite(major) && major > 0 ? minorFromMajor(major, props.currency) : 0;
        })()
      : picked;
  const pay = async (): Promise<void> => {
    if (amount <= 0) return;
    setError(null);
    setPhase("paying");
    try {
      if (idemRef.current === null || idemRef.current.amount !== amount) {
        idemRef.current = { amount, key: randomId() };
      }
      const attemptKey = idemRef.current.key;
      await quoteAdCreditTopUp(props.brandId, amount);
      const returnUrl =
        Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin
          ? `${window.location.origin}${props.returnPath}`
          : `mingla-business:/${props.returnPath}`;
      const started = await startAdCreditTopUp({
        brandId: props.brandId,
        payCents: amount,
        returnUrl,
        idempotencyKey: attemptKey,
      });
      const outcome = await presentPay(started);
      if (outcome.outcome === "redirected") return;
      if (outcome.outcome === "canceled") {
        idemRef.current = null;
        setPhase("pick");
        setError(hb("topUp.cancelled"));
        return;
      }
      if (outcome.outcome === "failed") {
        idemRef.current = null;
        setPhase("pick");
        setError(hb("topUp.failed"));
        return;
      }
      await applyAdCreditTopUp({
        brandId: props.brandId,
        paymentRef: outcome.paymentIntentId,
        idempotencyKey: `top_up:${outcome.paymentIntentId}`,
      });
      idemRef.current = null;
      props.onApplied();
    } catch (cause) {
      setPhase("pick");
      setError(mapAdCreditQuoteError(cause));
    }
  };
  return (
    <Sheet visible={props.visible} onClose={props.onClose} snapPoint="full" testID="host-ad-topup-sheet">
      <View style={s.wrap}>
        <Text style={s.title} accessibilityRole="header">
          {phase === "paying" ? hb("topUp.finishing") : hb("topUp.title")}
        </Text>
        {phase === "paying" ? (
          <View style={bs.stackLg} accessibilityLiveRegion="polite" aria-busy>
            <Text style={bs.body}>{hb("topUp.finishingBody")}</Text>
            <Text style={bs.small}>{hb("topUp.stuck")}</Text>
          </View>
        ) : (
          <View style={bs.stackLg}>
            <View style={s.amts} accessibilityRole="radiogroup" accessibilityLabel={hb("topUp.youPay")}>
              {options.map((value, index) => {
                const on = picked === value;
                return (
                  <Pressable
                    key={value}
                    style={[s.amt, on && s.amtOn]}
                    onPress={() => setPicked(value)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={props.money(value)}
                    testID={`host-ad-topup-amount-${index}`}
                  >
                    <Text style={s.amtText}>{props.money(value)}</Text>
                    {index === 0 && showNeed ? <Text style={bs.caption}>{hb("topUp.need")}</Text> : null}
                  </Pressable>
                );
              })}
              <Pressable
                style={[s.amt, picked === "other" && s.amtOn]}
                onPress={() => setPicked("other")}
                accessibilityRole="radio"
                accessibilityState={{ selected: picked === "other" }}
                accessibilityLabel={hb("topUp.other")}
                testID="host-ad-topup-other"
              >
                <Text style={s.amtText}>{hb("topUp.other")}</Text>
              </Pressable>
            </View>
            {picked === "other" ? (
              <Input
                value={otherText}
                onChangeText={setOtherText}
                variant="number"
                accessibilityLabel={hb("topUp.otherLabel", { currency: props.currency })}
                placeholder={hb("topUp.otherLabel", { currency: props.currency })}
                testID="host-ad-topup-other-input"
              />
            ) : null}
            <View style={s.method}>
              <Text style={bs.small}>{hb("topUp.method", { currency: props.currency })}</Text>
            </View>
            <View style={bs.kv}>
              <View style={bs.kvRow}>
                <Text style={bs.kvKey}>{hb("topUp.youPay")}</Text>
                <Text style={bs.kvVal} testID="host-ad-topup-pay">{props.money(amount)}</Text>
              </View>
              <View style={[bs.kvRow, bs.kvTotal]}>
                <Text style={bs.kvKey}>{hb("topUp.added")}</Text>
                <Text style={bs.kvVal}>{props.money(amount)}</Text>
              </View>
            </View>
            <Text style={bs.caption} testID="host-ad-topup-split">
              {hb("topUp.split", {
                ads: props.money(hostAdCreditFromPay(amount)),
                fee: props.money(hostAdFeeOfPay(amount)),
              })}
            </Text>
            {error ? <Note tone="error" text={error} /> : null}
          </View>
        )}
        <View style={s.foot}>
          <Button
            label={phase === "paying" ? hb("creative.cancel") : hb("topUp.pay", { amount: props.money(amount) })}
            variant={phase === "paying" ? "secondary" : "primary"}
            fullWidth
            disabled={phase === "pick" && amount <= 0}
            onPress={() => {
              if (phase === "paying") {
                setPhase("pick");
                return;
              }
              void pay();
            }}
            testID="host-ad-topup-pay-button"
          />
        </View>
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space[6], paddingTop: space[2] },
  title: { ...type.h1, color: color.text1, marginBottom: space[6] },
  amts: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  amt: {
    flexBasis: "46%",
    flexGrow: 1,
    minHeight: 64,
    borderRadius: radius.lg,
    paddingVertical: space[3],
    paddingHorizontal: space[5],
    backgroundColor: color.fill.tile,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    ...edge.seg,
  },
  amtOn: { backgroundColor: color.card3, borderColor: color.textOnPhoto2, ...edge.rimSelected },
  amtText: { ...type.h2, color: color.text1 },
  method: {
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.fill.input,
    ...edge.seg,
  },
  foot: { paddingTop: space[8], paddingBottom: space[8] },
});
