/**
 * /event/[id]/door/pay/[codeId] — "Scan to pay" (issue #4271, design H3–H6).
 *
 * The host shows a door pay code; the guest points their phone camera at it
 * and pays on their own phone. The screen listens to the code's row live and
 * turns green the moment the provider confirms. States: open, opened (guest is
 * paying), paid, expired, cancelled, failed. Every end state says whether money
 * was taken, and recovery is one tap: a new code, or cash instead.
 *
 * The phone's clock never ends a code: past its time the screen shows
 * "Checking…" until the server has asked the provider.
 *
 * While a code is showing the phone stays awake at full brightness, so a guest can
 * scan it (design H3); leaving restores the phone's own settings.
 *
 * Door polish (#4271): top to bottom it reads amount, tickets, QR, code, then
 * one status pill with the live countdown (DoorStatusPill). When the guest
 * opens the code the QR dims to 35% and the pill says "Guest is paying…". End
 * rings follow the door tones: expired and cancelled grey (nothing charged),
 * failed red, checking and payment landing amber, paid green.
 *
 * I-21: operator-side route (useAuth via the hooks below).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  durations,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../../../src/constants/designSystem";
import { DoorPayQr } from "../../../../../src/components/door/DoorPayQr";
import { DoorStatusPill } from "../../../../../src/components/door/DoorStatusPill";
import { doorPayHostTone, doorToneStyle } from "../../../../../src/components/door/doorTone";
import { useReduceMotion } from "../../../../../src/hooks/useMotionPreferences";
import { doorSellAnotherHref } from "../../../../../src/components/door/doorTapDraft";
import { formatDoorPayCode, makeDoorPayUrl, isDoorPayCode } from "../../../../../src/components/door/doorPayUrl";
import {
  closeDoorPayCodeThen,
  doorPayGuestRowValue,
  doorPayHostEndBody,
  doorPayHostEndCopy,
  doorPayHostStatus,
  doorPayTextLinkErrorMessage,
  doorPayCountdownSeconds,
  doorPayCountdownWords,
  doorPayWaitingPillText,
  DOOR_PAY_URGENT_SECONDS,
  formatDoorPayCountdown,
  isDoorPayPastTime,
  openedAgoLabel,
  summarizeDoorPayLines,
  type DoorPayHostAction,
  type DoorPayLatePaymentRead,
} from "../../../../../src/components/door/doorPayCodeState";
import { Button } from "../../../../../src/components/ui/Button";
import { IconChrome } from "../../../../../src/components/ui/IconChrome";
import { Icon } from "../../../../../src/components/ui/Icon";
import { PhoneField, usePhoneEntry } from "../../../../../src/components/ui/PhoneField";
import { Sheet } from "../../../../../src/components/ui/Sheet";
import {
  useCancelDoorPayCode,
  useCreatedDoorPayCode,
  useDoorPayCode,
  useDoorPayGuestName,
  useDoorPayLatePayment,
  useSettleDoorPayCode,
  useTextDoorPayLink,
} from "../../../../../src/hooks/useDoorPayCodes";
import { useCreateDoorPayCode } from "../../../../../src/hooks/useEventDoorSales";
import { useManagedEventRoute } from "../../../../../src/hooks/useManagedEventRoute";
import { useDoorScreenAwake } from "../../../../../src/hooks/useDoorScreenAwake";
import { DoorPayCodeError, type DoorPayLiveStatus } from "../../../../../src/services/doorPayCodeService";
import { formatCurrency } from "../../../../../src/utils/currency";
import { HapticFeedback } from "../../../../../src/utils/hapticFeedback";
import { phoneStartCountryForCurrency } from "../../../../../src/utils/phoneStartCountryForCurrency";

const QR_SIZE = 232;
/** How often an unsettled code asks the server again. */
const SETTLE_RETRY_MS = 5_000;

