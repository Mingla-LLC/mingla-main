/**
 * #4238 W6b — the ad detail and Promote home sheets (design v9): edit budget
 * or end date (with the learning-restart confirm), Ari's one suggestion and
 * its money confirm, withdraw, receipts and statements, compare and share.
 * Every amount is what the Host pays; the 15% Mingla fee is said once. The
 * way money moves is described by currency, never by a provider's name.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../../ui/Button";
import { DateField } from "../../ui/DateField";
import { Sheet } from "../../ui/Sheet";
import { color, edge, radius, space, type } from "../../../constants/designSystem";
import {
  type AdCreditLedgerRow,
  type AdCreditReceipt,
  type AdCreditStatement,
  applyAdCreditWithdraw,
  getAdCreditReceipt,
  getAdCreditStatement,
  quoteAdCreditWithdraw,
} from "../../../services/adCreditService";
import { mapAdCreditQuoteError } from "../../../services/adCreditQuoteErrors";
import type { HostAdSuggestion } from "../../../services/hostAdCampaignService";
import { randomId } from "../../../utils/randomId";
import { copyPublicUrl, sharePublicUrl } from "../../../utils/sharePublicUrl";
import { Toast } from "../../ui/Toast";
import { builderStyles as bs, BuilderCard, BuilderLabel, BuilderList, Note, ValueRow } from "./HostAdBuilderBits";
import { type HostAdGoal, hostAdPayFromCredit } from "./hostAdBuilderModel";
import { hostAdDayBoundaryIso, hostAdDayOf } from "./hostAdBuilderRules";
import { hm, hostAdUnit } from "./hostAdManageCopy";
import {
  type HostAdCompareRow,
  hostAdEditDailyMoney,
  hostAdEditMinDailyPay,
  hostAdDaysLeft,
  hostAdEditStep,
  hostAdShareOrCopy,
  hostAdStatementMonth,
  hostAdSuggestionMoneyRows,
  hostAdWithdrawLines,
} from "./hostAdManageModel";

type Money = (cents: number) => string;

function Kv(props: { label: string; value: string; total?: boolean; testID?: string }): React.ReactElement {
  return (
    <View style={[bs.kvRow, props.total && bs.kvTotal]}>
      <Text style={bs.kvKey}>{props.label}</Text>
      <Text style={bs.kvVal} testID={props.testID}>{props.value}</Text>
    </View>
  );
}

function SheetFrame(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  testID: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}): React.ReactElement {
  return (
    <Sheet visible={props.visible} onClose={props.onClose} snapPoint="full" testID={props.testID}>
      <View style={s.wrap}>
        <Text style={s.title} accessibilityRole="header">{props.title}</Text>
        <View style={bs.stackLg}>{props.children}</View>
        {props.foot ? <View style={s.foot}>{props.foot}</View> : null}
      </View>
    </Sheet>
  );
}

// ── How the money works ──────────────────────────────────────────────────

export function HostAdMoneyExplainer(): React.ReactElement {
  const rows: [string, string][] = [
    ["money.every", "money.everyV"],
    ["money.split", "money.splitV"],
    ["money.launch", "money.launchV"],
    ["money.runs", "money.runsV"],
    ["money.ends", "money.endsV"],
    ["money.withdraw", "money.withdrawV"],
  ];
  return (
    <BuilderCard accessibilityLabel={hm("money.label")} testID="host-ad-money-explainer">
      <BuilderLabel>{hm("money.label")}</BuilderLabel>
      <View style={bs.kv}>
        {rows.map(([k, v]) => (
          <Kv key={k} label={hm(k)} value={hm(v)} />
        ))}
      </View>
    </BuilderCard>
  );
}

// ── Edit budget or end date ──────────────────────────────────────────────

export type HostAdEditSubmit = {
  newBudgetCredit: number | null;
  newEndsAt: string | null;
  acknowledgeLearningReset: boolean;
};

export function HostAdEditBudgetSheet(props: {
  visible: boolean;
  currency: string;
  money: Money;
  capCredit: number;
  /**
   * W6c: what the apps spend a day now (credit), all apps added up, from the
   * plan (#4238 rework 1: server plan_daily_credit_cents). null = unknown:
   * the daily stepper is hidden and only the end date can change.
   */
  dailyCredit: number | null;
  /** W6c: the apps' one-ad-set daily minimum in pay terms; null = unknown. */
  minDailyPay: number | null;
  spentCredit: number | null;
  walletCredit: number | null;
  currentEndsAt: string | null;
  lastBookableAt?: string | null;
  timezone: string | null;
  nowIso: string;
  learning: boolean;
  daysLive: number | null;
  busy: boolean;
  /** The server asked for the restart confirm (host_ad_live_edit_learning_reset). */
  needsLearningConfirm: boolean;
  error: string | null;
  onTopUp: (payCents: number) => void;
  onClose: () => void;
  onSubmit: (input: HostAdEditSubmit) => void;
}): React.ReactElement {
  const dailyKnown = props.dailyCredit !== null && props.dailyCredit > 0;
  const startDaily = useMemo(
    () => (props.dailyCredit !== null && props.dailyCredit > 0 ? hostAdPayFromCredit(props.dailyCredit) : 0),
    [props.dailyCredit],
  );
  const [dailyPay, setDailyPay] = useState(startDaily);
  const startDay = hostAdDayOf(props.currentEndsAt, props.timezone);
  const [endDay, setEndDay] = useState(startDay);
  useEffect(() => {
    if (!props.visible) return;
    setDailyPay(startDaily);
    setEndDay(startDay);
  }, [props.visible, startDaily, startDay]);
  const endChanged = endDay !== "" && endDay !== startDay;
  // #4238 rework 1: the days LEFT to the (new) end date, the server's rule.
  const endIso = endChanged ? hostAdDayBoundaryIso(endDay, "end", props.timezone) : props.currentEndsAt;
  const daysLeft = hostAdDaysLeft(props.nowIso, endIso) ?? 1;
  const step = hostAdEditStep(startDaily);
  const minDaily = hostAdEditMinDailyPay({ appsMinimumDailyPay: props.minDailyPay, step });
  const m = hostAdEditDailyMoney({
    dailyPay,
    startDailyPay: startDaily,
    startDailyCredit: dailyKnown && props.dailyCredit !== null ? props.dailyCredit : undefined,
    daysLeft,
    endChanged: dailyKnown && endChanged,
    capCredit: props.capCredit,
    spentCredit: props.spentCredit,
    walletCredit: props.walletCredit,
    learning: props.learning,
    step,
  });
  // An unknown daily never sends a total built on it (only the end date moves).
  const budgetChanged = dailyKnown && m.newCredit !== Math.max(0, Math.trunc(props.capCredit));
  const changed = budgetChanged || endChanged;
  const short = m.topUpPay > 0;
  const atMinimum = dailyPay - step < minDaily;
  const warnLearning = props.learning && (m.restartsLearning || endChanged);
  const confirmMode = props.needsLearningConfirm;
  const submit = (ack: boolean): void =>
    props.onSubmit({
      newBudgetCredit: budgetChanged ? m.newCredit : null,
      newEndsAt: endChanged ? hostAdDayBoundaryIso(endDay, "end", props.timezone) : null,
      acknowledgeLearningReset: ack,
    });
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("edit.title")}
      onClose={props.onClose}
      testID="host-ad-edit-sheet"
      foot={
        <View style={bs.actions}>
          <Button
            label={props.learning ? hm("edit.keep") : hm("edit.cancel")}
            variant="secondary"
            style={s.half}
            onPress={props.onClose}
            disabled={props.busy}
            testID="host-ad-edit-cancel"
          />
          <Button
            label={confirmMode || warnLearning ? hm("edit.saveAnyway") : hm("edit.save")}
            variant="primary"
            style={s.half}
            loading={props.busy}
            disabled={!changed || short || props.busy}
            onPress={() => submit(confirmMode || warnLearning)}
            testID="host-ad-edit-save"
          />
        </View>
      }
    >
      {dailyKnown ? (
        <>
          <BuilderLabel>{hm("edit.daily")}</BuilderLabel>
          <View style={s.stepper}>
            <Pressable
              style={[s.stepBtn, atMinimum && s.stepOff]}
              disabled={atMinimum}
              onPress={() => setDailyPay((v) => Math.max(minDaily, v - step))}
              accessibilityRole="button"
              accessibilityState={{ disabled: atMinimum }}
              accessibilityLabel={hm("edit.lower", { amount: props.money(step) })}
              testID="host-ad-edit-lower"
            >
              <Text style={s.stepText}>−</Text>
            </Pressable>
            <Text
              style={[bs.statXl, s.stepValue]}
              accessibilityLiveRegion="polite"
              testID="host-ad-edit-total"
            >
              {props.money(dailyPay)}
            </Text>
            <Pressable
              style={s.stepBtn}
              onPress={() => setDailyPay((v) => v + step)}
              accessibilityRole="button"
              accessibilityLabel={hm("edit.raise", { amount: props.money(step) })}
              testID="host-ad-edit-raise"
            >
              <Text style={s.stepText}>+</Text>
            </Pressable>
          </View>
          <Text style={[bs.small, s.center]} testID="host-ad-edit-run-total">
            {hm("edit.runTotalLeft", { amount: props.money(m.runTotalPay), days: m.daysLeft })}
          </Text>
          <Text style={[bs.small, s.center]} testID="host-ad-edit-to-ads">
            {hm("edit.toAds", { amount: props.money(m.newCredit) })}
          </Text>
          {atMinimum ? (
            <Text style={[bs.caption, s.center]}>
              {hm("edit.atMinimumDaily", { amount: props.money(minDaily) })}
            </Text>
          ) : null}
        </>
      ) : (
        <Note tone="info" text={hm("edit.dailyUnknown")} testID="host-ad-edit-daily-unknown" />
      )}
      <DateField
        label={hm("edit.ends")}
        value={endDay}
        min={hostAdDayOf(props.nowIso, props.timezone)}
        max={props.lastBookableAt ? hostAdDayOf(props.lastBookableAt, props.timezone) : undefined}
        onChangeValue={setEndDay}
        accessibilityLabel={hm("edit.ends")}
        testID="host-ad-edit-end"
      />
      <Text style={bs.caption}>{hm("edit.endsHint")}</Text>
      {warnLearning || confirmMode ? (
        <Note
          tone="warn"
          text={
            confirmMode
              ? hm("edit.learningConfirm")
              : hm("edit.learningWarn", { days: props.daysLive ?? 1 })
          }
          testID="host-ad-edit-learning"
        />
      ) : null}
      <View style={bs.kv}>
        <Kv label={hm("edit.stillHeld")} value={props.money(m.stillHeldPay)} testID="host-ad-edit-held" />
        <Kv label={hm("edit.heldAfter")} value={props.money(m.heldAfterPay)} testID="host-ad-edit-held-after" />
        {m.changePay >= 0 ? (
          <Kv label={hm("edit.extra")} value={props.money(m.changePay)} total testID="host-ad-edit-extra" />
        ) : (
          <Kv label={hm("edit.comesBack")} value={props.money(-m.changePay)} total testID="host-ad-edit-back" />
        )}
        <Kv label={hm("edit.free")} value={props.money(m.freePay)} testID="host-ad-edit-free" />
      </View>
      {short ? (
        <Note
          tone="error"
          text={hm("edit.needMore", { amount: props.money(m.topUpPay) })}
          testID="host-ad-edit-short"
          actions={
            <Button
              label={hm("edit.topUp", { amount: props.money(m.topUpPay) })}
              variant="secondary"
              size="sm"
              onPress={() => props.onTopUp(m.topUpPay)}
              testID="host-ad-edit-topup"
            />
          }
        />
      ) : null}
      {props.error ? <Note tone="error" text={props.error} testID="host-ad-edit-error" /> : null}
      <Text style={bs.caption}>{hm("edit.onceADay")}</Text>
    </SheetFrame>
  );
}

