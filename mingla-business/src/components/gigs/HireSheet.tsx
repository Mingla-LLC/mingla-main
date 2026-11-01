/**
 * #3872 — Hire and pay (approved P-hire). Fee breakdown, sales share, the terms
 * as checkboxes and one "Agree and pay $X" button. Also used for a counter
 * offer top-up (pay the difference) and for a host counter before hiring.
 * Provider errors become words; a payment is only "done" after confirm.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { StripeProviderWrapper } from "../../payments/StripeProviderWrapper";
import { useGigHirePay } from "../../payments/useGigHirePay";
import {
  confirmGigHire,
  startGigHire,
  startGigTopup,
  type GigHireStart,
} from "../../services/gigHireService";
import {
  bookingFeeMinor,
  minorToWholeText,
  programErrorMessage,
  programMoney,
  wholeCurrencyToMinor,
} from "../../utils/creatorProgramFormat";
import {
  Card,
  Checkbox,
  FieldError,
  Muted,
  SheetBody,
  SummaryLine,
} from "../programs/ProgramKit";
import { ProgramSheet } from "../programs/ProgramSheet";
import { spacing } from "../../constants/designSystem";
import { randomUuid } from "../../utils/randomId";
import { hireTerms } from "./hireTerms";

export { hireTerms };

export type HireSheetMode =
  | {
      kind: "hire";
      interestId: string;
      quoteMinor: number;
      allowCounter?: boolean;
    }
  | {
      kind: "topup";
      contractId: string;
      termsVersion: number;
      topupMinor: number;
    };

type Props = {
  visible: boolean;
  onClose: () => void;
  mode: HireSheetMode;
  creatorName: string;
  currency: string;
  salesShareBps?: number | null;
  usageDays?: number | null;
  /** Fires once the provider confirmed the money is held. */
  onPaid: (contractId: string) => void;
};

type Pending = { start: GigHireStart };

export function HireSheet(props: Props): React.ReactElement {
  return (
    // Closes when its screen blurs (a route change) so it never stays on top
    // of another screen.
    <ProgramSheet visible={props.visible} onClose={props.onClose} snapPoint="full">
      <StripeProviderWrapper>
        <HireSheetBody {...props} />
      </StripeProviderWrapper>
    </ProgramSheet>
  );
}