const first = (value: string | string[] | undefined): string | null => {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length > 0 ? v : null;
};

export default function DoorPayCodeRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[]; codeId: string | string[] }>();
  const eventId = first(params.id);
  const codeId = first(params.codeId);

  const routeEvent = useManagedEventRoute(eventId);
  const codeQuery = useDoorPayCode(codeId);
  const created = useCreatedDoorPayCode(codeId);
  const cancelCode = useCancelDoorPayCode(codeId);
  const createCode = useCreateDoorPayCode(eventId);

  const [nowMs, setNowMs] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [textOpen, setTextOpen] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const row = codeQuery.data ?? null;
  const [serverAnswer, setServerAnswer] = useState<{ status: DoorPayLiveStatus; atMs: number } | null>(null);
  const status =
    row === null ? null : doorPayHostStatus(row.status, row.expiresAt, nowMs, serverAnswer?.status ?? null);
  const closed = status === "expired" || status === "failed" || status === "cancelled";
  useDoorScreenAwake(status === "open" || status === "opened");

  // The phone's clock passed the code's time: ask the server, again every few
  // seconds until it has an answer. Only the server can say nothing landed.
  const settleCode = useSettleDoorPayCode(codeId);
  const settleInFlight = useRef<boolean>(false);
  const pastTime = row !== null && isDoorPayPastTime(row.status, row.expiresAt, nowMs);
  const unsettled = row !== null && (row.status === "open" || row.status === "opened") &&
    (pastTime || serverAnswer?.status === "payment_landing");
  useEffect(() => {
    if (!unsettled || settleInFlight.current) return;
    if (serverAnswer !== null && nowMs - serverAnswer.atMs < SETTLE_RETRY_MS) return;
    settleInFlight.current = true;
    settleCode
      .mutateAsync()
      .then((answer) => setServerAnswer({ status: answer, atMs: Date.now() }))
      .catch(() => setServerAnswer({ status: "checking", atMs: Date.now() }))
      .finally(() => {
        settleInFlight.current = false;
      });
  }, [nowMs, serverAnswer, settleCode, unsettled]);

  // "Nothing was charged" is only said once the server confirms it; a payment
  // that landed after the code closed is named with its refund.
  const latePaymentQuery = useDoorPayLatePayment(codeId, closed);
  const latePayment: DoorPayLatePaymentRead = latePaymentQuery.isSuccess
    ? latePaymentQuery.data === null
      ? { kind: "none" }
      : {
          kind: "payment",
          state: latePaymentQuery.data.state,
          amount: formatCurrency(
            latePaymentQuery.data.amountCents,
            latePaymentQuery.data.currency.length > 0
              ? latePaymentQuery.data.currency
              : (row?.currency ?? ""),
            true,
          ),
        }
    : latePaymentQuery.isError
      ? { kind: "unknown" }
      : { kind: "checking" };

  const guestNameQuery = useDoorPayGuestName(codeId, status === "paid");
  const guestRow = doorPayGuestRowValue({
    isSuccess: guestNameQuery.isSuccess,
    name: guestNameQuery.data,
  });

  // Ticket names: from the create answer when this phone made the code,
  // otherwise from the event's own tiers.
  const namedLines = useMemo(() => {
    if (row === null) return [];
    return row.lines.map((line) => {
      const fromCreate = created?.lines.find((l) => l.ticketTypeId === line.ticketTypeId);
      const tier = routeEvent.event?.tickets.find((t) => t.id === line.ticketTypeId);
      return {
        ticketTypeId: line.ticketTypeId,
        quantity: line.quantity,
        name: fromCreate?.name ?? (tier !== undefined && tier.name.length > 0 ? tier.name : "Ticket"),
      };
    });
  }, [created, routeEvent.event?.tickets, row]);

  const amount =
    row !== null && row.currency.length > 0
      ? formatCurrency(row.totalCents, row.currency, true)
      : "—";

  // The QR dims to 35% while the guest is paying (still scannable, "in use").
  const reduceMotion = useReduceMotion();
  const qrOpacity = useRef(new Animated.Value(1)).current;
  const qrDimmed = status === "opened";
  useEffect(() => {
    const target = qrDimmed ? 0.35 : 1;
    if (reduceMotion) {
      qrOpacity.setValue(target);
      return;
    }
    Animated.timing(qrOpacity, {
      toValue: target,
      duration: durations.entry,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [qrDimmed, reduceMotion, qrOpacity]);

  // Success haptic exactly once, when the guest's payment lands.
  const celebrated = useRef<boolean>(false);
  useEffect(() => {
    if (status === "paid" && !celebrated.current) {
      celebrated.current = true;
      HapticFeedback.success();
    }
  }, [status]);

  const goToDoor = useCallback(
    (query: string): void => {
      if (eventId === null) return;
      router.replace(`/event/${eventId}/door${query}` as never);
    },
    [eventId, router],
  );

  // "Sell another" / "Take cash instead": same contract as the Tap to Pay
  // route — `/door?sellAnother=1&draft=<base64 json>` reopens the sheet.
  const openSheet = useCallback(
    (method: "pay_code" | "cash"): void => {
      if (eventId === null) return;
      router.replace(
        doorSellAnotherHref(
          eventId,
          { lines: row?.lines ?? [], eventDateId: row?.eventDateId ?? null },
          method,
        ) as never,
      );
    },
    [eventId, router, row?.eventDateId, row?.lines],
  );

  /**
   * Cancels on the server. True only when the code is confirmed closed: a
   * payment that landed shows paid instead of letting the host charge twice.
   */
  const closeCode = useCallback(async (): Promise<boolean> => {
    try {
      const answer = await cancelCode.mutateAsync();
      if (answer === "cancelled") return true;
      setServerAnswer({ status: answer, atMs: Date.now() });
      setActionError(
        answer === "checking"
          ? "Couldn't reach the card provider to close this code. It's still open. Try again."
          : null,
      );
      return false;
    } catch (error) {
      if (error instanceof DoorPayCodeError && error.status === 409) {
        void codeQuery.refetch();
        setActionError("This code was already paid, so it can't be cancelled.");
      } else {
        setActionError("Couldn't cancel the code. Check your connection and try again.");
      }
      return false;
    }
  }, [cancelCode, codeQuery]);

  /** Opens the sale sheet only once nothing can still land on this code. */
  const closeThenOpenSheet = useCallback(
    async (method: "pay_code" | "cash"): Promise<void> => {
      setActionError(null);
      await closeDoorPayCodeThen({
        status: row?.status,
        close: closeCode,
        open: () => openSheet(method),
      });
    },
    [closeCode, openSheet, row?.status],
  );

  const handleNewCode = useCallback(async (): Promise<void> => {
    if (row === null || eventId === null) return;
    setActionError(null);
    try {
      const next = await createCode.mutateAsync({
        eventId,
        eventDateId: row.eventDateId,
        lines: row.lines,
        // The server closes this code and its checkout first, so a guest still
        // on the old page can never pay both.
        replacesCodeId: row.id,
      });
      router.replace(`/event/${eventId}/door/pay/${next.codeId}` as never);
    } catch (error) {
      // The guest's payment beat the new code: show it instead.
      if (error instanceof DoorPayCodeError && error.code === "door_code_unavailable") {
        if (error.codeStatus === "payment_landing" || error.codeStatus === "checking") {
          setServerAnswer({ status: error.codeStatus, atMs: Date.now() });
        }
        void codeQuery.refetch();
        return;
      }
      // A dated ticket needs its date again: reopen the sheet with the tickets.
      if (error instanceof DoorPayCodeError && error.code === "ticket_not_valid_on_chosen_days") {
        void closeThenOpenSheet("pay_code");
        return;
      }
      setActionError("Couldn't make a new code. Try again.");
    }
  }, [closeThenOpenSheet, codeQuery, createCode, eventId, router, row]);

  const handleAction = useCallback(
    (action: DoorPayHostAction): void => {
      if (action === "new_code") void handleNewCode();
      else if (action === "cash_instead") void closeThenOpenSheet("cash");
      else goToDoor("");
    },
    [closeThenOpenSheet, goToDoor, handleNewCode],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    setActionError(null);
    await closeCode();
  }, [closeCode]);

  const handleClose = useCallback((): void => {
    goToDoor("");
  }, [goToDoor]);

  // ---- Shells ----------------------------------------------------------

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={44} onPress={handleClose} accessibilityLabel="Close" />
      <Text style={styles.chromeTitle}>Scan to pay</Text>
      <View style={styles.chromeSlot} />
    </View>
  );

  let body: React.ReactNode;
  if (codeQuery.isLoading || (row === null && !codeQuery.isError)) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={accent.warm} />
        <Text style={styles.muted}>Loading the pay code…</Text>
      </View>
    );
  } else if (row === null || status === null) {
    body = (
      <View style={styles.center}>
        <Text style={styles.endTitle}>Couldn't load this pay code</Text>
        <Text style={styles.muted}>Check your connection and try again.</Text>
        <Button label="Try again" onPress={() => void codeQuery.refetch()} variant="primary" size="md" fullWidth />
      </View>
    );
  } else if (status === "paid") {
    body = (
      <View style={styles.center} testID="door-pay-paid">
        <ToneRing tone="ok" />
        <Text style={styles.big}>Paid {amount}</Text>
        <Text style={styles.muted}>Paid on their phone</Text>
        <View style={styles.card}>
          <View style={styles.kv}>
            <Text style={styles.kvKey}>Tickets</Text>
            <Text style={styles.kvValue}>{summarizeDoorPayLines(namedLines)}</Text>
          </View>
          {guestRow !== null ? (
            <View style={styles.kv} testID="door-pay-guest-row">
              <Text style={styles.kvKey}>Guest</Text>
              <Text style={styles.kvValue}>{guestRow}</Text>
            </View>
          ) : null}
          <View style={styles.kv}>
            <Text style={styles.kvKey}>Entry</Text>
            <Text style={styles.kvValueOk}>Checked in</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label="Sell another"
            onPress={() => void closeThenOpenSheet("pay_code")}
            variant="primary"
            size="lg"
            fullWidth
            testID="door-pay-sell-another"
          />
          <Button label="Done" onPress={handleClose} variant="ghost" size="md" fullWidth />
        </View>
      </View>
    );
  } else if (status === "checking") {
    body = (
      <View style={styles.center} testID="door-pay-checking" accessibilityLiveRegion="assertive">
        <ToneRing tone="caution" busy />
        <Text style={styles.endTitle}>Checking…</Text>
        <Text style={styles.muted}>
          We're asking the card provider whether a payment went through. Don't charge them again yet.
        </Text>
      </View>
    );
  } else if (status === "payment_landing") {
    body = (
      <View style={styles.center} testID="door-pay-landing" accessibilityLiveRegion="assertive">
        <ToneRing tone="caution" busy />
        <Text style={styles.endTitle}>Their payment went through</Text>
        <Text style={styles.muted}>
          This turns green in a moment. Don't charge them again and don't take cash.
        </Text>
      </View>
    );
  } else if (status === "expired" || status === "failed" || status === "cancelled") {
    const copy = doorPayHostEndCopy(status);
    body = (
      <View style={styles.center} testID={`door-pay-${status}`}>
        <ToneRing tone={doorPayHostTone(status)} />
        <Text style={styles.endTitle}>{copy.title}</Text>
        <Text style={styles.muted} testID="door-pay-end-body" accessibilityLiveRegion="polite">
          {doorPayHostEndBody(status, latePayment, row.provider)}
        </Text>
        <View style={styles.actions}>
          <Button
            label={copy.primary.label}
            onPress={() => handleAction(copy.primary.action)}
            variant="primary"
            size="lg"
            fullWidth
            loading={createCode.isPending}
          />
          {copy.secondary !== null ? (
            <Button
              label={copy.secondary.label}
              onPress={() => handleAction(copy.secondary!.action)}
              variant="secondary"
              size="md"
              fullWidth
            />
          ) : null}
        </View>
      </View>
    );
  } else {
    const paying = status === "opened";
    const secondsLeft = doorPayCountdownSeconds(row.expiresAt, nowMs);
    body = (
      <View style={styles.live} testID={`door-pay-${status}`}>
        {/* The guest sees what they're paying before they see a QR. */}
        <Text style={styles.big}>{amount}</Text>
        <Text style={styles.muted}>
          {[summarizeDoorPayLines(namedLines), routeEvent.event?.name].filter(Boolean).join(" · ")}
        </Text>
        {isDoorPayCode(row.code) ? (
          <Animated.View style={[styles.qrWrap, { opacity: qrOpacity }]} testID="door-pay-qr-wrap">
            <DoorPayQr url={makeDoorPayUrl(row.code)} size={QR_SIZE} testID="door-pay-qr" />
          </Animated.View>
        ) : null}
        <Text style={styles.codeText} accessibilityLabel={`Code ${row.code.split("").join(" ")}`}>
          {formatDoorPayCode(row.code)}
        </Text>
        {row.failureReason === "card_declined" ? (
          <Text style={styles.error} accessibilityRole="alert" testID="door-pay-declined">
            Guest's card was declined. They can try again.
          </Text>
        ) : null}
        {/* One pill instance whose props change, so the waiting -> paying
            change is announced on iOS (a remount would start at "paying"). */}
        <DoorStatusPill
          variant={paying ? "busy" : "waiting"}
          text={paying ? "Guest is paying…" : doorPayWaitingPillText(formatDoorPayCountdown(row.expiresAt, nowMs))}
          urgent={!paying && secondsLeft < DOOR_PAY_URGENT_SECONDS}
          accessibilityLabel={
            paying ? undefined : `Point your camera at the code. ${doorPayCountdownWords(secondsLeft)}`
          }
          stateLabel={paying ? "Guest is paying" : "Waiting for the guest to scan"}
          testID="door-pay-status-pill"
        />
        {paying ? (
          <Text style={styles.faint}>
            Opened on their phone {openedAgoLabel(row.openedAt, nowMs)}. Keep this screen open.
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Can't scan? Text them the link"
            onPress={() => setTextOpen(true)}
            variant="secondary"
            size="md"
            fullWidth
            testID="door-pay-text-link"
          />
          <Button
            label="Cancel sale"
            onPress={() => void handleCancel()}
            variant="ghost"
            size="md"
            fullWidth
            loading={cancelCode.isPending}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {chrome}
      {/* Scrolls on short phones and landscape so the code and every action
          stay reachable (#2211); flexGrow keeps the states centred otherwise. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {body}
        {actionError !== null ? (
          <Text style={styles.error} accessibilityRole="alert">
            {actionError}
          </Text>
        ) : null}
      </ScrollView>
      <TextLinkSheet
        visible={textOpen}
        codeId={codeId}
        currency={row?.currency ?? null}
        onClose={() => setTextOpen(false)}
      />
    </View>
  );
}

// ---- H6: text the link instead ------------------------------------------


interface TextLinkSheetProps {
  visible: boolean;
  codeId: string | null;
  currency: string | null;
  onClose: () => void;
}

const TextLinkSheet: React.FC<TextLinkSheetProps> = ({ visible, codeId, currency, onClose }) => {
  const phone = usePhoneEntry({ startCountries: [phoneStartCountryForCurrency(currency)] });
  const resetPhone = phone.reset;
  const sendLink = useTextDoorPayLink(codeId);
  const [sentLast4, setSentLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      resetPhone();
      setSentLast4(null);
      setError(null);
    }
  }, [resetPhone, visible]);

  const handleSend = useCallback(async (): Promise<void> => {
    if (phone.e164 === null) {
      setError("Enter their mobile number.");
      return;
    }
    setError(null);
    try {
      const result = await sendLink.mutateAsync({
        phone: phone.e164,
        phoneCountryIso: phone.countryIso,
      });
      const digits = phone.e164.replace(/\D/g, "");
      setSentLast4(result.last4.length > 0 ? result.last4 : digits.slice(-4));
    } catch (sendError) {
      setError(doorPayTextLinkErrorMessage(sendError));
    }
  }, [phone.countryIso, phone.e164, sendLink]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.sheetBody}>
        <Text style={styles.sheetTitle}>Text them the link</Text>
        <Text style={styles.muted}>They tap it and pay on their phone. This screen updates when they do.</Text>
        <Text style={styles.fieldLabel}>Their mobile</Text>
        <PhoneField
          entry={phone}
          accessibilityLabel="Their mobile number"
          disabled={sendLink.isPending}
          placeholder="Mobile number"
          testID="door-pay-text-phone"
        />
        {error !== null ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
        {sentLast4 !== null ? (
          <View style={[styles.card, styles.sentCard]}>
            <Text style={styles.kvValueOk}>Sent to the number ending {sentLast4}</Text>
          </View>
        ) : (
          <Button
            label="Send link"
            onPress={() => void handleSend()}
            variant="primary"
            size="lg"
            fullWidth
            loading={sendLink.isPending}
            disabled={phone.isEmpty}
          />
        )}
      </View>
    </Sheet>
  );
};

// ---- Door polish: end-state ring in the door tones -----------------------

const ToneRing: React.FC<{
  tone: "ok" | "neutral" | "caution" | "bad";
  icon?: React.ComponentProps<typeof Icon>["name"];
  busy?: boolean;
}> = ({ tone, icon, busy = false }) => {
  const style = doorToneStyle(tone);
  return (
    <View
      style={[
        styles.ring,
        { backgroundColor: style.ringFill },
        style.ringBorder !== null ? { borderWidth: 1, borderColor: style.ringBorder } : null,
      ]}
      testID={`door-pay-tone-${tone}`}
    >
      {busy ? (
        <ActivityIndicator color={style.iconColor} />
      ) : (
        <Icon name={icon ?? style.defaultIcon} size={style.iconSize + 2} color={style.iconColor} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "center",
  },
  chromeSlot: { width: 36 },
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  live: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  codeText: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 2,
    color: textTokens.secondary,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  big: {
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: textTokens.primary,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  muted: { fontSize: 14, lineHeight: 20, color: textTokens.secondary, textAlign: "center" },
  faint: { fontSize: 12, lineHeight: 17, color: textTokens.tertiary, textAlign: "center" },
  endTitle: { fontSize: 20, fontWeight: "700", color: textTokens.primary, textAlign: "center" },
  card: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.xs,
  },
  // DoorPayQr draws its own white card; this only carries the dim.
  qrWrap: { alignSelf: "center" },
  sentCard: { alignItems: "center" },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  kvKey: { fontSize: 13, color: textTokens.secondary },
  kvValue: { fontSize: 13, fontWeight: "600", color: textTokens.primary },
  kvValueOk: { fontSize: 13, fontWeight: "600", color: semantic.success },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  actions: { marginTop: "auto", gap: spacing.xs, paddingBottom: spacing.md },
  error: {
    fontSize: 13,
    lineHeight: 18,
    color: semantic.errorText,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  sheetTitle: { fontSize: 20, fontWeight: "700", color: textTokens.primary },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: textTokens.secondary },
});
