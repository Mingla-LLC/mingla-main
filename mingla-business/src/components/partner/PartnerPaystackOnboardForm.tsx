/**
 * PartnerPaystackOnboardForm — ORCH-1331 [partner Paystack payout rail].
 *
 * The partner-scoped twin of BrandPaystackOnboardView (same interaction
 * contract, same bank-picker sheet), re-skinned to the earnings-screen card
 * system per DESIGN_ORCH-1331_PARTNER_PAYSTACK_UI.md §3: GlassCard
 * variant="elevated" radius="md", dot+eyebrow state continuity, ONE primary
 * CTA whose label swaps by state (layout never shifts).
 *
 * Flow: pick bank (modal sheet, search, dedupe-by-code, Android 42dp Done-bar
 * clearance) → 10-digit NUBAN → "Verify account" → resolved-name confirm →
 * "Connect bank & get paid". Editing any digit or re-picking the bank clears
 * the verification. Privacy: only the last 4 digits persist
 * (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED) — the caption says exactly that.
 *
 * BINDING (design §3.2 state 8): after a successful connect the CTA HOLDS its
 * loading spinner (isPending || isSuccess) until the parent's
 * usePartnerPaystackStatus refetch flips `connected` and this form unmounts —
 * no flash back to an enabled form, no flash of the picker state.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892: KeyboardAvoidingView must come from react-native-keyboard-controller
// (frame-perfect native animation; drop-in for the RN one).
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  accent,
  durations,
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
// ORCH-0892 library primitive (web stub → false; native → useKeyboardState).
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import {
  useCreatePartnerPaystackRecipient,
  usePartnerPaystackBanks,
  useResolvePartnerPaystackAccount,
} from "../../hooks/usePartnerPaystack";

interface Props {
  /** Fired once the recipient is created (parent haptic; the card swap itself
   * is driven by the status refetch). */
  onConnected?: () => void;
  /** Renders the "‹ Choose a different country" ghost back button. */
  onCancel?: () => void;
}

const ACCOUNT_LEN = 10;

// Error taxonomy → user strings (design §7 E1–E5).
const E1_UNRESOLVED =
  "We couldn't verify that account. Check the number and bank, then try again.";
const E2_RESOLVE_NETWORK =
  "We couldn't reach the bank check right now. Give it a second and try again.";
const E3_STRIPE_CONNECTED =
  "You already have a Stripe payout account. Disconnect it first, then connect your Nigerian bank.";
const E4_CONNECT_GENERIC =
  "We couldn't connect this bank account. Please try again in a moment.";
const E5_BANKS_UNAVAILABLE =
  "Couldn't load the bank list. Check your connection and try again.";

/** Confirm-name block with the design §6 entrance (opacity 0→1, translateY
 * 6→0, 200ms ease-out; renders instantly under reduced motion). */
function ConfirmNameBlock({ name }: { name: string }): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, {
      duration: durations.normal,
      // easings.out token (cubic-bezier(0.33, 1, 0.68, 1)) — reanimated needs
      // the function form of the same curve.
      easing: Easing.bezier(0.33, 1, 0.68, 1),
    });
  }, [progress, reducedMotion]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 6 }],
  }));
  return (
    <Animated.View
      style={[styles.verifiedRow, animatedStyle]}
      accessibilityLiveRegion="polite"
      testID="partner-paystack-confirm-name"
    >
      <Text style={styles.verifiedLabel}>Account name</Text>
      <Text style={styles.verifiedName}>{name}</Text>
      <Text style={styles.verifiedHint}>
        Make sure this is you — payouts go to this account.
      </Text>
    </Animated.View>
  );
}

