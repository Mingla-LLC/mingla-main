/**
 * #4490 spec 08 O1 + O2 — the one payment sheet. Methods in order: Tap to pay
 * (only where tillTapOffer allows; shown disabled with the reason on a phone
 * that can't), Scan to pay (the guest pays on their phone, by card or a bank
 * transfer that confirms itself), Cash (with change), the venue's own card
 * machine, Charge to room (disabled, O4 seam). The amount due is the server's
 * remaining amount; cash and the own machine may part-pay, Tap and Scan take
 * everything that is left (the server prices it; the sheet only sends a tip).
 *
 * Every payment carries the check version it was taken against (T10) and one
 * client request id per ATTEMPT (08-O3 fix 5, tillAttemptFor): a retry of the
 * same attempt reuses it, so it never charges twice; any other payment (the
 * rest after a part payment, another way, another amount or tip) gets its own.
 * The paid step shows what the server recorded, never the typed amount.
 *
 * 08-O4: "Pay in full / Split". A split check opens on its shares (the split
 * step, SplitSheet, rendered INSIDE this sheet: never a second native sheet);
 * paying a share uses the same methods with the share's exact amount, its own
 * request id and its shareId. Tap and Scan take the whole share.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../constants/designSystem";
import type {
  TillCardStart,
  TillPayCodeStatus,
  TillPaymentResult,
  TillSale,
  TillShare,
  TillSplitInput,
} from "../../../services/venueTillService";
import { TillError } from "../../../services/venueTillService";
import { formatCurrency } from "../../../utils/currency";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { ListRow } from "../../ui/ListRow";
import { MoneyField } from "../../ui/MoneyField";
import { Chip } from "../../ui/Pill";
import { Sheet } from "../../ui/Sheet";
import { Spinner } from "../../ui/Spinner";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { ReceiptStep } from "./ReceiptStep";
import { TillScanPanel } from "./TillScanPanel";
import { SplitSheet, type SplitMode } from "./SplitSheet";
import { openShares, shareOf, SPLIT_QUICK_WAYS } from "./splitModel";
import { TillTapPanel } from "./TillTapPanel";
import type { TillTapOffer } from "./tillTapAvailability";
import {
  paidLabel,
  recordedPaidMinor,
  resumeLivePayment,
  scanPanelState,
  tillAttemptFor,
  tillAttemptKeepsId,
  tillAttemptKey,
  type TillAttempt,
} from "./tillPayModel";
import { TILL_COPY, tillAmountError, tillErrorCopy } from "./tillCopy";
import { tillSoldOutSentence } from "../stock/stockModel";
import { cashPresets, changeDue, tipBaseMinor, tipChoices, type ReceiptChannel } from "./tillModel";
import { openFloorPdf } from "../../../utils/floorPdf";

type Step = "choose" | "cash" | "own" | "scan" | "tap" | "paid" | "resuming" | "split";

/** O2 fix 3: how often a failed read of the live code is tried again. */
const RESUME_RETRY_MS = 3000;
type PaidMethod = "cash" | "own_machine" | "tap" | "scan";

export interface PaymentSheetProps {
  visible: boolean;
  sale: TillSale | null;
  tipsEnabled: boolean;
  tipBpsOptions: readonly number[];
  onClose: () => void;
  onPay: (input: {
    method: "cash" | "own_machine";
    amountMinor: number;
    tipMinor: number;
    cashGivenMinor: number | null;
    clientRequestId: string;
    expectedVersion: number;
    /** 08-O4: the share being paid, null for the whole check. */
    shareId: string | null;
  }) => Promise<TillPaymentResult>;
  /** 08-O4: set (or clear) the split; the server answers the shares. */
  onSetSplit: (split: TillSplitInput) => Promise<unknown>;
  onNewSale: () => void;
  onRefreshSale: () => void;
  /** O2: the venue (Tap to pay runs against it). */
  venueId: string;
  /** O2: whether this phone offers Tap to pay (tillTapOffer). */
  tapOffer: TillTapOffer;
  /** O2: start a tap or scan payment for everything that is left. */
  onStartCard: (input: {
    method: "tap" | "scan";
    tipMinor: number;
    clientRequestId: string;
    expectedVersion: number;
    shareId: string | null;
  }) => Promise<TillCardStart>;
  scanApi: {
    fetchStatus: (code: string) => Promise<TillPayCodeStatus>;
    cancelCode: (code: string) => Promise<void>;
    textLink: (input: { code: string; phone: string; phoneCountryIso: string | null }) => Promise<{ textLinksLeft: number }>;
  };
  /** pay-receipt: send this payment's receipt (text, email or both). */
  onSendReceipt: (input: {
    paymentId: string;
    channel: ReceiptChannel;
    phone: string | null;
    phoneCountryIso: string | null;
    email: string | null;
  }) => Promise<{ sendsLeft: number }>;
}

