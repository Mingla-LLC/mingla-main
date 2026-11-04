/**
 * /event/[id]/door/pay/[codeId] — "Scan to pay" (issue #4271, design H3–H6).
 *
 * The host shows a door pay code; the guest points their phone camera at it
 * and pays on their own phone. The screen listens to the code's row live and
 * turns green the moment the provider confirms. States: open, opened (guest is
 * paying), paid, expired, cancelled, failed. Every end state says whether money
 * was taken, and recovery is one tap: a new code, or cash instead.
 *
 * Keep-awake and brightness: the Business app ships neither expo-keep-awake
 * nor expo-brightness as a dependency, and this build adds no native modules,
 * so the screen relies on the phone's own auto-lock settings.
 *
 * I-21: operator-side route (useAuth via the hooks below).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../../../../src/constants/designSystem";
import { DoorPayQr } from "../../../../../src/components/door/DoorPayQr";
import { doorSellAnotherHref } from "../../../../../src/components/door/doorTapDraft";
import { formatDoorPayCode, makeDoorPayUrl, isDoorPayCode } from "../../../../../src/components/door/doorPayUrl";
import {
  doorPayHostEndCopy,
  effectiveDoorPayStatus,
  formatDoorPayCountdown,
  openedAgoLabel,
  summarizeDoorPayLines,
  type DoorPayHostAction,
} from "../../../../../src/components/door/doorPayCodeState";
import { Button } from "../../../../../src/components/ui/Button";
import { IconChrome } from "../../../../../src/components/ui/IconChrome";
import { Icon } from "../../../../../src/components/ui/Icon";
import { PhoneField, usePhoneEntry } from "../../../../../src/components/ui/PhoneField";
import { Sheet } from "../../../../../src/components/ui/Sheet";
import {
  useCancelDoorPayCode,
  useCreateDoorPayCode,
  useCreatedDoorPayCode,
  useDoorPayCode,
  useTextDoorPayLink,
} from "../../../../../src/hooks/useEventDoorSales";
import { useManagedEventRoute } from "../../../../../src/hooks/useManagedEventRoute";
import { DoorPayCodeError } from "../../../../../src/services/doorPayCodeService";
import { formatCurrency } from "../../../../../src/utils/currency";
import { HapticFeedback } from "../../../../../src/utils/hapticFeedback";
import { phoneStartCountryForCurrency } from "../../../../../src/utils/phoneStartCountryForCurrency";

const QR_SIZE = 232;

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
  const status = row === null ? null : effectiveDoorPayStatus(row.status, row.expiresAt, nowMs);

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
  const sellAnother = useCallback(
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

  const handleNewCode = useCallback(async (): Promise<void> => {
    if (row === null || eventId === null) return;
    setActionError(null);
    try {
      const next = await createCode.mutateAsync({
        eventId,
        eventDateId: row.eventDateId,
        lines: row.lines,
      });
      router.replace(`/event/${eventId}/door/pay/${next.codeId}` as never);
    } catch (error) {
      // A dated ticket needs its date again: reopen the sheet with the tickets.
      if (error instanceof DoorPayCodeError && error.code === "ticket_not_valid_on_chosen_days") {
        sellAnother("pay_code");
        return;
      }
      setActionError("Couldn't make a new code. Nothing was charged. Try again.");
    }
  }, [createCode, eventId, router, row, sellAnother]);

  const handleAction = useCallback(
    (action: DoorPayHostAction): void => {
      if (action === "new_code") void handleNewCode();
      else if (action === "cash_instead") sellAnother("cash");
      else goToDoor("");
    },
    [goToDoor, handleNewCode, sellAnother],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    setActionError(null);
    try {
      await cancelCode.mutateAsync();
    } catch (error) {
      setActionError(
        error instanceof DoorPayCodeError && error.status === 409
          ? "This code was already paid, so it can't be cancelled."
          : "Couldn't cancel the code. Check your connection and try again.",
      );
    }
  }, [cancelCode]);

  const handleClose = useCallback((): void => {
    goToDoor("");
  }, [goToDoor]);

  // ---- Shells ----------------------------------------------------------

  const chrome = (
    <View style={styles.chromeRow}>
      <IconChrome icon="close" size={36} onPress={handleClose} accessibilityLabel="Close" />
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
        <View style={styles.okRing}>
          <Icon name="check" size={32} color={semantic.success} />
        </View>
        <Text style={styles.big}>Paid {amount}</Text>
        <Text style={styles.muted}>Buyer's phone</Text>
        <View style={styles.card}>
          <View style={styles.kv}>
            <Text style={styles.kvKey}>Tickets</Text>
            <Text style={styles.kvValue}>{summarizeDoorPayLines(namedLines)}</Text>
          </View>
          <View style={styles.kv}>
            <Text style={styles.kvKey}>Entry</Text>
            <Text style={styles.kvValueOk}>Checked in</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label="Sell another"
            onPress={() => sellAnother("pay_code")}
            variant="primary"
            size="lg"
            fullWidth
            testID="door-pay-sell-another"
          />
          <Button label="Done" onPress={handleClose} variant="ghost" size="md" fullWidth />
        </View>
      </View>
    );
  } else if (status === "expired" || status === "failed" || status === "cancelled") {
    const copy = doorPayHostEndCopy(status);
    body = (
      <View style={styles.center} testID={`door-pay-${status}`}>
        <View style={styles.badRing}>
          <Icon name={status === "expired" ? "clock" : "close"} size={28} color={semantic.errorText} />
        </View>
        <Text style={styles.endTitle}>{copy.title}</Text>
        <Text style={styles.muted}>{copy.body}</Text>
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
    body = (
      <View style={styles.live} testID={`door-pay-${status}`}>
        {isDoorPayCode(row.code) ? (
          <DoorPayQr url={makeDoorPayUrl(row.code)} size={QR_SIZE} testID="door-pay-qr" />
        ) : null}
        <Text style={styles.codeText} accessibilityLabel={`Code ${row.code.split("").join(" ")}`}>
          {formatDoorPayCode(row.code)}
        </Text>
        <Text style={styles.big}>{amount}</Text>
        <Text style={styles.muted}>
          {[summarizeDoorPayLines(namedLines), routeEvent.event?.name].filter(Boolean).join(" · ")}
        </Text>
        {paying ? (
          <View style={[styles.card, styles.payingCard]} accessibilityLiveRegion="polite">
            <Text style={styles.payingTitle}>Guest is paying…</Text>
            <Text style={styles.faint}>
              Opened on their phone {openedAgoLabel(row.openedAt, nowMs)}. Keep this screen open.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.muted}>Ask them to point their phone camera at the code.</Text>
            <Text style={styles.faint}>Code expires in {formatDoorPayCountdown(row.expiresAt, nowMs)}</Text>
          </>
        )}
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
      {body}
      {actionError !== null ? (
        <Text style={styles.error} accessibilityRole="alert">
          {actionError}
        </Text>
      ) : null}
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
    } catch {
      setError("Couldn't send the link. Check the number and try again.");
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

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
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
  payingCard: { borderColor: accent.border, alignItems: "center" },
  payingTitle: { fontSize: 15, fontWeight: "700", color: textTokens.primary },
  sentCard: { alignItems: "center" },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  kvKey: { fontSize: 13, color: textTokens.secondary },
  kvValue: { fontSize: 13, fontWeight: "600", color: textTokens.primary },
  kvValueOk: { fontSize: 13, fontWeight: "600", color: semantic.success },
  okRing: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.successTint,
  },
  badRing: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239, 68, 68, 0.16)",
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
