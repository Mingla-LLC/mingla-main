import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { color, radius, scrim, space } from "../../../../constants/designSystem";
import { WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { sectionSuggestions } from "../../../../sites/ariWorkspace";
import type { WorkspaceSection } from "../../../../sites/contentApi";
import { IconButton, parts, SuggestionChip } from "./parts";

/*
 * #4453 — click a section, tell Ari right there. One field, a few requests
 * that fit this kind of section, and the two ways out: edit it by hand, or
 * ask the Mingla team. Focus lands in the field; Escape closes it.
 */
export function SectionAriCard({ section, onAsk, onEditByHand, onAskTeam, onClose, disabledReason, sheet }: {
  section: Pick<WorkspaceSection, "id" | "type" | "label">;
  /** Returns why the request could not start (null: it started). */
  onAsk: (text: string) => string | null;
  onEditByHand: () => void;
  onAskTeam: (typed: string) => void;
  onClose: () => void;
  disabledReason: string | null;
  /** Inside a bottom sheet (phone): no card chrome of its own. */
  sheet?: boolean;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  useEffect(() => {
    setText("");
    setNote(null);
    // In a phone sheet the keyboard would cover the suggestions: focus on desktop only.
    if (sheet) return undefined;
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [section.id, sheet]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || sheet) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sheet]);
  const ask = (request: string) => {
    const refused = disabledReason ?? onAsk(request);
    setNote(refused);
  };
  const title = `Ari · ${section.label}`;
  return (
    <View style={[styles.card, sheet ? styles.sheet : null]} role="dialog" aria-label={title} accessibilityLabel={title} testID="section-ari-card">
      <View style={parts.row}>
        <WebsiteIcon name="spark" size={16} color={ui.t1} />
        <Text style={[parts.title, parts.grow]} numberOfLines={1} role="heading" aria-level={2}>{title}</Text>
        {sheet ? null : <IconButton icon="close" label="Close" onPress={onClose} testID="section-ari-close" />}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(value) => { setText(value); if (note) setNote(null); }}
          onSubmitEditing={() => ask(text.trim() || "Make this section better")}
          placeholder="Tell Ari what to change here…"
          placeholderTextColor={ui.t4}
          accessibilityLabel="Tell Ari what to change"
          returnKeyType="send"
          maxLength={600}
          testID="section-ari-input"
          style={styles.input}
        />
        <IconButton icon="send" label="Send to Ari" onPress={() => ask(text.trim() || "Make this section better")} disabledReason={disabledReason} onDisabledPress={setNote} testID="section-ari-send" />
      </View>
      {note ? <Text style={styles.note} role="alert" testID="section-ari-note">{note}</Text> : null}
      <View style={parts.wrap}>
        {sectionSuggestions(section.type, section.label).map((chip) => (
          <SuggestionChip key={chip} label={chip} onPress={() => ask(chip)} testID={`section-ari-chip-${chip.toLowerCase().replace(/[^a-z]+/g, "-")}`} />
        ))}
      </View>
      <View style={styles.footer}>
        <WButton label="Edit by hand" icon="edit" size="sm" onPress={onEditByHand} testID="section-ari-edit" />
        <WButton label="Ask the Mingla team" icon="team" size="sm" onPress={() => onAskTeam(text)} testID="section-ari-team" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[3], padding: space[4], borderRadius: radius.md, backgroundColor: color.card3, borderWidth: 1, borderColor: ui.border2, boxShadow: `0 12px 40px ${scrim.modal}` } as object,
  sheet: { backgroundColor: "transparent", borderWidth: 0, padding: 0, boxShadow: "none" } as object,
  inputRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  input: { flex: 1, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: ui.border2, backgroundColor: ui.card, color: ui.t1, fontSize: 16, paddingHorizontal: 12 },
  note: { fontSize: 13, lineHeight: 18, color: color.warningText },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingTop: space[2], borderTopWidth: 1, borderTopColor: ui.cardBorder },
});
