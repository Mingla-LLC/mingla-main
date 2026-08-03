import React, { useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";

export interface RefundBank {
  id: string;
  name: string;
}

export function SourceRefundAttentionForm({
  banks,
  loadingBanks,
  onRetryBanks,
  onSubmit,
  submitting,
}: {
  banks: RefundBank[];
  loadingBanks: boolean;
  onRetryBanks: () => void;
  onSubmit: (details: { accountNumber: string; bankId: string }) => void;
  submitting: boolean;
}) {
  const [accountNumber, setAccountNumber] = useState("");
  const [bankId, setBankId] = useState("");
  const selected = useMemo(
    () => banks.find((bank) => bank.id === bankId),
    [bankId, banks],
  );
  const valid = /^[0-9]{10}$/.test(accountNumber) && Boolean(selected);
  return (
    <View style={styles.form}>
      <Text>
        Choose your Nigerian bank. These details are sent to Paystack once and
        are not stored by Mingla.
      </Text>
      <TextInput
        accessibilityLabel="Account number"
        keyboardType="number-pad"
        maxLength={10}
        value={accountNumber}
        onChangeText={setAccountNumber}
        placeholder="10-digit account number"
        style={styles.input}
      />
      <Text style={styles.label}>Bank</Text>
      {loadingBanks
        ? <Text>Loading banks…</Text>
        : banks.length === 0
        ? (
          <Pressable
            accessibilityLabel="Retry loading banks"
            accessibilityRole="button"
            onPress={onRetryBanks}
          >
            <Text style={styles.retry}>Couldn’t load banks. Try again.</Text>
          </Pressable>
        )
        : (
          <ScrollView style={styles.bankList} nestedScrollEnabled>
            {banks.map((bank) => (
              <Pressable
                accessibilityLabel={bank.name}
                accessibilityRole="radio"
                accessibilityState={{ selected: bank.id === bankId }}
                key={bank.id}
                onPress={() => setBankId(bank.id)}
                style={[
                  styles.bank,
                  bank.id === bankId && styles.bankSelected,
                ]}
              >
                <Text>{bank.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      <Pressable
        accessibilityLabel="Continue refund"
        accessibilityRole="button"
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
  form: { gap: 12 },
  label: { fontWeight: "700" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    padding: 12,
  },
  bankList: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
  },
  bank: { padding: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  bankSelected: { backgroundColor: "#e5eefc" },
  retry: { color: "#1d4ed8", fontWeight: "700" },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: "#111827",
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontWeight: "700" },
});
