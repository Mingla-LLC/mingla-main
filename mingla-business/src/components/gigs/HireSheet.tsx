import React, { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";
import { creatorGigsService } from "../../services/creatorGigsService";
import { accent, spacing, text as textTokens } from "../../constants/designSystem";

const money = (minor: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
export function HireSheet({ interestId, quoteMinor, currency, counter = false, onStarted }: { interestId: string; quoteMinor: number; currency: string; counter?: boolean; onStarted: (result: unknown) => void }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [feeText, setFeeText] = useState(String(quoteMinor));
  const feeMinor = Number(feeText);
  const validFee = Number.isInteger(feeMinor) && feeMinor > 0;
  const booking = useMemo(() => validFee ? Math.floor((feeMinor * 1500 + 5000) / 10000) : 0, [feeMinor, validFee]);
  const isCounter = feeMinor !== quoteMinor;
  const start = async () => { if (!validFee) return; setBusy(true); try { const result = await creatorGigsService.hire({ interestId, feeMinor, terms: { fee_minor: feeMinor }, idempotencyKey: `gig-${interestId}-${feeMinor}` }); onStarted(result); } catch (e) { Alert.alert("Couldn’t start payment", e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <GlassCard style={styles.card}>
    <Text style={styles.title}>{counter ? "Send a structured counter" : "Fund the creator offer"}</Text>
    <Text style={styles.note}>Creator quoted {money(quoteMinor, currency)}. {counter ? "Set the fee you are offering; the Creator will see this exact version and has 48 hours to accept." : "This uses the Creator’s quoted fee."}</Text>
    {counter ? <Input value={feeText} onChangeText={setFeeText} placeholder="Creator fee in minor units" variant="number" accessibilityLabel="Counteroffer creator fee" /> : null}
    <View style={styles.row}><Text style={styles.label}>Creator fee</Text><Text style={styles.value}>{validFee ? money(feeMinor, currency) : "—"}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Mingla booking fee (15%)</Text><Text style={styles.value}>{money(booking, currency)}</Text></View>
    <View style={styles.total}><Text style={styles.totalLabel}>Charged now</Text><Text style={styles.totalValue}>{validFee ? money(feeMinor + booking, currency) : "—"}</Text></View>
    <Text style={styles.note}>Held by Mingla and released after verified posts go live. A decline or expired offer is refunded automatically.</Text>
    <Text style={styles.note}>Before acceptance you can cancel for a full refund. Later refunds follow the work already completed.</Text>
    <Button fullWidth loading={busy} disabled={!validFee || (counter && !isCounter)} label={counter ? "Secure payment and send counter" : "Continue to secure payment"} onPress={() => void start()} />
  </GlassCard>;
}
const styles = StyleSheet.create({ card: { padding: spacing.lg, gap: spacing.md }, title: { color: textTokens.primary, fontSize: 22, fontWeight: "900" }, row: { flexDirection: "row", justifyContent: "space-between" }, label: { color: textTokens.secondary }, value: { color: textTokens.primary, fontWeight: "700" }, total: { flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: accent.warm }, totalLabel: { color: textTokens.primary, fontWeight: "900" }, totalValue: { color: accent.warm, fontSize: 20, fontWeight: "900" }, note: { color: textTokens.secondary, lineHeight: 20 } });
