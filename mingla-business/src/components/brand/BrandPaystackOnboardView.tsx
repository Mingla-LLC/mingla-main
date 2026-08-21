/**
 * BrandPaystackOnboardView — META-ORCH-1076 Phase 2 brand payout onboarding
 * for Nigeria (Paystack). The Paystack analog of BrandOnboardView.
 *
 * Paystack has no embedded KYC component — this is a Mingla-owned bank-details
 * form: pick bank → enter 10-digit NUBAN → verify holder name → connect. On
 * success the brand gets a paystack_subaccount_code and flips onto the Paystack
 * rail, so the (already-shipped) checkout deferred-split starts routing money.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { PressableStateCallbackType, ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// ORCH-0892: KeyboardAvoidingView must come from react-native-keyboard-controller
// (frame-perfect native animation; drop-in for the RN one).
import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView";

import {
  accent,
  bpCompact,
  bpRegular,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import {
  useBrandBanks,
  useCreatePaystackRecipient,
  useCreatePaystackSubaccount,
  useResolvePaystackAccount,
  useUpdatePaystackRecipient,
  useUpdatePaystackSubaccount,
} from "../../hooks/useBrandPaystack";
import { useAuth } from "../../context/AuthContext";
import { reportNonFatal } from "../../diagnostics/reportNonFatal";
import { PaystackBankListError } from "../../services/brandPaystackService";
// #1850 — the bank picker's lift is budgeted against the DERIVED Done-bar cost.
import { DONE_BAR_OCCUPIED } from "../../wrappers/SmartScrollView";
// #1890 — whether the Done bar is actually IN this raw <Modal>'s own native
// window, from #1841's measurement rather than from assumption.
import { DONE_BAR_PRESENT_IN_RAW_MODAL } from "../../wrappers/keyboardClearance";

interface Props {
  brandId: string;
  brandName: string;
  /** "create" = first-time onboarding; "update" = change the settlement bank. */
  mode?: "create" | "update";
  /** Fired after the subaccount is created/updated. */
  onConnected?: () => void;
  /** Optional cancel affordance (shown in update mode). */
  onCancel?: () => void;
}

const ACCOUNT_LEN = 10;
const BANK_PICKER_MAX_WIDTH = 640;
const BANK_PICKER_MIN_HEIGHT = 360;
const BANK_PICKER_MAX_HEIGHT = 720;
const BANK_PICKER_ROW_MIN_HEIGHT = 56;
const BANK_PICKER_SCRIM = "rgba(0, 0, 0, 0.50)";

