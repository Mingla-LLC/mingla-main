import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

export interface SourceRefundBank {
  id: string;
  name: string;
}

export function SourceRefundAttentionSheet({
  submitting,
  loadingBanks,
  banks,
  error,
  deliveryParked = false,
  onRetryBanks,
  onSubmit,
}: {
  submitting: boolean;
  loadingBanks: boolean;
  banks: SourceRefundBank[];
  error?: string | null;
  deliveryParked?: boolean;
  onRetryBanks: () => void;
  onSubmit: (value: { accountNumber: string; bankId: string }) => void;
}) {
  const [accountNumber, setAccountNumber] = useState("");
  const [bankId, setBankId] = useState("");
  const selected = useMemo(
    () => banks.some((bank) => bank.id === bankId),
    [bankId, banks],
  );
  const valid = /^[0-9]{10}$/.test(accountNumber) && selected;
  return (
    <View style={styles.sheet}>
      <Text style={styles.title}>Complete your refund</Text>
      <Text style={styles.copy}>
        Paystack needs a Nigerian bank account to continue this refund. These
        details are sent once and are not stored by Mingla.
      </Text>
      {deliveryParked
        ? (
          <Text style={styles.error}>
            We couldn&apos;t confirm the text was sent. Your refund still needs
            details. Continue here or contact Mingla Support.
          </Text>
        )
        : null}
      <TextInput
        accessibilityLabel="10-digit account number"
        keyboardType="number-pad"
        maxLength={10}
        value={accountNumber}
        onChangeText={setAccountNumber}
        style={styles.input}
      />
      <Text style={styles.label}>Choose your bank</Text>
      {loadingBanks
        ? <Text>Loading banks…</Text>
        : banks.length === 0
        ? (
          <Pressable accessibilityRole="button" onPress={onRetryBanks}>
            <Text style={styles.link}>Couldn’t load banks. Try again.</Text>
          </Pressable>
        )
        : (
          <ScrollView style={styles.bankList} nestedScrollEnabled>
            {banks.map((bank) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: bank.id === bankId }}
                key={bank.id}
                onPress={() => setBankId(bank.id)}
                style={[
                  styles.bankRow,
                  bank.id === bankId && styles.selectedBank,
                ]}
              >
                <Text>{bank.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue refund"
        disabled={!valid || submitting}
        onPress={() => onSubmit({ accountNumber, bankId })}
        style={[styles.button, (!valid || submitting) && styles.disabled]}
      >
        <Text style={styles.buttonText}>
          {submitting ? "Submitting…" : "Continue refund"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { padding: 20, gap: 12 },
  title: { fontSize: 20, fontWeight: "700" },
  label: { fontWeight: "700" },
  copy: { color: "#4b5563", lineHeight: 20 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 12,
  },
  bankList: {
    maxHeight: 180,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
  },
  bankRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  selectedBank: { backgroundColor: "#e5eefc" },
  link: { color: "#1d4ed8", fontWeight: "700" },
  error: { color: "#b91c1c" },
  button: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#111827",
    justifyContent: "center",
    alignItems: "center",
  },
  disabled: { opacity: 0.45 },
  buttonText: { color: "#fff", fontWeight: "700" },
});
