/**
 * BrandPaystackOnboardView — META-ORCH-1076 Phase 2 brand payout onboarding
 * for Nigeria (Paystack). The Paystack analog of BrandOnboardView.
 *
 * Paystack has no embedded KYC component — this is a Mingla-owned bank-details
 * form: pick bank → enter 10-digit NUBAN → verify holder name → connect. On
 * success the brand gets a paystack_subaccount_code and flips onto the Paystack
 * rail, so the (already-shipped) checkout deferred-split starts routing money.
 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import {
  useBrandBanks,
  useCreatePaystackSubaccount,
  useResolvePaystackAccount,
  useUpdatePaystackSubaccount,
} from "../../hooks/useBrandPaystack";

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

export const BrandPaystackOnboardView: React.FC<Props> = ({
  brandId,
  brandName,
  mode = "create",
  onConnected,
  onCancel,
}) => {
  const isUpdate = mode === "update";
  const banksQuery = useBrandBanks();
  const resolveMutation = useResolvePaystackAccount();
  const createMutation = useCreatePaystackSubaccount();
  const updateMutation = useUpdatePaystackSubaccount();
  const submitMutation = isUpdate ? updateMutation : createMutation;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [bankCode, setBankCode] = useState<string | null>(null);
  const [bankName, setBankName] = useState<string | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const accountComplete = accountNumber.length === ACCOUNT_LEN;
  const canVerify = bankCode !== null && accountComplete && !resolveMutation.isPending;
  const canConnect = resolvedName !== null && !submitMutation.isPending;

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
        brandId,
        accountNumber,
        bankCode: bankCode as string,
      });
      setResolvedName(res.account_name);
    } catch (e) {
      setResolvedName(null);
      setError(
        "We couldn't verify that account. Check the number and bank, then try again.",
      );
    }
  };

  const handleConnect = async (): Promise<void> => {
    setError(null);
    try {
      await submitMutation.mutateAsync({
        brandId,
        accountNumber,
        bankCode: bankCode as string,
      });
      onConnected?.();
    } catch (e) {
      setError(
        isUpdate
          ? "We couldn't update this bank account. Please try again in a moment."
          : "We couldn't connect this bank account. Please try again in a moment.",
      );
    }
  };

  return (
    <GlassCard variant="elevated" padding={spacing.lg}>
      <Text style={styles.title}>
        {isUpdate ? "Change payout bank" : "Get paid in Nigeria"}
      </Text>
      <Text style={styles.subtitle}>
        {isUpdate
          ? "Enter the new bank account that should receive your payouts."
          : "Connect your bank account to receive payouts. Sales settle directly to this account, usually the next business day."}
      </Text>

      {/* Bank picker */}
      <Text style={styles.label}>Bank</Text>
      <Pressable
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
            label={submitMutation.isPending
              ? (isUpdate ? "Updating…" : "Connecting…")
              : (isUpdate ? "Update bank account" : "Connect bank & get paid")}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!canConnect}
            loading={submitMutation.isPending}
            onPress={handleConnect}
          />
        )}
        {isUpdate && onCancel != null ? (
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
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
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
              <ActivityIndicator color={accent.warm} style={{ marginTop: spacing.lg }} />
            ) : (
              <ScrollView
                style={styles.bankList}
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
                  <Text style={styles.bankEmpty}>No banks match “{bankSearch}”.</Text>
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
  backdrop: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.5)" },
  sheet: {
    height: "64%",
    padding: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: "#14110f",
  },
  sheetTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    marginBottom: spacing.md,
  },
  bankList: { flex: 1, marginTop: spacing.md },
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