// ── Ari's one suggestion ─────────────────────────────────────────────────

export function hostAdSuggestionText(
  suggestion: HostAdSuggestion,
  money: Money,
  dateText: (iso: string) => string,
): string {
  const after = suggestion.money ? money(suggestion.money.new_total_pay_cents) : "";
  switch (suggestion.kind) {
    case "raise_budget":
      return hm("ari.raise", { amount: after });
    case "lower_budget":
      return hm("ari.lower", { amount: after });
    case "extend_end":
      return hm("ari.extend", { date: suggestion.ends_at ? dateText(suggestion.ends_at) : "" });
    case "accept_last_tickets":
      return hm("ari.lastTickets");
    case "new_video":
      return hm("ari.newVideo");
    default: {
      const never: never = suggestion.kind;
      return String(never);
    }
  }
}

export function HostAdSuggestionCard(props: {
  suggestion: HostAdSuggestion;
  goal: HostAdGoal;
  money: Money;
  dateText: (iso: string) => string;
  canApply: boolean;
  blockedReason: string | null;
  onReview: () => void;
  onAddVideo: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  const sg = props.suggestion;
  const per = sg.basis.cost_per_result_cents;
  return (
    <View style={s.ari} accessibilityLabel={hm("ari.label")} testID="host-ad-ari-card">
      <View style={s.who}>
        <View style={s.whoDot} />
        <Text style={s.whoText}>{hm("ari.who")}</Text>
      </View>
      <Text style={bs.body}>{hostAdSuggestionText(sg, props.money, props.dateText)}</Text>
      {per !== null && per > 0 ? (
        <Text style={bs.small}>
          {hm("ari.basis", {
            amount: props.money(hostAdPayFromCredit(per)),
            unit: hostAdUnit(props.goal, true),
          })}
        </Text>
      ) : null}
      {props.blockedReason ? <Text style={bs.caption}>{props.blockedReason}</Text> : null}
      <View style={bs.actions}>
        {sg.kind === "new_video" ? (
          <Button label={hm("detail.addVideo")} variant="primary" size="sm" onPress={props.onAddVideo} testID="host-ad-ari-video" />
        ) : (
          <Button
            label={hm("ari.review")}
            variant="primary"
            size="sm"
            disabled={!props.canApply}
            onPress={props.onReview}
            testID="host-ad-ari-review"
          />
        )}
        <Button label={hm("ari.notNow")} variant="ghost" size="sm" onPress={props.onDismiss} testID="host-ad-ari-dismiss" />
      </View>
    </View>
  );
}

/**
 * The money confirm before Ari's change applies. Only the suggestion id is
 * sent (the caller's onApply); the amounts here are the server's own.
 */
export function HostAdSuggestionConfirmSheet(props: {
  visible: boolean;
  suggestion: HostAdSuggestion;
  money: Money;
  dateText: (iso: string) => string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onApply: () => void;
}): React.ReactElement {
  const rows = hostAdSuggestionMoneyRows(props.suggestion.money ?? null);
  const signed = (cents: number): string =>
    cents > 0 ? `+${props.money(cents)}` : cents < 0 ? `−${props.money(-cents)}` : props.money(0);
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("ari.confirmTitle")}
      onClose={props.onClose}
      testID="host-ad-ari-confirm"
      foot={
        <View style={bs.actions}>
          <Button label={hm("ari.keep")} variant="secondary" style={s.half} onPress={props.onClose} disabled={props.busy} testID="host-ad-ari-keep" />
          <Button label={hm("ari.apply")} variant="primary" style={s.half} loading={props.busy} disabled={props.busy} onPress={props.onApply} testID="host-ad-ari-apply" />
        </View>
      }
    >
      <Text style={bs.body}>{hostAdSuggestionText(props.suggestion, props.money, props.dateText)}</Text>
      {rows ? (
        <View style={bs.kv}>
          <Kv label={hm("ari.paysNow")} value={props.money(rows.nowPay)} testID="host-ad-ari-now" />
          <Kv label={hm("ari.paysAfter")} value={props.money(rows.afterPay)} testID="host-ad-ari-after" />
          <Kv label={hm("ari.change")} value={signed(rows.changePay)} total testID="host-ad-ari-change" />
        </View>
      ) : null}
      {rows && rows.direction === "raise" ? (
        <Text style={bs.caption} testID="host-ad-ari-fee">{hm("ari.feeLine", { fee: props.money(rows.feePay) })}</Text>
      ) : null}
      {rows && rows.direction === "lower" ? (
        <Text style={bs.caption} testID="host-ad-ari-back">{hm("ari.backLine", { amount: props.money(-rows.changePay) })}</Text>
      ) : null}
      {props.suggestion.ends_at ? (
        <Text style={bs.caption}>{hm("ari.endsLine", { date: props.dateText(props.suggestion.ends_at) })}</Text>
      ) : null}
      {props.error ? <Note tone="error" text={props.error} testID="host-ad-ari-error" /> : null}
    </SheetFrame>
  );
}

