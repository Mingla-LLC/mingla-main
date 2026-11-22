/**
 * #4541 R4.2 — the form a Blast carries, as the composer shows it (design v10
 * G, steps 1 to 2b). One block for the whole Blast, a line per channel it goes
 * by:
 *   - Email: a button preview "Answer: {form name}";
 *   - Text: " Answer: [their own link]" (the SMS card counts it at its real length);
 *   - Push: "Opens the form in the Mingla app".
 * Remove (×), the hint about own links and Unknown replies (with the
 * name-question tip), a warning when the form is not live, and, for a
 * scheduled Blast, what happens if the form closes before it sends.
 *
 * Loaded only through the lazy forms owner (one lazy hop from the composer).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useBlastFormPicker } from "../../hooks/useBrandForms";
import { Icon } from "../ui/Icon";
import { BLAST_FORM_COPY as COPY } from "./brandFormsCopy";

export interface BlastFormBlockProps {
  brandId: string | null;
  formId: string;
  /** The name picked (a draft reopened later names it from the brand's forms). */
  formName: string | null;
  channels: { email: boolean; sms: boolean; push: boolean };
  scheduled: boolean;
  onRemove: () => void;
}

export const BlastFormBlock: React.FC<BlastFormBlockProps> = ({
  brandId,
  formId,
  formName,
  channels,
  scheduled,
  onRemove,
}) => {
  const forms = useBlastFormPicker(brandId);
  const found = forms.data?.find((item) => item.form.id === formId) ?? null;
  const name = found?.form.name ?? formName ?? COPY.aForm;
  // Only a form we read and found not live is warned about (never a guess while loading).
  const notLive = forms.data !== undefined && (found === null || found.form.status !== "live");

  return (
    <View style={styles.block} testID="blast-form-block">
      <View style={styles.head}>
        <Text style={styles.label}>{COPY.blockLabel}</Text>
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={COPY.remove}
          style={({ pressed }) => [styles.remove, pressed ? styles.pressed : null]}
          testID="blast-form-remove"
        >
          <Icon name="close" size={16} color={color.text2} />
        </Pressable>
      </View>
      {channels.email ? (
        <View style={styles.button} accessibilityRole="text" testID="blast-form-email-preview">
          <Text style={styles.buttonText} numberOfLines={2}>{COPY.emailButton(name)}</Text>
        </View>
      ) : (
        <Text style={styles.name} numberOfLines={2}>{name}</Text>
      )}
      {channels.sms ? <Text style={styles.line} testID="blast-form-sms-line">{COPY.smsLine}</Text> : null}
      {channels.push ? <Text style={styles.line} testID="blast-form-push-line">{COPY.pushLine}</Text> : null}
      <Text style={styles.hint}>{COPY.hint}</Text>
      {notLive ? (
        <Text style={styles.warn} accessibilityRole="alert" testID="blast-form-not-live">{COPY.notLive}</Text>
      ) : null}
      {scheduled && !notLive ? <Text style={styles.hint} testID="blast-form-scheduled">{COPY.scheduledNote}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    marginHorizontal: space[4],
    marginTop: space[2],
    padding: space[3],
    gap: space[1],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { ...type.label, color: color.text3 },
  remove: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.72 },
  button: {
    alignSelf: "flex-start",
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
    borderWidth: 1,
    borderColor: color.line,
  },
  buttonText: { ...type.btnSm, color: color.text1 },
  name: { ...type.row, color: color.text1 },
  line: { ...type.small, color: color.text2 },
  hint: { ...type.caption, color: color.text3 },
  warn: { ...type.small, color: color.warningText },
});

export default BlastFormBlock;