export const PartnerPaystackOnboardForm: React.FC<Props> = ({
  onConnected,
  onCancel,
}) => {
  const banksQuery = usePartnerPaystackBanks();
  const resolveMutation = useResolvePartnerPaystackAccount();
  const submitMutation = useCreatePartnerPaystackRecipient();

  const [pickerOpen, setPickerOpen] = useState(false);
  // ORCH-1165 DISC-1165-T3 pattern (verbatim from BrandPaystackOnboardView):
  // on Android, pad the bank LIST by the 42dp Done-bar clearance while the
  // keyboard is open — keyed on keyboard-open so there is no permanent gap.
  const keyboardVisible = useKeyboardIsVisible();
  const androidKbOpen = Platform.OS === "android" && keyboardVisible;
  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Paystack's /bank list can return multiple entries sharing a `code` —
  // dedupe so the picker shows each bank once and React keys stay unique.
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

  const accountComplete = accountNumber.length === ACCOUNT_LEN;
  const canVerify = bankCode !== null && accountComplete &&
    !resolveMutation.isPending;
  // BINDING (design §3.2 state 8): loading holds through isSuccess until the
  // parent's status flip unmounts this form.
  const connecting = submitMutation.isPending || submitMutation.isSuccess;
  const canConnect = resolvedName !== null && !connecting;

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
    setPickerOpen(false);
    setBankSearch("");
    if (resolvedName !== null) setResolvedName(null);
    setError(null);
  };

  const handleVerify = async (): Promise<void> => {
    setError(null);
    try {
      const res = await resolveMutation.mutateAsync({
        accountNumber,
        bankCode: bankCode as string,
      });
      setResolvedName(res.account_name);
    } catch (e) {
      setResolvedName(null);
      const message = e instanceof Error ? e.message : String(e);
      setError(message.includes("account_unresolved") ? E1_UNRESOLVED : E2_RESOLVE_NETWORK);
    }
  };

  const handleConnect = async (): Promise<void> => {
    setError(null);
    try {
      await submitMutation.mutateAsync({
        accountNumber,
        bankCode: bankCode as string,
        bankName: bankName ?? "",
      });
      onConnected?.();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Confirm-name block is RETAINED (the resolution is still valid).
      setError(
        message.includes("stripe_already_connected") ? E3_STRIPE_CONNECTED : E4_CONNECT_GENERIC,
      );
    }
  };

  const banksLoading = banksQuery.isLoading;
  const banksError = banksQuery.isError;

  return (
    <GlassCard
      variant="elevated"
      radius="md"
      padding={spacing.lg}
      testID="partner-paystack-form"
    >
      {onCancel != null ? (
        <View style={styles.backRow}>
          <Button
            label="‹ Choose a different country"
            variant="ghost"
            size="sm"
            onPress={onCancel}
          />
        </View>
      ) : null}

      {/* Status eyebrow — state-system continuity with every StatusBlock card. */}
      <View style={styles.statusIndicatorRow}>
        <View style={styles.statusDotMuted} />
        <Text style={styles.statusLabelMuted}>NOT CONNECTED</Text>
      </View>

      <Text style={styles.title}>Get paid in Nigeria</Text>
      <Text style={styles.subtitle}>
        Connect your bank account to receive your partner earnings. Splits are
        paid in NGN directly to this account.
      </Text>
      <Text style={styles.ngnNote}>
        Paystack will settle you in NGN. You{"'"}ll only be able to partner with
        brands that sell in NGN.
      </Text>

      {/* Bank picker field */}
      <View style={styles.bankLabelRow}>
        <Text style={styles.labelInRow}>Bank</Text>
        {banksLoading ? <Spinner size={24} color={accent.warm} /> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bankName
          ? `Bank: ${bankName}, tap to change`
          : "Choose your bank"}
        onPress={() => setPickerOpen(true)}
        disabled={banksLoading}
        style={[styles.pickerField, banksLoading ? styles.pickerFieldDisabled : null]}
        testID="partner-paystack-bank-field"
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
        editable={!resolveMutation.isPending && !connecting}
        returnKeyType="done"
        accessibilityLabel="Bank account number"
        testID="partner-paystack-account-input"
      />
      <Text style={styles.privacyCaption}>
        We keep only the last 4 digits of your account number.
      </Text>

      {/* Verified name confirmation */}
      {resolvedName !== null ? <ConfirmNameBlock name={resolvedName} /> : null}

      {/* Inline error (banks / resolve / connect) */}
      {banksError ? (
        <>
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {E5_BANKS_UNAVAILABLE}
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <Button
              label="Retry"
              variant="secondary"
              size="md"
              onPress={() => {
                void banksQuery.refetch();
              }}
            />
          </View>
        </>
      ) : null}
      {error !== null ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {/* ONE primary CTA — label/handler swap by state; layout never shifts. */}
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
            testID="partner-paystack-verify-cta"
          />
        ) : (
          <Button
            label={connecting ? "Connecting…" : "Connect bank & get paid"}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canConnect}
            loading={connecting}
            onPress={handleConnect}
            testID="partner-paystack-connect-cta"
          />
        )}
      </View>

      {/* Bank picker overlay — verbatim BrandPaystackOnboardView pattern
          (ORCH-1165 DISC-1165-T3 keyboard hardening). */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={42}
        >
          <Pressable
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel="Close bank picker"
            onPress={() => setPickerOpen(false)}
          />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose your bank</Text>
            <Input
              variant="search"
              value={bankSearch}
              onChangeText={setBankSearch}
              placeholder="Search banks"
              clearable
              autoFocus
              accessibilityLabel="Search banks"
            />
            {banksQuery.isLoading ? (
              <ActivityIndicator
                color={accent.warm}
                style={{ marginTop: spacing.lg }}
              />
            ) : (
              <ScrollView
                style={styles.bankList}
                // Android-only 42dp Done-bar clearance, keyed on keyboard-open
                // (no permanent gap). iOS clears via the KAV padding behavior.
                contentContainerStyle={androidKbOpen
                  ? styles.bankListKbPad
                  : undefined}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {filteredBanks.map((b, i) => (
                  <Pressable
                    key={`${b.code}-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={b.name}
                    onPress={() => onPickBank(b.code, b.name)}
                    style={styles.bankRow}
                  >
                    <Text style={styles.bankRowText}>{b.name}</Text>
                  </Pressable>
                ))}
                {filteredBanks.length === 0 ? (
                  <Text style={styles.bankEmpty}>
                    No banks match “{bankSearch}”.
                  </Text>
                ) : null}
              </ScrollView>
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
  statusIndicatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDotMuted: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: textTokens.tertiary,
  },
  statusLabelMuted: { ...typography.labelCap, color: textTokens.tertiary },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  ngnNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  bankLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  // The bank label's margins live on bankLabelRow (the spinner shares the row).
  labelInRow: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  // Field chrome literals = the kit Input field chrome (Input.tsx:409-410).
  pickerField: {
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  pickerFieldDisabled: { opacity: 0.5 },
  pickerValue: { ...typography.body, color: textTokens.primary },
  pickerPlaceholder: { ...typography.body, color: textTokens.quaternary },
  privacyCaption: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
  },
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
  backdrop: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  sheet: {
    height: "64%",
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    // Opaque fill — satisfies ANDROID_GLASS_USES_OPAQUE_FALLBACK by construction.
    backgroundColor: "#14110f",
  },
  sheetTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  bankList: { flex: 1, marginTop: spacing.md },
  // ORCH-1165 DISC-1165-T3 — Android Done-bar clearance.
  bankListKbPad: { paddingBottom: 42 },
  bankRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  bankRowText: { ...typography.body, color: textTokens.primary },
  bankEmpty: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.lg,
    textAlign: "center",
  },
});

export default PartnerPaystackOnboardForm;
