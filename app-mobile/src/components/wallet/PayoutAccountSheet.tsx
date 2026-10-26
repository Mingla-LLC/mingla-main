import React, { useEffect, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createPaystackPayoutRecipient,
  createStripePayoutAccountLink,
  listPaystackBanks,
  resolvePaystackAccount,
} from "../../services/referralEarningsService";

type ResolvedPaystackAccount = {
  accountName: string;
  accountNumberMasked: string;
  accountNumber: string;
  bankCode: string;
};

export const PayoutAccountSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ visible, onClose, onSaved }) => {
  const [country, setCountry] = useState("US");
  const [accountNumber, setAccountNumber] = useState("");
  const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
  const [selectedBank, setSelectedBank] = useState<{ name: string; code: string } | null>(null);
  const [resolvedAccount, setResolvedAccount] = useState<ResolvedPaystackAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || banks.length > 0) return;
    void listPaystackBanks().then(setBanks).catch(() => undefined);
  }, [banks.length, visible]);

  const stripe = async () => {
    setBusy(true); setError(null);
    try {
      const link = await createStripePayoutAccountLink(country);
      await Linking.openURL(link.url);
      onSaved();
    } catch { setError("Stripe setup could not open. Check your country and try again."); }
    finally { setBusy(false); }
  };
  const resolvePaystack = async () => {
    if (!/^\d{10}$/.test(accountNumber) || !selectedBank) {
      setError("Choose a bank and enter the 10-digit account number.");
      return;
    }
    setBusy(true); setError(null);
    try {
      const resolved = await resolvePaystackAccount({
        accountNumber,
        bankCode: selectedBank.code,
      });
      setResolvedAccount({
        accountName: resolved.account_name,
        accountNumberMasked: resolved.account_number_masked,
        accountNumber,
        bankCode: selectedBank.code,
      });
    } catch { setError("Paystack could not verify that account. Check the details and try again."); }
    finally { setBusy(false); }
  };
  const confirmPaystack = async () => {
    if (!selectedBank || !resolvedAccount ||
      resolvedAccount.accountNumber !== accountNumber ||
      resolvedAccount.bankCode !== selectedBank.code) {
      setResolvedAccount(null);
      setError("Verify the account name again before saving.");
      return;
    }
    setBusy(true); setError(null);
    try {
      await createPaystackPayoutRecipient({
        accountNumber,
        bankCode: selectedBank.code,
        bankName: selectedBank.name,
      });
      onSaved(); onClose();
    } catch { setError("Paystack could not save that payout account. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <View>
                <Text style={styles.eyebrow}>PAYOUT ACCOUNT</Text>
                <Text style={styles.title}>Where rewards are sent</Text>
              </View>
              <Pressable onPress={onClose}><Text style={styles.close}>Close</Text></Pressable>
            </View>
            <Text style={styles.body}>
              Mingla sends eligible rewards automatically after the release date. Mingla deducts its 5% referral service fee; your payout provider may deduct its own transfer fee.
            </Text>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Stripe recipient</Text>
              <TextInput value={country} onChangeText={setCountry} autoCapitalize="characters" maxLength={2} placeholder="Country code, e.g. US" placeholderTextColor="#777" style={styles.input} />
              <Pressable disabled={busy} onPress={() => void stripe()} style={styles.button}><Text style={styles.buttonText}>Continue with Stripe</Text></Pressable>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Paystack bank account (Nigeria)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.banks}>
                {banks.map((bank) => (
                  <Pressable key={bank.code} onPress={() => { setSelectedBank(bank); setResolvedAccount(null); setError(null); }} style={[styles.bank, selectedBank?.code === bank.code && styles.bankSelected]}>
                    <Text style={styles.bankText}>{bank.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput value={accountNumber} onChangeText={(value) => { setAccountNumber(value.replace(/\D/g, "")); setResolvedAccount(null); setError(null); }} keyboardType="number-pad" maxLength={10} placeholder="10-digit account number" placeholderTextColor="#777" style={styles.input} secureTextEntry />
              <Text style={styles.hint}>The full account number is sent directly for provider verification. Mingla stores only the last four digits.</Text>
              {resolvedAccount ? (
                <View accessibilityLiveRegion="polite" style={styles.confirmation}>
                  <Text style={styles.confirmationEyebrow}>CONFIRM ACCOUNT NAME</Text>
                  <Text style={styles.confirmationName}>{resolvedAccount.accountName}</Text>
                  <Text style={styles.confirmationMeta}>{selectedBank?.name} · {resolvedAccount.accountNumberMasked}</Text>
                  <Text style={styles.hint}>Only continue if this is the person or business that should receive your rewards.</Text>
                  <View style={styles.confirmationActions}>
                    <Pressable disabled={busy} onPress={() => { setResolvedAccount(null); setError(null); }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Change details</Text></Pressable>
                    <Pressable disabled={busy} onPress={() => void confirmPaystack()} style={styles.button}><Text style={styles.buttonText}>{busy ? "Saving…" : "Confirm & save"}</Text></Pressable>
                  </View>
                </View>
              ) : (
                <Pressable disabled={busy} onPress={() => void resolvePaystack()} style={styles.button}><Text style={styles.buttonText}>{busy ? "Checking…" : "Check account name"}</Text></Pressable>
              )}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#101014" },
  content: { padding: 22, paddingBottom: 44, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { color: "#fb923c", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#fff", fontSize: 24, fontWeight: "900", marginTop: 4 },
  close: { color: "#fb923c", fontWeight: "700" },
  body: { color: "rgba(255,255,255,0.72)", lineHeight: 21 },
  section: { gap: 10, padding: 16, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.05)" },
  sectionTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  input: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.28)", color: "#fff", padding: 13 },
  button: { alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#f97316", paddingHorizontal: 17, paddingVertical: 11 },
  buttonText: { color: "#fff", fontWeight: "800" },
  banks: { gap: 8 },
  bank: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.08)" },
  bankSelected: { backgroundColor: "rgba(249,115,22,0.35)", borderWidth: 1, borderColor: "#f97316" },
  bankText: { color: "#fff", fontSize: 12 },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 17 },
  confirmation: { gap: 7, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(34,197,94,0.45)", backgroundColor: "rgba(34,197,94,0.09)" },
  confirmationEyebrow: { color: "#86efac", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  confirmationName: { color: "#fff", fontSize: 19, fontWeight: "900" },
  confirmationMeta: { color: "rgba(255,255,255,0.72)", fontSize: 13 },
  confirmationActions: { flexDirection: "row", flexWrap: "wrap", gap: 9, alignItems: "center", marginTop: 4 },
  secondaryButton: { borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.28)", paddingHorizontal: 17, paddingVertical: 11 },
  secondaryButtonText: { color: "#fff", fontWeight: "800" },
  error: { color: "#fecaca", lineHeight: 19 },
});
