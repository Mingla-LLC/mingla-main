import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createBrandMessageProductSignal,
  type BrandGroupMessage,
} from "../../services/brandGroupsService";
import { color, radius, space } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ScrollView } from "../../wrappers/SmartScrollView";

const SIGNAL_KINDS = ["question", "account", "bug", "feature", "trust_safety"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

interface Props {
  visible: boolean;
  brandName: string;
  messages: BrandGroupMessage[];
  sourceMessageId: string | null;
  relatedMessageIds: string[];
  onClose: () => void;
  onCreated: (signalId: string) => void;
}

export function BrandGroupSignalModal({
  visible,
  brandName,
  messages,
  sourceMessageId,
  relatedMessageIds,
  onClose,
  onCreated,
}: Props): React.ReactElement {
  const source = messages.find((message) => message.id === sourceMessageId) ?? null;
  const related = useMemo(
    () => messages.filter((message) => relatedMessageIds.includes(message.id)),
    [messages, relatedMessageIds],
  );
  const [signalKind, setSignalKind] = useState<(typeof SIGNAL_KINDS)[number]>("feature");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [productArea, setProductArea] = useState("Host app · Messages");
  const [journey, setJourney] = useState("A Host user was using their Brand group conversation.");
  const [impact, setImpact] = useState("One verified Brand group report");
  const [affectedPeople, setAffectedPeople] = useState("1");
  const [nextStep, setNextStep] = useState("Product reviews the linked conversation evidence and decides the next action.");
  const [replyDraft, setReplyDraft] = useState("Thanks for raising this. We have shared it privately with Product and will post the next useful update here.");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !source) return;
    const evidence = [source, ...related.filter((message) => message.id !== source.id)]
      .map((message) => `${message.sender_display_name}: ${message.content}`)
      .join("\n");
    setTitle(`${brandName}: ${source.content.slice(0, 120)}`);
    setProblem(evidence);
    setError(null);
  }, [brandName, related, source, visible]);

  const valid = !!source && [title, problem, productArea, journey, impact, nextStep, replyDraft]
    .every((value) => value.trim().length > 0) && Number(affectedPeople) > 0;

  async function submit(): Promise<void> {
    if (!source || !valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createBrandMessageProductSignal({
        clientRequestId: requestId(),
        sourceId: source.id,
        signalKind,
        title,
        problemStatement: problem,
        productArea,
        userJourney: journey,
        impactSummary: impact,
        affectedPeople: Number(affectedPeople),
        priority,
        nextUpdateAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        nextStep,
        customerReplyDraft: replyDraft,
      });
      onCreated(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't create the Product signal");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Create product signal</Text>
            <Text style={styles.subtitle}>Private to Mingla · linked to the selected Brand group message</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text style={styles.help}>No AI is required. The selected messages prefill this form; a Support teammate reviews and edits every field before saving.</Text>
          <Text style={styles.label}>Signal type</Text>
          <View style={styles.chips}>{SIGNAL_KINDS.map((value) => (
            <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Signal type ${value.replace("_", " and ")}`} accessibilityState={{ selected: signalKind === value }} onPress={() => setSignalKind(value)} style={[styles.chip, signalKind === value && styles.chipActive]}>
              <Text style={[styles.chipText, signalKind === value && styles.chipTextActive]}>{value.replace("_", " & ")}</Text>
            </Pressable>
          ))}</View>
          <Text style={styles.label}>Priority</Text>
          <View style={styles.chips}>{PRIORITIES.map((value) => (
            <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Priority ${value}`} accessibilityState={{ selected: priority === value }} onPress={() => setPriority(value)} style={[styles.chip, priority === value && styles.chipActive]}>
              <Text style={[styles.chipText, priority === value && styles.chipTextActive]}>{value}</Text>
            </Pressable>
          ))}</View>
          <SignalField label="Plain-English title" value={title} onChangeText={setTitle} />
          <SignalField label="Problem or request" value={problem} onChangeText={setProblem} multiline />
          <SignalField label="Product area" value={productArea} onChangeText={setProductArea} />
          <SignalField label="What was the person trying to do?" value={journey} onChangeText={setJourney} multiline />
          <SignalField label="Impact" value={impact} onChangeText={setImpact} multiline />
          <SignalField label="People affected" value={affectedPeople} onChangeText={setAffectedPeople} keyboardType="number-pad" />
          <SignalField label="Product next step" value={nextStep} onChangeText={setNextStep} multiline />
          <SignalField label="Draft update to the Brand group" value={replyDraft} onChangeText={setReplyDraft} multiline />
          <Text style={styles.promise}>Next Product update defaults to 24 hours from now and can be refined in the Product inbox.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Create private signal" fullWidth disabled={!valid || saving} loading={saving} onPress={() => void submit()} />
          {saving ? <ActivityIndicator color={color.text2} /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SignalField({ label, multiline = false, ...props }: React.ComponentProps<typeof TextInput> & { label: string; multiline?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={color.text3}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: "row", alignItems: "center", gap: space[4], padding: space[6], paddingTop: space[7], borderBottomWidth: 1, borderBottomColor: color.line },
  headerCopy: { flex: 1, gap: 3 },
  title: { color: color.text1, fontSize: 20, fontWeight: "800" },
  subtitle: { color: color.text2, fontSize: 12 },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  closeText: { color: color.text1, fontWeight: "700" },
  form: { padding: space[6], gap: space[4], paddingBottom: 48 },
  help: { color: color.text2, lineHeight: 20, padding: space[4], borderRadius: radius.md, backgroundColor: color.fill.tile, borderWidth: 1, borderColor: color.lineStrong },
  field: { gap: space[1] },
  label: { color: color.text1, fontSize: 13, fontWeight: "700" },
  input: { minHeight: 46, color: color.text1, backgroundColor: color.fill.tile, borderWidth: 1, borderColor: color.lineStrong, borderRadius: radius.md, paddingHorizontal: space[4], paddingVertical: space[2] },
  textarea: { minHeight: 92, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: { minHeight: 38, justifyContent: "center", paddingHorizontal: space[4], borderRadius: 19, borderWidth: 1, borderColor: color.lineStrong, backgroundColor: color.fill.inset },
  chipActive: { borderColor: color.lineStrong, backgroundColor: color.fill.tabOn },
  chipText: { color: color.text2, textTransform: "capitalize" },
  chipTextActive: { color: color.text1, fontWeight: "700" },
  promise: { color: color.text3, fontSize: 12, lineHeight: 18 },
  error: { color: color.errorText, fontSize: 13 },
});