// ── Withdraw ─────────────────────────────────────────────────────────────

export function HostAdWithdrawSheet(props: {
  visible: boolean;
  brandId: string;
  currency: string;
  money: Money;
  walletCredit: number;
  heldPay: number;
  onClose: () => void;
  onDone: (message: string) => void;
}): React.ReactElement {
  const [quote, setQuote] = useState<ReturnType<typeof hostAdWithdrawLines>>(null);
  const [phase, setPhase] = useState<"quoting" | "ready" | "sending">("quoting");
  const [error, setError] = useState<string | null>(null);
  const idem = useRef("");
  const credit = Math.max(0, Math.trunc(props.walletCredit));
  useEffect(() => {
    if (!props.visible) return;
    setError(null);
    idem.current = "";
    if (credit <= 0) {
      setQuote(null);
      setPhase("ready");
      return;
    }
    setPhase("quoting");
    let live = true;
    quoteAdCreditWithdraw(credit)
      .then((result) => {
        if (!live) return;
        setQuote(hostAdWithdrawLines(result));
        setPhase("ready");
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(mapAdCreditQuoteError(cause));
        setPhase("ready");
      });
    return () => {
      live = false;
    };
  }, [props.visible, credit]);
  const send = async (): Promise<void> => {
    if (credit <= 0) return;
    setPhase("sending");
    setError(null);
    try {
      if (idem.current === "") idem.current = randomId();
      await applyAdCreditWithdraw({ brandId: props.brandId, creditCents: credit, idempotencyKey: idem.current });
      props.onDone(hm("withdraw.done"));
    } catch {
      setPhase("ready");
      setError(hm("withdraw.failed"));
    }
  };
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("withdraw.title")}
      onClose={props.onClose}
      testID="host-ad-withdraw-sheet"
      foot={
        <View style={bs.actions}>
          <Button label={hm("withdraw.keep")} variant="secondary" style={s.half} onPress={props.onClose} disabled={phase === "sending"} testID="host-ad-withdraw-keep" />
          <Button
            label={quote ? hm("withdraw.go", { amount: props.money(quote.backPay) }) : hm("credit.withdraw")}
            variant="primary"
            style={s.half}
            loading={phase === "sending"}
            disabled={quote === null || phase !== "ready" || credit <= 0}
            onPress={() => void send()}
            testID="host-ad-withdraw-go"
          />
        </View>
      }
    >
      {credit <= 0 ? (
        <Note tone="info" text={hm("withdraw.nothing")} testID="host-ad-withdraw-nothing" />
      ) : phase === "quoting" ? (
        <Text style={bs.small} accessibilityLiveRegion="polite">{hm("withdraw.checking")}</Text>
      ) : quote ? (
        <>
          <View style={bs.kv}>
            <Kv label={hm("withdraw.held")} value={props.money(props.heldPay)} />
            <Kv label={hm("withdraw.back")} value={props.money(quote.backPay)} total testID="host-ad-withdraw-back" />
          </View>
          <Text style={bs.small} testID="host-ad-withdraw-fee">
            {hm("withdraw.feeBack", { fee: props.money(quote.feeBack), currency: props.currency })}
          </Text>
        </>
      ) : null}
      {error ? <Note tone="error" text={error} testID="host-ad-withdraw-error" /> : null}
    </SheetFrame>
  );
}