function HireSheetBody({
  visible,
  mode,
  creatorName,
  currency,
  salesShareBps,
  usageDays,
  onPaid,
}: Props): React.ReactElement {
  const pay = useGigHirePay();
  const [countering, setCountering] = useState(false);
  const [feeText, setFeeText] = useState("");
  const terms = useMemo(
    () => hireTerms(creatorName, usageDays),
    [creatorName, usageDays],
  );
  const [checked, setChecked] = useState<boolean[]>(() =>
    terms.map(() => false),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // One idempotency key per sheet opening: a retry after a failure reuses the
  // same prepared offer instead of creating a second one.
  const [attemptKey, setAttemptKey] = useState(() => randomUuid());

  useEffect(() => {
    if (!visible) return;
    setCountering(false);
    setFeeText(
      mode.kind === "hire" ? minorToWholeText(mode.quoteMinor, currency) : "",
    );
    setChecked(terms.map(() => false));
    setError(null);
    setPending(null);
    setAttemptKey(randomUuid());
  }, [visible, mode, currency, terms]);

  const feeMinor =
    mode.kind === "topup"
      ? mode.topupMinor
      : countering
        ? wholeCurrencyToMinor(feeText, currency)
        : mode.quoteMinor;
  const booking =
    mode.kind === "hire" && feeMinor ? bookingFeeMinor(feeMinor) : 0;
  const total = (feeMinor ?? 0) + booking;
  const allChecked = mode.kind === "topup" || checked.every(Boolean);

  const confirm = async (start: GigHireStart) => {
    const result = await confirmGigHire({
      contractId: start.contract_id,
      termsVersion: start.terms_version,
      rail: start.rail,
      providerRef: start.provider_ref,
    });
    if (!result.ok) {
      setError(
        programErrorMessage(
          result.error,
          "We couldn't confirm the payment yet. If you paid, wait a minute and check again.",
        ),
      );
      return;
    }
    onPaid(start.contract_id);
  };

  const run = async () => {
    if (!feeMinor) {
      setError("Enter a fee above zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const start =
        mode.kind === "topup"
          ? await startGigTopup({
              contractId: mode.contractId,
              termsVersion: mode.termsVersion,
            })
          : await startGigHire({
              interestId: mode.interestId,
              feeMinor,
              terms: {
                fee_minor: feeMinor,
                sales_share_bps: salesShareBps ?? null,
                rights_accepted: true,
              },
              idempotencyKey: `gig-${mode.interestId}-${feeMinor}-${attemptKey.slice(0, 8)}`,
            });
      if (!start.ok) {
        setError(
          programErrorMessage(
            start.error,
            "We couldn't start the payment. Try again in a few minutes.",
          ),
        );
        return;
      }
      const outcome = await pay(start);
      if (outcome.outcome === "succeeded") await confirm(start);
      else if (outcome.outcome === "redirected") setPending({ start });
      else if (outcome.outcome === "failed") setError(outcome.message);
    } catch (runError) {
      setError(
        programErrorMessage(
          runError,
          "We couldn't start the payment. Try again in a few minutes.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode.kind === "topup"
      ? `Pay the difference to ${creatorName}`
      : countering
        ? `Offer ${creatorName} a fee`
        : `Hire ${creatorName}`;
  // The error sits above the button inside one footer column, so a long
  // error wraps and pushes the button down instead of running under it.
  const footer = (
    <View style={styles.footer}>
      <FieldError message={error} />
      {pending ? (
        <>
          <Muted>
            Finish paying on the payment page, then come back and check.
          </Muted>
          <Button
            fullWidth
            label="I've paid · check payment"
            loading={busy}
            onPress={() => {
              setBusy(true);
              void confirm(pending.start).finally(() => setBusy(false));
            }}
          />
        </>
      ) : (
        <Button
          fullWidth
          label={
            feeMinor
              ? `Agree and pay ${programMoney(total, currency)}`
              : "Agree and pay"
          }
          loading={busy}
          disabled={busy || !allChecked || !feeMinor}
          onPress={() => void run()}
        />
      )}
      {mode.kind === "hire" && !allChecked ? (
        <Muted>Tick each term to continue.</Muted>
      ) : null}
    </View>
  );
  return (
    <SheetBody title={title} footer={footer}>
      {mode.kind === "hire" && mode.allowCounter && !pending ? (
        countering ? (
          <>
            <Input
              value={feeText}
              onChangeText={(value) => setFeeText(value.replace(/[^0-9]/g, ""))}
              variant="number"
              placeholder={`Your fee offer in ${currency}`}
              accessibilityLabel={`Your fee offer in ${currency}`}
            />
            <Muted>{`${creatorName} asked for ${programMoney(mode.quoteMinor, currency)}. They see your offer and have 48 hours to accept.`}</Muted>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            label="Offer a different fee"
            onPress={() => setCountering(true)}
          />
        )
      ) : null}
      <Card>
        {mode.kind === "topup" ? (
          <SummaryLine
            label="New fee difference"
            value={programMoney(feeMinor, currency)}
          />
        ) : (
          <>
            <SummaryLine
              label="Creator fee"
              value={feeMinor ? programMoney(feeMinor, currency) : "—"}
            />
            <SummaryLine
              label="Mingla booking fee (15%)"
              value={programMoney(booking, currency)}
            />
          </>
        )}
        <SummaryLine
          label="Pay now"
          value={feeMinor ? programMoney(total, currency) : "—"}
          strong
        />
        <Muted>{`Held by Mingla until the post is live. Refunded if ${creatorName} declines or misses a deadline.`}</Muted>
      </Card>
      {mode.kind === "hire" && salesShareBps ? (
        <Card>
          <SummaryLine
            label="Plus a share of sales from their link"
            value={`${Math.round(salesShareBps / 100)}%`}
          />
          <Muted>
            Paid automatically from each sale, after discounts, excluding fees
            and tax.
          </Muted>
        </Card>
      ) : null}
      {mode.kind === "hire" ? (
        <View style={styles.terms}>
          {terms.map((term, index) => (
            <Checkbox
              key={term}
              label={term}
              checked={checked[index]}
              onToggle={() =>
                setChecked((current) =>
                  current.map((value, i) => (i === index ? !value : value)),
                )
              }
            />
          ))}
          <Button
            variant="ghost"
            size="sm"
            label="Read the full Creator agreement"
            onPress={() =>
              void Linking.openURL("https://usemingla.com/creator-agreement")
            }
          />
        </View>
      ) : null}
    </SheetBody>
  );
}

const styles = StyleSheet.create({
  terms: { gap: spacing.xs },
  footer: { gap: spacing.sm, alignSelf: "stretch" },
});