export function PaymentSheet({
  visible,
  sale,
  tipsEnabled,
  tipBpsOptions,
  onClose,
  onPay,
  onSetSplit,
  onNewSale,
  onRefreshSale,
  onSendReceipt,
  venueId,
  tapOffer,
  onStartCard,
  scanApi,
}: PaymentSheetProps): React.ReactElement {
  const [step, setStep] = useState<Step>("choose");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  // 08-O4 fix 2 (O4-B1): the chip picked (its percentage), so the tip follows
  // the amount being paid in THIS payment (a share, a part, what is left).
  const [tipBps, setTipBps] = useState<number | null>(null);
  const [cashGiven, setCashGiven] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    method: PaidMethod;
    /** What the server recorded (amount + tip); null if it did not say. */
    amountMinor: number | null;
    changeMinor: number | null;
    paymentId: string;
    label?: string;
  } | null>(null);
  const [card, setCard] = useState<TillCardStart | null>(null);
  const [tapBusy, setTapBusy] = useState(false);
  // O2 fix 3: a live payment found on opening (read once per opening of the sheet).
  const [tapResumed, setTapResumed] = useState(false);
  const [resumeTry, setResumeTry] = useState(0);
  const resumeDone = useRef(false);
  // 08-O3 fix 5: the attempt in flight (its request id and money facts). A
  // retry of the same facts reuses the id; it is dropped once the server has
  // answered, and on every way back to the methods.
  const attempt = useRef<TillAttempt | null>(null);
  // 08-O4: the share being paid (null: the whole check), and where the split
  // editor starts.
  const [share, setShare] = useState<TillShare | null>(null);
  const [splitStart, setSplitStart] = useState<{ mode: SplitMode; count: number }>({ mode: "by_item", count: 2 });
  const [splitKey, setSplitKey] = useState(0);
  const liveShare = shareOf(sale, share?.id ?? null);

  const currency = sale?.currency ?? "NGN";
  const due = share !== null ? share.amountMinor : sale?.remainingMinor ?? 0;
  const money = (minor: number): string => formatCurrency(minor, currency, true);

  useEffect(() => {
    if (!visible) return;
    setStep("choose");
    setAmountMinor(null);
    setTipBps(null);
    setCashGiven(null);
    setError(null);
    setResult(null);
    setCard(null);
    setTapBusy(false);
    setTapResumed(false);
    resumeDone.current = false;
    attempt.current = null;
    setShare(null);
  }, [visible]);

  // O2-B1: a check that already has a live card payment opens on that payment's
  // waiting panel (the same panels, not a second one), never on methods the
  // server refuses. A scan code is read back for its link; a tap with no reader
  // to resume shows waiting with Cancel payment.
  useEffect(() => {
    if (!visible || sale === null || resumeDone.current) return undefined;
    // 08-O4: a split check opens on its shares; a share's own live payment is
    // resumed when that share is picked.
    if (share === null && openShares(sale).length > 0) {
      resumeDone.current = true;
      setStep("split");
      return undefined;
    }
    const live = resumeLivePayment(sale, Date.now(), share?.id ?? null);
    if (live.kind === "none") {
      resumeDone.current = true;
      return undefined;
    }
    const p = live.payment;
    const base = {
      paymentId: p.id,
      amountMinor: p.amountMinor,
      tipMinor: p.tipMinor,
      chargedMinor: p.chargedMinor ?? p.amountMinor + p.tipMinor,
      sale: null,
    };
    if (live.kind === "tap") {
      resumeDone.current = true;
      setCard({ ...base, code: null, payUrl: null, expiresAt: null });
      setTapResumed(true);
      setStep("tap");
      return undefined;
    }
    setStep("resuming");
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void scanApi
      .fetchStatus(live.code)
      .then((st) => {
        if (!alive) return;
        const panel = scanPanelState(
          { status: st.status, paymentState: st.paymentState, payStarted: st.payStarted, expiresAt: st.expiresAt },
          Date.now(),
        );
        if (st.payUrl === null || (panel !== "waiting" && panel !== "paying")) {
          // Paid, closed or past its time since the sheet was last open: the
          // check shows the truth, and the methods are open again.
          resumeDone.current = true;
          onRefreshSale();
          setStep("choose");
          return;
        }
        resumeDone.current = true;
        setCard({ ...base, code: st.code, payUrl: st.payUrl, expiresAt: st.expiresAt });
        setStep("scan");
      })
      .catch(() => {
        if (!alive) return;
        // The read failed: try again shortly rather than showing a dead end.
        timer = setTimeout(() => setResumeTry((n) => n + 1), RESUME_RETRY_MS);
      });
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sale, resumeTry, share]);

  // O1-B1: the typed amount is what is taken, never quietly swapped for the
  // balance; an amount above what is left is refused in words and blocks the
  // methods until it is fixed.
  const payAmount = amountMinor ?? due;
  const amountError = tillAmountError(amountMinor, due);
  const canChooseMethod = amountError === null && payAmount > 0;
  const tips = useMemo(
    () => (tipsEnabled ? tipChoices(tipBaseMinor(sale, share, payAmount), tipBpsOptions) : []),
    [sale, share, payAmount, tipsEnabled, tipBpsOptions],
  );
  const tipMinor = tipBps === null ? 0 : tips.find((t) => t.bps === tipBps)?.minor ?? 0;
  const change = changeDue(cashGiven, payAmount, tipMinor);
  const presets = cashPresets(payAmount + tipMinor);

  // 08-O4 fix 2 (O4-B4): "Pay in full" on a split check pays everything that
  // is left in one payment: the unpaid shares are dropped first (the paid ones
  // stay paid), exactly as the shares list's "Pay in full" does, then this
  // payment is taken against the check as it is after that.
  const versionForWhole = async (): Promise<number> => {
    if (sale === null) return 0;
    if (share !== null || openShares(sale).length === 0) return sale.version;
    const after = (await onSetSplit({ mode: "none" })) as TillSale | null | undefined;
    return after?.version ?? sale.version;
  };

  const take = async (method: "cash" | "own_machine"): Promise<void> => {
    if (sale === null || busy) return;
    setBusy(true);
    setError(null);
    const cashGivenMinor = method === "cash" ? cashGiven : null;
    const current = tillAttemptFor(
      attempt.current,
      tillAttemptKey({ method, amountMinor: payAmount, tipMinor, cashGivenMinor, shareId: share?.id ?? null }),
    );
    attempt.current = current;
    try {
      const expectedVersion = await versionForWhole();
      const paid = await onPay({
        method,
        amountMinor: payAmount,
        tipMinor,
        cashGivenMinor,
        clientRequestId: current.id,
        expectedVersion,
        shareId: share?.id ?? null,
      });
      // Taken (or the first try's answer replayed): this attempt is over.
      attempt.current = null;
      setResult({ method, amountMinor: recordedPaidMinor(paid), changeMinor: paid.changeMinor, paymentId: paid.paymentId });
      setStep("paid");
    } catch (err) {
      const code = err instanceof TillError ? err.code : "till_failed";
      // A failure that may have reached the server keeps the id, so "Try
      // again" with the same facts can never take the money twice. Any answer
      // from the server means nothing moved: the next try is a new attempt.
      if (!tillAttemptKeepsId(code)) attempt.current = null;
      if (code === "till_check_changed" || code === "till_amount_over_due" || code === "till_nothing_to_pay" || code === "till_request_reused") {
        // Nothing moved: refresh the check. The typed amount stays as typed;
        // the field says if it is now more than is left.
        onRefreshSale();
        setStep("choose");
      }
      if (share !== null && (code === "till_check_changed" || code === "till_share_paid" || code === "till_share_paying")) {
        // The split moved on another device: back to the shares as they are now.
        onRefreshSale();
        setShare(null);
        setStep("split");
      }
      setError(code === "item_sold_out" && err instanceof TillError ? tillSoldOutSentence("pay", err.item, null) : tillErrorCopy(code));
    } finally {
      setBusy(false);
    }
  };

  // O2: Tap and Scan take everything that is left; a typed part amount is for
  // cash or the own machine.
  const wholeAmount = amountMinor === null || amountMinor === due;
  const canCard = canChooseMethod && wholeAmount;

  const startCard = async (method: "tap" | "scan"): Promise<void> => {
    if (sale === null || busy) return;
    setBusy(true);
    setError(null);
    const current = tillAttemptFor(attempt.current, tillAttemptKey({ method, tipMinor, shareId: share?.id ?? null }));
    attempt.current = current;
    try {
      const expectedVersion = await versionForWhole();
      const started = await onStartCard({
        method,
        tipMinor,
        clientRequestId: current.id,
        expectedVersion,
        shareId: share?.id ?? null,
      });
      // The card payment exists on the server now; its panel follows it by
      // payment id. Whatever happens to it, the next start is a new attempt.
      attempt.current = null;
      setCard(started);
      setStep(method);
    } catch (err) {
      const code = err instanceof TillError ? err.code : "till_failed";
      if (!tillAttemptKeepsId(code)) attempt.current = null;
      if (code === "till_check_changed" || code === "till_nothing_to_pay" || code === "till_request_reused") {
        onRefreshSale();
      }
      if (share !== null && (code === "till_check_changed" || code === "till_share_paid" || code === "till_share_paying")) {
        setShare(null);
        setStep("split");
      }
      setError(code === "item_sold_out" && err instanceof TillError ? tillSoldOutSentence("pay", err.item, null) : tillErrorCopy(code));
    } finally {
      setBusy(false);
    }
  };

  const cardPaid = (method: "tap" | "scan", label: string): void => {
    if (card === null) return;
    setResult({ method, amountMinor: card.amountMinor + card.tipMinor, changeMinor: null, paymentId: card.paymentId, label });
    setStep("paid");
    onRefreshSale();
  };

  // A new attempt (a fresh code, or another way) never reuses the old request.
  const backToChoose = (): void => {
    attempt.current = null;
    setCard(null);
    setStep("choose");
    onRefreshSale();
  };

  // 08-O3 fix 5 (O3-S3): "Pay <rest>" after a part payment is a NEW payment:
  // a new request id, and the amount is what is left now (not the part just
  // typed); tip and cash given start again.
  const payRest = (): void => {
    attempt.current = null;
    setAmountMinor(null);
    setTipBps(null);
    setCashGiven(null);
    setError(null);
    setResult(null);
    setStep("choose");
  };

  // 08-O4: pay one share (its own attempt, its exact amount). A share already
  // being paid opens on its live payment's panel.
  const payShare = (picked: TillShare): void => {
    attempt.current = null;
    setAmountMinor(null);
    setTipBps(null);
    setCashGiven(null);
    setError(null);
    setResult(null);
    setCard(null);
    setTapResumed(false);
    setShare(picked);
    if (picked.state === "paying") {
      resumeDone.current = false;
      setResumeTry((n) => n + 1);
    } else {
      resumeDone.current = true;
      setStep("choose");
    }
  };
  const backToShares = (): void => {
    attempt.current = null;
    setShare(null);
    setCard(null);
    setResult(null);
    setError(null);
    setStep("split");
    onRefreshSale();
  };
  const openSplit = (mode: SplitMode, count: number): void => {
    setSplitStart({ mode, count });
    setSplitKey((k) => k + 1);
    setError(null);
    setStep("split");
  };
  const applySplit = async (split: TillSplitInput): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSetSplit(split);
      if (split.mode === "none") setStep("choose");
    } catch (err) {
      const code = err instanceof TillError ? err.code : "till_failed";
      if (code === "till_check_changed") onRefreshSale();
      setError(code === "item_sold_out" && err instanceof TillError ? tillSoldOutSentence("pay", err.item, null) : tillErrorCopy(code));
    } finally {
      setBusy(false);
    }
  };
  // A5: "{n} ways" sets an even split at once and shows its shares.
  const quickWays = async (n: number): Promise<void> => {
    openSplit("even", n);
    await applySplit({ mode: "even", count: n });
  };
  const sharesOpen = openShares(sale);
  // A share dropped or paid on another device while this one was choosing a
  // method: back to the shares as they are now.
  useEffect(() => {
    if (share !== null && step === "choose" && (liveShare === null || liveShare.state === "paid")) {
      attempt.current = null;
      setShare(null);
      setStep("split");
    }
  }, [share, step, liveShare]);
  const canSplit = share === null && (sale?.remainingMinor ?? 0) > 0 && sale?.state === "open";

  const title =
    step === "split"
      ? TILL_COPY.splitTheBill
      : step === "resuming"
      ? TILL_COPY.scanToPay
      : step === "paid"
      ? TILL_COPY.paymentTaken
      : step === "cash"
      ? TILL_COPY.cash
      : step === "own"
      ? TILL_COPY.ownMachine
      : step === "scan"
      ? TILL_COPY.scanToPay
      : step === "tap"
      ? TILL_COPY.tapToPay
      : share !== null
      ? TILL_COPY.payShare(share.shareNo, money(due))
      : TILL_COPY.pay(money(due));
  const tapDisabledReason =
    tapOffer.kind !== "disabled"
      ? null
      : tapOffer.reason === "ios_update"
      ? TILL_COPY.tapUpdateIos
      : tapOffer.reason === "needs_latest_app"
      ? TILL_COPY.tapNeedsApp
      : TILL_COPY.tapNotOnIpad;

  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (sale === null) {
    body = <Text style={styles.muted}>{TILL_COPY.payPending}</Text>;
  } else if (step === "split") {
    body = (
      <SplitSheet
        key={splitKey}
        sale={sale}
        busy={busy}
        initialMode={splitStart.mode}
        initialCount={splitStart.count}
        onSetSplit={applySplit}
        onPayShare={payShare}
        onPayInFull={() => void applySplit({ mode: "none" })}
        error={error}
      />
    );
  } else if (step === "resuming") {
    body = (
      <View style={[styles.body, styles.center]} testID="till-pay-resuming">
        <Spinner size={36} />
      </View>
    );
  } else if (step === "choose") {
    body = (
      <View style={styles.body}>
        <View style={styles.dueBox}>
          <Text style={styles.label}>
            {share !== null ? TILL_COPY.shareN(share.shareNo) : sale.paidMinor > 0 ? TILL_COPY.leftToPay : TILL_COPY.amountDue}
          </Text>
          <Text style={styles.big} testID="till-pay-due">{money(due)}</Text>
        </View>
        {canSplit ? (
          // Spec 08 §11 A5: Pay in full · 2 ways · 3 ways · 4 ways · By item.
          <View style={styles.chips} testID="till-split-chips">
            <Chip label={TILL_COPY.payInFull} selected onPress={() => undefined} testID="till-split-chip-full" />
            {SPLIT_QUICK_WAYS.map((n) => (
              <Chip key={n} label={TILL_COPY.ways(n)} disabled={busy || due < n} onPress={() => void quickWays(n)}
                testID={`till-split-chip-${n}`} />
            ))}
            <Chip label={TILL_COPY.byItem} disabled={busy || sale.split?.evenOnly === true} onPress={() => openSplit("by_item", 2)}
              testID="till-split-chip-item" />
          </View>
        ) : null}
        {share === null ? (
          <MoneyField
            label={wholeAmount ? TILL_COPY.payInFull : TILL_COPY.payPart}
            valueMinor={amountMinor ?? due}
            onChangeMinor={(next) => setAmountMinor(next)}
            currency={currency}
            error={amountError}
            testID="till-pay-amount"
          />
        ) : null}
        {tips.length > 1 ? (
          <View style={styles.chips}>
            {tips.map((t) => (
              <Chip
                key={t.bps}
                label={t.bps === 0 ? TILL_COPY.noTip : `${t.bps / 100}% · ${money(t.minor)}`}
                selected={(tipBps ?? 0) === t.bps}
                onPress={() => setTipBps(t.bps === 0 ? null : t.bps)}
                testID={`till-tip-${t.bps}`}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.methods}>
          {tapOffer.kind !== "hidden" ? (
            <ListRow
              title={TILL_COPY.tapToPay}
              subtitle={tapDisabledReason ?? (wholeAmount ? TILL_COPY.tapSub : TILL_COPY.takesWhatIsLeft)}
              icon="tap"
              onPress={() => void startCard("tap")}
              disabled={tapOffer.kind !== "ready" || !canCard || busy}
              testID="till-pay-tap"
            />
          ) : null}
          <ListRow
            title={TILL_COPY.scanToPay}
            subtitle={wholeAmount ? TILL_COPY.scanSub : TILL_COPY.takesWhatIsLeft}
            icon="qr"
            onPress={() => void startCard("scan")}
            disabled={!canCard || busy}
            testID="till-pay-scan"
          />
          <ListRow title={TILL_COPY.cash} subtitle={TILL_COPY.cashSub} icon="cash" onPress={() => setStep("cash")} disabled={!canChooseMethod} testID="till-pay-cash" />
          <ListRow title={TILL_COPY.ownMachine} subtitle={TILL_COPY.ownMachineSub} icon="keypad" onPress={() => setStep("own")} disabled={!canChooseMethod} testID="till-pay-own" />
          <ListRow title={TILL_COPY.chargeToRoom} subtitle={TILL_COPY.chargeToRoomLater} icon="home" disabled testID="till-pay-room" />
        </View>
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
  } else if (step === "cash") {
    body = (
      <View style={styles.body}>
        <View style={styles.dueBox}>
          <Text style={styles.label}>{TILL_COPY.amountDue}</Text>
          <Text style={styles.big}>{money(payAmount + tipMinor)}</Text>
        </View>
        <MoneyField label={TILL_COPY.cashGiven} valueMinor={cashGiven} onChangeMinor={setCashGiven} currency={currency} testID="till-cash-given" />
        <View style={styles.chips}>
          {presets.map((p, i) => (
            <Chip
              key={p}
              label={i === 0 ? TILL_COPY.exact(money(p)) : money(p)}
              selected={cashGiven === p}
              onPress={() => setCashGiven(p)}
              testID={`till-cash-preset-${i}`}
            />
          ))}
        </View>
        <View style={styles.changeBox}>
          <Text style={styles.label}>{TILL_COPY.changeToGive}</Text>
          <Text style={styles.big} testID="till-cash-change">{change === null ? "--" : money(change)}</Text>
        </View>
        {payAmount < due ? <Text style={styles.muted}>{TILL_COPY.partCash}</Text> : null}
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
    footer = (
      <Button
        label={TILL_COPY.takeCash(money(payAmount + tipMinor))}
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={change === null}
        onPress={() => void take("cash")}
        testID="till-cash-take"
      />
    );
  } else if (step === "scan" && card !== null && card.code !== null && card.payUrl !== null) {
    body = (
      <TillScanPanel
        code={card.code}
        payUrl={card.payUrl}
        expiresAt={card.expiresAt}
        amountMinor={card.amountMinor}
        tipMinor={card.tipMinor}
        chargedMinor={card.chargedMinor}
        currency={currency}
        fetchStatus={scanApi.fetchStatus}
        cancelCode={scanApi.cancelCode}
        textLink={scanApi.textLink}
        onPaid={(st) =>
          cardPaid("scan", paidLabel({ method: "scan", providerChannel: st.providerChannel, cardBrand: null, cardLast4: null }))
        }
        onMakeNew={backToChoose}
        onChooseAnother={backToChoose}
        onBackToTill={onClose}
      />
    );
  } else if (step === "tap" && card !== null) {
    body = (
      <TillTapPanel
        venueId={venueId}
        paymentId={card.paymentId}
        chargedMinor={card.chargedMinor}
        currency={currency}
        onBusyChange={setTapBusy}
        onPaid={() => cardPaid("tap", TILL_COPY.tapToPay)}
        onScanInstead={backToChoose}
        resumed={tapResumed}
      />
    );
  } else if (step === "own") {
    body = (
      <View style={[styles.body, styles.center]}>
        <Text style={styles.big}>{money(payAmount + tipMinor)}</Text>
        <Text style={styles.title}>{TILL_COPY.ownMachineAsk}</Text>
        <Text style={styles.muted}>{TILL_COPY.ownMachineBody}</Text>
        {error !== null ? <Banner tone="danger" title={error} /> : null}
      </View>
    );
    footer = (
      <View style={styles.footerCol}>
        <Button label={TILL_COPY.yesApproved} variant="primary" size="lg" fullWidth loading={busy} onPress={() => void take("own_machine")} testID="till-own-yes" />
        <Button label={TILL_COPY.noGoBack} variant="secondary" size="md" fullWidth disabled={busy} onPress={() => setStep("choose")} testID="till-own-no" />
      </View>
    );
  } else {
    const left = sale.remainingMinor;
    body = (
      <View style={styles.body}>
        {share !== null ? <Text style={styles.title}>{TILL_COPY.sharePaid(share.shareNo)}</Text> : null}
        {result !== null && result.amountMinor !== null ? (
          <Text style={styles.big} testID="till-paid-amount">{money(result.amountMinor)}</Text>
        ) : null}
        <Text style={styles.muted}>
          {[
            result?.label ?? (result?.method === "cash" ? TILL_COPY.cash : TILL_COPY.ownMachine),
            result?.changeMinor !== null && result?.changeMinor !== undefined ? TILL_COPY.changeLine(money(result.changeMinor)) : null,
          ].filter(Boolean).join(" · ")}
        </Text>
        {left > 0 ? (
          <View style={styles.dueBox}>
            <Text style={styles.label}>{TILL_COPY.leftToPay}</Text>
            <Text style={styles.big}>{money(left)}</Text>
          </View>
        ) : null}
        {result !== null && result.paymentId.length > 0 ? (
          <ReceiptStep
            key={result.paymentId}
            currency={currency}
            sendsUsed={0}
            onSend={(input) => onSendReceipt({ paymentId: result.paymentId, ...input })}
            onPrint={async () => {
              await openFloorPdf({ kind: "receipt", venueId, paymentId: result.paymentId });
            }}
            testID="till-pay-receipt"
          />
        ) : null}
      </View>
    );
    footer =
      left > 0 && (share !== null || sharesOpen.length > 0) ? (
        <Button label={TILL_COPY.backToShares} variant="primary" size="lg" fullWidth onPress={backToShares} testID="till-pay-shares" />
      ) : left > 0 ? (
        <Button label={TILL_COPY.pay(money(left))} variant="primary" size="lg" fullWidth onPress={payRest} testID="till-pay-rest" />
      ) : (
        <Button label={TILL_COPY.newSale} variant="primary" size="lg" fullWidth onPress={onNewSale} testID="till-new-sale" />
      );
  }

  return (
    // Tap outside closes, except while money is moving.
    <Sheet visible={visible} onClose={onClose} snapPoint={0.9} dismissDisabled={busy || tapBusy} testID="till-pay-sheet">
      <View style={styles.host}>
        <View style={styles.head}>
          <Text style={styles.heading} accessibilityRole="header">{title}</Text>
          {step === "cash" || step === "own" ? (
            <Button label={TILL_COPY.noGoBack} variant="ghost" size="sm" disabled={busy} onPress={() => setStep("choose")} />
          ) : step === "choose" && (share !== null || sharesOpen.length > 0) ? (
            <Button label={TILL_COPY.backToShares} variant="ghost" size="sm" disabled={busy} onPress={backToShares}
              testID="till-pay-back-shares" />
          ) : (
            <Button label={TILL_COPY.close} variant="ghost" size="sm" disabled={busy || tapBusy} onPress={onClose} testID="till-pay-close" />
          )}
        </View>
        <SheetScrollLayout footer={footer} keyboardAware contentStyle={styles.scroll}>
          {body}
        </SheetScrollLayout>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space[4], paddingVertical: space[2], gap: space[2] },
  heading: { ...type.h2, color: color.text1, flexShrink: 1 },
  scroll: { gap: space[3], paddingBottom: space[4], paddingHorizontal: space[1] },
  body: { gap: space[3] },
  center: { alignItems: "center" },
  dueBox: { gap: space[1], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  changeBox: { gap: space[1], padding: space[3], borderRadius: radius.lg, backgroundColor: color.card2 },
  label: { ...type.small, color: color.text2 },
  big: { ...type.h1, color: color.text1 },
  title: { ...type.h2, color: color.text1, textAlign: "center" },
  muted: { ...type.small, color: color.text2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  methods: { gap: space[2] },
  footerCol: { gap: space[2] },
});