// ── Receipts and statements ──────────────────────────────────────────────

function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function HostAdReceiptsSheet(props: {
  visible: boolean;
  brandId: string;
  money: Money;
  history: readonly AdCreditLedgerRow[];
  nowIso: string;
  onClose: () => void;
}): React.ReactElement {
  const [receipt, setReceipt] = useState<AdCreditReceipt | null>(null);
  const [statement, setStatement] = useState<AdCreditStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = props.history.filter((row) => row.entry_kind === "top_up" || row.entry_kind === "withdraw");
  const month = hostAdStatementMonth(props.nowIso);
  useEffect(() => {
    if (!props.visible) {
      setReceipt(null);
      setStatement(null);
      setError(null);
    }
  }, [props.visible]);
  const open = async (load: () => Promise<void>): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await load();
    } catch {
      setError(hm("receipts.error"));
    } finally {
      setLoading(false);
    }
  };
  const showing = receipt !== null || statement !== null;
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("receipts.title")}
      onClose={props.onClose}
      testID="host-ad-receipts-sheet"
      foot={
        <Button
          label={showing ? hm("receipts.back") : hm("receipts.done")}
          variant={showing ? "secondary" : "primary"}
          fullWidth
          onPress={() => {
            if (showing) {
              setReceipt(null);
              setStatement(null);
              return;
            }
            props.onClose();
          }}
          testID="host-ad-receipts-done"
        />
      }
    >
      {receipt ? (
        <View style={bs.kv} testID="host-ad-receipt">
          <Kv label={hm("receipts.reference")} value={receipt.reference} />
          {receipt.you_paid_cents !== null ? <Kv label={hm("receipts.paid")} value={props.money(receipt.you_paid_cents)} /> : null}
          {receipt.mingla_fee_cents !== null ? (
            <Kv label={hm("receipts.fees")} value={props.money(receipt.mingla_fee_cents)} testID="host-ad-receipt-fee" />
          ) : null}
          {receipt.ad_name?.trim() ? <Kv label={hm("receipts.ad")} value={receipt.ad_name.trim()} testID="host-ad-receipt-ad" /> : null}
          <Kv label={hm("receipts.credit")} value={props.money(receipt.ad_credit_cents)} />
          {receipt.refunded_cents !== null ? <Kv label={hm("receipts.refunded")} value={props.money(receipt.refunded_cents)} /> : null}
          <Kv label={hm("receipts.balance")} value={props.money(receipt.balance_after_cents)} total />
        </View>
      ) : statement ? (
        <View style={bs.stackLg} testID="host-ad-statement">
          <View style={bs.kv}>
            <Kv label={hm("receipts.opening")} value={props.money(statement.opening_balance_cents)} />
            <Kv label={hm("receipts.topUps")} value={props.money(statement.top_ups_cents)} />
            <Kv label={hm("receipts.fees")} value={props.money(statement.fees_cents)} />
            <Kv label={hm("receipts.returns")} value={props.money(statement.returns_cents)} />
            <Kv label={hm("receipts.withdrawals")} value={props.money(statement.withdrawals_cents)} />
            <Kv label={hm("receipts.closing")} value={props.money(statement.closing_balance_cents)} total />
          </View>
          {statement.spend_by_ad.length > 0 ? (
            <View style={bs.kv}>
              <BuilderLabel>{hm("receipts.perAd")}</BuilderLabel>
              {statement.spend_by_ad.map((row) => (
                <Kv key={row.ad_key} label={row.ad_name?.trim() || hm("receipts.ad")} value={props.money(Math.abs(row.net_cents))} />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <BuilderList>
            {rows.length === 0 ? (
              <ValueRow label={hm("receipts.receipt")} value={hm("receipts.none")} />
            ) : (
              rows.map((row, index) => {
                const top = row.entry_kind === "top_up";
                const amount = props.money(Math.abs(top ? (row.pay_cents ?? row.amount_cents) : (row.refund_cents ?? row.amount_cents)));
                return (
                  <ValueRow
                    key={row.id}
                    divider={index > 0}
                    label={new Date(row.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                    value={top ? hm("receipts.topUp", { amount }) : hm("receipts.withdrawal", { amount })}
                    trailing={hm("receipts.receipt")}
                    onPress={() => void open(async () => setReceipt(await getAdCreditReceipt(props.brandId, row.id)))}
                    testID={`host-ad-receipt-row-${index}`}
                  />
                );
              })
            )}
          </BuilderList>
          <BuilderList>
            <ValueRow
              label={hm("receipts.statement")}
              value={hm("receipts.statementSub", { month: monthName(month) })}
              onPress={() => void open(async () => setStatement(await getAdCreditStatement(props.brandId, month)))}
              testID="host-ad-statement-row"
            />
          </BuilderList>
        </>
      )}
      {loading ? <Text style={bs.small}>{hm("withdraw.checking")}</Text> : null}
      {error ? <Note tone="error" text={error} /> : null}
    </SheetFrame>
  );
}

// ── Compare ──────────────────────────────────────────────────────────────

export function HostAdCompareSheet(props: {
  visible: boolean;
  rows: readonly HostAdCompareRow[];
  money: Money;
  onClose: () => void;
}): React.ReactElement {
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("compare.title")}
      onClose={props.onClose}
      testID="host-ad-compare-sheet"
      foot={<Button label={hm("receipts.done")} variant="primary" fullWidth onPress={props.onClose} testID="host-ad-compare-done" />}
    >
      {props.rows.length === 0 ? (
        <Text style={bs.small}>{hm("compare.empty")}</Text>
      ) : (
        <View style={s.table} accessibilityRole="list">
          <View style={[s.tr, s.th]}>
            <Text style={[s.td, s.tdName, s.thText]}>{hm("list.colAd")}</Text>
            <Text style={[s.td, s.thText]}>{hm("compare.spent")}</Text>
            <Text style={[s.td, s.thText]}>{hm("compare.results")}</Text>
            <Text style={[s.td, s.thText]}>{hm("compare.each")}</Text>
          </View>
          {props.rows.map((row) => (
            <View key={row.id} style={s.tr} testID={`host-ad-compare-${row.id}`}>
              <Text style={[s.td, s.tdName]} numberOfLines={2}>{row.name}</Text>
              <Text style={s.td}>{props.money(row.spentPay)}</Text>
              <Text style={s.td}>{`${row.count} ${hostAdUnit(row.goal)}`}</Text>
              <Text style={s.td}>{row.eachPay === null ? "—" : props.money(row.eachPay)}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={bs.caption}>{hm("compare.note")}</Text>
    </SheetFrame>
  );
}

// ── Share results (truthful: counts only, never what was spent) ──────────

export function hostAdShareMessage(input: {
  event: string;
  goal: HostAdGoal;
  count: number;
  soldOut: boolean;
}): string {
  const result = `${input.count} ${hostAdUnit(input.goal, input.count === 1)}`;
  return input.soldOut
    ? hm("share.soldOut", { event: input.event, result })
    : hm("share.line", { event: input.event, result });
}

/**
 * #4238 rework 1 (tester P1-1): sharing goes through the sanctioned
 * `sharePublicUrl` helper (the #1615 content-share gate), with the promoted
 * page's public link and the results line as its text. Never a direct
 * Share.share call. No public link: the screen hides Share.
 */
export function HostAdShareSheet(props: {
  visible: boolean;
  message: string;
  /** The ad's public page (server public_page_url). */
  url: string;
  title: string;
  onClose: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <SheetFrame
      visible={props.visible}
      title={hm("share.title")}
      onClose={props.onClose}
      testID="host-ad-share-sheet"
      foot={
        <Button
          label={hm("share.go")}
          variant="primary"
          fullWidth
          onPress={() => {
            setError(null);
            // #4238 rework 2 (P3-3): no share sheet (desktop web) → copy the link.
            hostAdShareOrCopy({
              share: () => sharePublicUrl({ title: props.title, url: props.url, description: props.message }),
              copy: () => copyPublicUrl(props.url),
            })
              .then((outcome) => {
                if (outcome === "copied") setCopied(true);
              })
              .catch(() => setError(hm("share.failed")));
          }}
          testID="host-ad-share-go"
        />
      }
    >
      <View style={s.shareCard} accessibilityRole="text" testID="host-ad-share-card">
        <Text style={s.shareText}>{props.message}</Text>
      </View>
      <Text style={bs.small}>{hm("share.body")}</Text>
      {error ? <Note tone="error" text={error} /> : null}
      <Toast
        visible={copied}
        kind="success"
        message={hm("share.copied")}
        onDismiss={() => setCopied(false)}
        testID="host-ad-share-copied"
      />
    </SheetFrame>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space[6], paddingTop: space[2] },
  title: { ...type.h1, color: color.text1, marginBottom: space[6] },
  foot: { paddingTop: space[8], paddingBottom: space[8] },
  half: { flex: 1 },
  center: { textAlign: "center" },
  stepper: { flexDirection: "row", alignItems: "center", gap: space[4] },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.fill.tile,
    ...edge.seg,
  },
  stepOff: { opacity: 0.4 },
  stepText: { ...type.h2, color: color.text1 },
  stepValue: { flex: 1, textAlign: "center" },
  ari: {
    gap: space[4],
    padding: space[5],
    borderRadius: radius.xl,
    backgroundColor: color.card2,
    ...edge.seg,
  },
  who: { flexDirection: "row", alignItems: "center", gap: space[2] },
  whoDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.accent },
  whoText: { ...type.label, color: color.text2, textTransform: "uppercase" },
  table: { borderRadius: radius.lg, overflow: "hidden", ...edge.seg },
  tr: {
    flexDirection: "row",
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  th: { backgroundColor: color.fill.tableHead, borderTopWidth: 0 },
  thText: { color: color.text2 },
  td: { ...type.small, color: color.text1, flex: 1, textAlign: "right" },
  tdName: { flex: 1.6, textAlign: "left" },
  shareCard: {
    padding: space[6],
    borderRadius: radius.xl,
    backgroundColor: color.card3,
    ...edge.seg,
  },
  shareText: { ...type.h2, color: color.text1 },
});