export const BrandPaystackOnboardView: React.FC<Props> = ({
  brandId,
  brandName,
  mode = "create",
  onConnected,
  onCancel,
}) => {
  const isUpdate = mode === "update";
  const { isAuthReady } = useAuth();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const banksQuery = useBrandBanks();
  const resolveMutation = useResolvePaystackAccount();
  const createMutation = useCreatePaystackSubaccount();
  const updateMutation = useUpdatePaystackSubaccount();
  const submitMutation = isUpdate ? updateMutation : createMutation;
  const createRecipientMutation = useCreatePaystackRecipient();
  const updateRecipientMutation = useUpdatePaystackRecipient();
  const recipientMutation = isUpdate
    ? updateRecipientMutation
    : createRecipientMutation;

  const [pickerOpen, setPickerOpen] = useState(false);
  // #1834 D2 — on Android an RN <Modal> is a separate Dialog window. At the
  // moment the sheet's children mount that window has not yet been shown, so
  // RN's mount-time autoFocus fires against a window that cannot take focus:
  // the field lights up but no IME appears and the user has to tap the
  // already-focused input a second time. `onShow` is a Modal lifecycle prop
  // (NOT a keyboard API — I-PROPOSED-KEYBOARD-LIBRARY-ONLY is untouched); it
  // fires once the dialog is actually on screen, and flipping this flag
  // changes the Input's `key`, remounting it once so autoFocus re-fires
  // against a focusable window.
  const [pickerShown, setPickerShown] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickerOpenerRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const lastAnnouncementRef = useRef<string | null>(null);
  const lastReportedBankErrorRef = useRef<unknown>(null);
  const bankRetryInFlightRef = useRef(false);

  // #1834 D2 — iOS is the constant `true`, so the Input's key never changes,
  // no remount ever happens there, and today's immediate mount-time focus is
  // bit-identical. Gating iOS on onShow would delay its keyboard by the sheet
  // slide animation, regressing a cell that already passes.
  const searchAutoFocus = Platform.OS === "android" ? pickerShown : true;
  /** Every close path must disarm, or the next open remounts nothing. */
  const closePicker = useCallback((): void => {
    setPickerOpen(false);
    setPickerShown(false);
    if (Platform.OS === "web") {
      setTimeout(() => pickerOpenerRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (
      !pickerOpen ||
      Platform.OS !== "web" ||
      typeof document === "undefined"
    ) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePicker();
    };
    document.addEventListener("keydown", onKeyDown);
    return (): void => document.removeEventListener("keydown", onKeyDown);
  }, [closePicker, pickerOpen]);

  // Paystack's /bank list can return multiple entries that share a `code`
  // (same settlement code listed under different slugs). Dedupe by code so the
  // picker shows each bank once and React keys stay unique.
  const banks = useMemo(() => {
    const raw = banksQuery.data ?? [];
    const seen = new Set<string>();
    const out: typeof raw = [];
    for (const b of raw) {
      if (seen.has(b.code)) continue;
      seen.add(b.code);
      out.push(b);
    }
    return out;
  }, [banksQuery.data]);
  const filteredBanks = useMemo(() => {
    const q = bankSearch.trim().toLowerCase();
    if (q.length === 0) return banks;
    return banks.filter((b) => b.name.toLowerCase().includes(q));
  }, [banks, bankSearch]);
  const trimmedBankSearch = bankSearch.trim();
  const hasBanks = banks.length > 0;
  const authPending = !isAuthReady && !hasBanks;
  const terminalBankError = banksQuery.isError && !hasBanks;
  const providerEmpty = banksQuery.isSuccess && !hasBanks && !terminalBankError;
  const initialBankLoading = isAuthReady && banksQuery.isLoading && !hasBanks;
  const backgroundRefreshError = banksQuery.isError && hasBanks;
  const filteredEmpty =
    hasBanks && trimmedBankSearch.length > 0 && filteredBanks.length === 0;
  const searchInteractive =
    !authPending && !terminalBankError && !providerEmpty;
  const retryingBanks = banksQuery.isFetching === true;

  const handleRetryBanks = useCallback((): void => {
    if (retryingBanks || bankRetryInFlightRef.current) return;
    bankRetryInFlightRef.current = true;
    void banksQuery.refetch().finally(() => {
      // Ref-only cleanup is safe after unmount and unlocks the next deliberate
      // retry without introducing a second visual busy-state owner.
      bankRetryInFlightRef.current = false;
    });
  }, [banksQuery.refetch, retryingBanks]);

  const sheetDynamicStyle = useMemo<ViewStyle>(() => {
    const regular = windowWidth >= bpRegular;
    return {
      height: regular
        ? Math.min(
            BANK_PICKER_MAX_HEIGHT,
            Math.max(BANK_PICKER_MIN_HEIGHT, windowHeight * 0.72),
          )
        : windowHeight * 0.64,
      maxWidth: regular ? BANK_PICKER_MAX_WIDTH : undefined,
      paddingHorizontal: windowWidth < bpCompact ? spacing.md : spacing.lg,
      paddingBottom: Math.max(safeArea.bottom, spacing.md),
    };
  }, [safeArea.bottom, windowHeight, windowWidth]);

  const bankRowStyle = useCallback(
    (
      state: PressableStateCallbackType & {
        hovered?: boolean;
        focused?: boolean;
      },
    ): ViewStyle[] => [
      styles.bankRow,
      state.pressed || state.hovered === true
        ? styles.bankRowActive
        : styles.bankRowIdle,
      Platform.OS === "web" && state.focused === true
        ? styles.bankRowFocused
        : styles.bankRowUnfocused,
    ],
    [],
  );

  useEffect(() => {
    if (!banksQuery.isError || banksQuery.error == null) return;
    const cycle = banksQuery.errorUpdatedAt ?? banksQuery.error;
    if (lastReportedBankErrorRef.current === cycle) return;
    lastReportedBankErrorRef.current = cycle;
    const classified =
      banksQuery.error instanceof PaystackBankListError
        ? banksQuery.error
        : new PaystackBankListError("unknown", null);
    reportNonFatal(
      "paystackBankList",
      new Error(`paystack_bank_list_${classified.code}`),
      {
        feature: "paystack_bank_list",
        errorClass: classified.code,
        status: classified.status,
        platform: Platform.OS,
      },
      ["paystack_bank_list", classified.code, String(classified.status)],
    );
  }, [banksQuery.error, banksQuery.errorUpdatedAt, banksQuery.isError]);

  const bankStatusAnnouncement = authPending
    ? "Finishing sign-in…"
    : initialBankLoading
      ? "Loading banks…"
      : terminalBankError
        ? "Couldn't load banks. Banks are unavailable right now."
        : providerEmpty
          ? "No banks are available right now."
          : backgroundRefreshError
            ? "Couldn't refresh banks."
            : filteredEmpty
              ? `No banks match “${trimmedBankSearch}”.`
              : hasBanks
                ? "Banks loaded."
                : null;

  useEffect(() => {
    if (
      !pickerOpen ||
      Platform.OS !== "ios" ||
      bankStatusAnnouncement === null ||
      lastAnnouncementRef.current === bankStatusAnnouncement
    ) {
      return;
    }
    lastAnnouncementRef.current = bankStatusAnnouncement;
    AccessibilityInfo.announceForAccessibility(bankStatusAnnouncement);
  }, [bankStatusAnnouncement, pickerOpen]);

  const accountComplete = accountNumber.length === ACCOUNT_LEN;
  const canVerify =
    bankCode !== null && accountComplete && !resolveMutation.isPending;
  const canConnect =
    resolvedName !== null &&
    !submitMutation.isPending &&
    !recipientMutation.isPending;

  // Re-entering details invalidates a prior verification.
  const onAccountChange = (next: string): void => {
    const digits = next.replace(/\D/g, "").slice(0, ACCOUNT_LEN);
    setAccountNumber(digits);
    if (resolvedName !== null) setResolvedName(null);
    setError(null);
  };

  const onPickBank = (code: string, name: string): void => {
    setBankCode(code);
    setBankName(name);
    closePicker();
    setBankSearch("");
    if (resolvedName !== null) setResolvedName(null);
    setError(null);
  };

  const handleVerify = async (): Promise<void> => {
    setError(null);
    try {
      const res = await resolveMutation.mutateAsync({
        brandId,
        accountNumber,
        bankCode: bankCode as string,
      });
      setResolvedName(res.account_name);
    } catch {
      setResolvedName(null);
      setError(
        "We couldn't verify that account. Check the number and bank, then try again.",
      );
    }
  };

  const handleConnect = async (): Promise<void> => {
    setError(null);
    try {
      const input = {
        brandId,
        accountNumber,
        bankCode: bankCode as string,
      };
      // Create the RCP_ first. If the legacy ACCT_ write then fails, retrying is
      // idempotent and today's at-charge split remains unchanged.
      await recipientMutation.mutateAsync(input);
      await submitMutation.mutateAsync(input);
      onConnected?.();
    } catch {
      setError(
        isUpdate
          ? "We couldn't update this bank account. Please try again in a moment."
          : "We couldn't connect this bank account. Please try again in a moment.",
      );
    }
  };

  return (
    <GlassCard variant="elevated" padding={spacing.lg}>
      {onCancel != null && !isUpdate ? (
        <View style={styles.backRow}>
          <Button
            label="‹ Choose a different country"
            variant="ghost"
            size="sm"
            onPress={onCancel}
          />
        </View>
      ) : null}
      <Text style={styles.title}>
        {isUpdate ? "Change payout bank" : "Get paid in Nigeria"}
      </Text>
      <Text style={styles.subtitle}>
        {isUpdate
          ? "Enter the new bank account that should receive your payouts."
          : "Connect your bank account to receive payouts. Ticket sales are released to this account 3 days after each event date ends and typically arrive within 1–2 business days."}
      </Text>

      {/* Bank picker */}
      <Text style={styles.label}>Bank</Text>
      <Pressable
        ref={pickerOpenerRef}
        accessibilityRole="button"
        accessibilityLabel="Choose your bank"
        onPress={() => setPickerOpen(true)}
        style={styles.pickerField}
      >
        <Text style={bankName ? styles.pickerValue : styles.pickerPlaceholder}>
          {bankName ?? "Choose your bank"}
        </Text>
      </Pressable>

      {/* Account number */}
      <Text style={styles.label}>Account number</Text>
      <Input
        variant="number"
        value={accountNumber}
        onChangeText={onAccountChange}
        placeholder="10-digit account number"
        maxLength={ACCOUNT_LEN}
        accessibilityLabel="Bank account number"
      />

      {/* Verified name confirmation */}
      {resolvedName !== null ? (
        <View style={styles.verifiedRow}>
          <Text style={styles.verifiedLabel}>Account name</Text>
          <Text style={styles.verifiedName}>{resolvedName}</Text>
          <Text style={styles.verifiedHint}>
            Make sure this is correct — payouts go to this account.
          </Text>
        </View>
      ) : null}

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      {/* Actions */}
      <View style={styles.actions}>
        {resolvedName === null ? (
          <Button
            label={resolveMutation.isPending ? "Verifying…" : "Verify account"}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canVerify}
            loading={resolveMutation.isPending}
            onPress={handleVerify}
          />
        ) : (
          <Button
            label={
              submitMutation.isPending || recipientMutation.isPending
                ? isUpdate
                  ? "Updating…"
                  : "Connecting…"
                : isUpdate
                  ? "Update bank account"
                  : "Connect bank & get paid"
            }
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canConnect}
            loading={submitMutation.isPending}
            onPress={handleConnect}
          />
        )}
        {onCancel != null && isUpdate ? (
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              fullWidth
              onPress={onCancel}
            />
          </View>
        ) : null}
      </View>

      {/* Bank picker overlay */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType={reduceMotion ? "none" : "slide"}
        onRequestClose={closePicker}
        // #1834 D2 — fires once the Android Dialog window is actually on
        // screen and focusable; flipping this remounts the search Input via
        // its key so RN's mount-time autoFocus raises the IME on the first
        // open (no second tap). No-op on iOS: searchAutoFocus is constant true
        // there, so the key never changes.
        onShow={() => setPickerShown(true)}
      >
        {/* #1850 — this offset was a literal 42, and #1850's investigation argued
            it was clearing a bar that could not render inside a Modal's own native
            window at all. #1841's tester SETTLED that by measurement and the
            argument was wrong on iOS: the Done bar renders in the ROOT window and
            is visible THROUGH this transparent Modal (396.0pt measured against
            396.5pt predicted), so the search field genuinely does need clearing
            here. On Android the bar is genuinely absent inside the Modal — and the
            offset is already inert there, because `behavior` is undefined on
            Android and KeyboardAvoidingView ignores the offset without one. So the
            offset applies exactly where the bar is: iOS. The number was still
            wrong. 42 is KEYBOARD_TOOLBAR_HEIGHT (the bar's own height);
            DONE_BAR_OCCUPIED is what it costs above the keyboard — 53 on iOS 26+,
            because the library floats it 11pt clear of the rounded corners.

            #1890 — the occluder is now stated per WINDOW rather than assumed.
            `DONE_BAR_PRESENT_IN_RAW_MODAL` carries #1841's measurement (iOS: the
            bar belongs to the system keyboard window and composites through this
            transparent Modal; Android: absent) instead of leaving the
            bar-is-here assumption implicit in a bare constant. On Android this
            resolves to 0, which is also what the platform already did with
            `behavior` undefined — the difference is that the code now SAYS so,
            so the next reader cannot mistake an inert 42 for a real budget. */}
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={
            DONE_BAR_PRESENT_IN_RAW_MODAL ? DONE_BAR_OCCUPIED : 0
          }
        >
          <Pressable
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel="Close bank picker"
            onPress={closePicker}
          />
          <View
            style={[styles.sheet, sheetDynamicStyle]}
            accessibilityViewIsModal
            accessibilityLabel="Choose your bank"
            role="dialog"
          >
            <Text style={styles.sheetTitle}>Choose your bank</Text>
            <Input
              // #1834 D2 — Input is a plain React.FC, not forwardRef, so there
              // is no ref-based .focus() available and converting the shared
              // primitive is out of scope. The key is what re-arms autoFocus:
              // on Android it changes exactly once per open (false -> true on
              // the Modal's onShow), remounting the field against a focusable
              // window; on iOS it is constant, so nothing remounts.
              key={`bank-search-${searchAutoFocus}-${searchInteractive}`}
              variant="search"
              value={bankSearch}
              onChangeText={setBankSearch}
              placeholder="Search banks"
              placeholderTextColor={textTokens.tertiary}
              clearable
              disabled={!searchInteractive}
              tabIndex={
                Platform.OS === "web" && !searchInteractive ? -1 : undefined
              }
              autoFocus={searchAutoFocus && searchInteractive}
              accessibilityLabel="Search banks"
            />
            {authPending || initialBankLoading ? (
              <View style={styles.noDataState} accessibilityLiveRegion="polite">
                <Spinner size={24} color={accent.warm} />
                <Text style={styles.statusText}>
                  {authPending ? "Finishing sign-in…" : "Loading banks…"}
                </Text>
              </View>
            ) : terminalBankError ? (
              <View
                style={styles.noDataState}
                accessibilityRole="alert"
                aria-live="assertive"
              >
                <Text style={styles.errorTitle}>Couldn't load banks</Text>
                <Text style={styles.statusText}>
                  Banks are unavailable right now.
                </Text>
                <Button
                  label={retryingBanks ? "Trying again…" : "Try again"}
                  variant="ghost"
                  size="md"
                  loading={retryingBanks}
                  disabled={retryingBanks}
                  accessibilityLabel="Try loading banks again"
                  onPress={handleRetryBanks}
                  style={styles.retryButton}
                />
              </View>
            ) : providerEmpty ? (
              <View style={styles.noDataState} accessibilityLiveRegion="polite">
                <Text style={styles.statusText}>
                  No banks are available right now.
                </Text>
                <Button
                  label={retryingBanks ? "Trying again…" : "Try again"}
                  variant="ghost"
                  size="md"
                  loading={retryingBanks}
                  disabled={retryingBanks}
                  accessibilityLabel="Try loading banks again"
                  onPress={handleRetryBanks}
                  style={styles.retryButton}
                />
              </View>
            ) : (
              <View style={styles.catalogueRegion}>
                {backgroundRefreshError ? (
                  <View
                    style={styles.refreshNotice}
                    accessibilityLiveRegion="polite"
                  >
                    <Text style={styles.refreshNoticeText}>
                      Couldn't refresh banks.
                    </Text>
                    <Button
                      label={retryingBanks ? "Trying again…" : "Try again"}
                      variant="ghost"
                      size="md"
                      loading={retryingBanks}
                      disabled={retryingBanks}
                      accessibilityLabel="Try loading banks again"
                      onPress={handleRetryBanks}
                    />
                  </View>
                ) : null}
                <ScrollView
                  style={styles.bankList}
                  // #1834 — no Done bar in this raw Modal window (nothing renders
                  // <KeyboardToolbarRoot/> here, and the app-root provider does
                  // not propagate into an RN Modal window), so there is nothing
                  // to pad for. The ORCH-1165 Android 42dp compensator that used
                  // to sit here was padding for a bar that is not there.
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {filteredBanks.map((b, i) => (
                    <Pressable
                      key={`${b.code}-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={b.name}
                      accessibilityHint="Select this bank"
                      onPress={() => onPickBank(b.code, b.name)}
                      style={bankRowStyle}
                    >
                      <Text style={styles.bankRowText}>{b.name}</Text>
                    </Pressable>
                  ))}
                  {filteredEmpty ? (
                    <Text
                      style={styles.bankEmpty}
                      accessibilityLiveRegion="polite"
                    >
                      No banks match “{trimmedBankSearch}”.
                    </Text>
                  ) : null}
                </ScrollView>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  backRow: {
    alignItems: "flex-start",
    marginBottom: spacing.xs,
    marginLeft: -spacing.xs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  pickerField: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  pickerValue: { ...typography.body, color: textTokens.primary },
  pickerPlaceholder: { ...typography.body, color: textTokens.quaternary },
  verifiedRow: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  verifiedLabel: { ...typography.caption, color: textTokens.tertiary },
  verifiedName: {
    ...typography.bodyLg,
    color: textTokens.primary,
    marginTop: spacing.xxs,
  },
  verifiedHint: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: semantic.error,
    marginTop: spacing.md,
  },
  actions: { marginTop: spacing.lg },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { flex: 1, backgroundColor: BANK_PICKER_SCRIM },
  sheet: {
    alignSelf: "center",
    width: "100%",
    paddingTop: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: canvas.profile,
    overflow: "hidden",
  },
  sheetTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  noDataState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  statusText: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  errorTitle: {
    ...typography.bodyLg,
    color: semantic.error,
    textAlign: "center",
  },
  retryButton: {
    marginTop: spacing.md,
  },
  catalogueRegion: {
    flex: 1,
    marginTop: spacing.md,
  },
  refreshNotice: {
    alignItems: "center",
    backgroundColor: semantic.errorTint,
    borderRadius: radius.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  refreshNoticeText: {
    ...typography.bodySm,
    color: textTokens.primary,
    flexShrink: 1,
  },
  bankList: { flex: 1 },
  bankRow: {
    minHeight: BANK_PICKER_ROW_MIN_HEIGHT,
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  bankRowIdle: { backgroundColor: "transparent" },
  bankRowActive: { backgroundColor: glass.tint.profileBase },
  bankRowFocused: {
    outlineColor: accent.warm,
    outlineOffset: -2,
    outlineStyle: "solid",
    outlineWidth: 2,
  },
  bankRowUnfocused: { outlineWidth: 0 },
  bankRowText: { ...typography.body, color: textTokens.primary },
  bankEmpty: {
    ...typography.body,
    color: textTokens.tertiary,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    textAlign: "center",
  },
});
