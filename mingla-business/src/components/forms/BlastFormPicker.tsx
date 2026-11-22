/**
 * #4541 R4.2 — the Blast composer's "+ Form" picker (design v10 G, step 1).
 *
 * "Add a form" / "Only live forms of this brand can be sent." Each of the
 * brand's forms is a row: a live form can be picked ("Live · {n} questions");
 * a closed or draft form is shown, disabled, with why it cannot be sent. A
 * sheet from the bottom with breathing room; Cancel, swipe down, scrim tap and
 * Android back close it (the Sheet owns those). Rows are 56 pt tall.
 *
 * Loaded only through the lazy forms owner (one lazy hop from the composer).
 */

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useBlastFormPicker } from "../../hooks/useBrandForms";
import type { BrandFormListItem } from "../../services/brandFormsService";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SheetScrollLayout } from "../ui/SheetScrollLayout";
import { BLAST_FORM_COPY as COPY } from "./brandFormsCopy";
import { errorSentence } from "./useFormsToast";

export interface BlastFormPickerProps {
  visible: boolean;
  brandId: string | null;
  onClose: () => void;
  onPick: (form: { formId: string; name: string }) => void;
}

/** The row's line and whether it can be picked. Pure; exported for tests. */
export function pickerRow(item: BrandFormListItem): { line: string; selectable: boolean } {
  if (item.form.status === "live") return { line: COPY.liveRow(item.questionCount), selectable: true };
  if (item.form.status === "closed") return { line: COPY.closedRow, selectable: false };
  return { line: COPY.draftRow, selectable: false };
}

export const BlastFormPicker: React.FC<BlastFormPickerProps> = ({ visible, brandId, onClose, onPick }) => {
  const forms = useBlastFormPicker(visible ? brandId : null);
  const items = (forms.data ?? []).filter((item) => item.form.status !== "archived");

  let body: React.ReactNode;
  if (forms.isLoading || (forms.data === undefined && !forms.isError)) {
    body = (
      <View style={styles.center} accessibilityLabel={COPY.loading}>
        <ActivityIndicator size="small" color={color.text2} />
      </View>
    );
  } else if (forms.isError) {
    body = (
      <View style={styles.block} accessibilityRole="alert">
        <Text style={styles.muted}>{errorSentence(forms.error, COPY.failed)}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void forms.refetch()} />
      </View>
    );
  } else if (items.length === 0) {
    body = <Text style={styles.muted} testID="blast-form-picker-empty">{COPY.empty}</Text>;
  } else {
    body = (
      <View style={styles.list}>
        {items.map((item) => {
          const row = pickerRow(item);
          return (
            <Pressable
              key={item.form.id}
              onPress={row.selectable ? () => onPick({ formId: item.form.id, name: item.form.name }) : undefined}
              disabled={!row.selectable}
              accessibilityRole="button"
              accessibilityState={{ disabled: !row.selectable }}
              accessibilityLabel={`${item.form.name}. ${row.line}`}
              style={({ pressed }) => [styles.row, !row.selectable ? styles.rowDisabled : null, pressed && row.selectable ? styles.pressed : null]}
              testID={`blast-form-picker-${item.form.id}`}
            >
              <Text style={styles.name} numberOfLines={2}>{item.form.name}</Text>
              <Text style={styles.muted}>{row.line}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <SheetScrollLayout
        testID="blast-form-picker"
        footer={<Button label={COPY.cancel} variant="secondary" size="md" fullWidth onPress={onClose} testID="blast-form-picker-cancel" />}
      >
        <Text style={styles.title} accessibilityRole="header">{COPY.pickerTitle}</Text>
        <Text style={styles.muted}>{COPY.pickerLine}</Text>
        <View style={styles.block}>{body}</View>
      </SheetScrollLayout>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  title: { ...type.title, color: color.text1, marginBottom: space[1] },
  block: { gap: space[2], marginTop: space[4] },
  center: { paddingVertical: space[6], alignItems: "center" },
  list: { gap: space[2] },
  row: {
    minHeight: 56,
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  rowDisabled: { opacity: 0.6 },
  pressed: { opacity: 0.72 },
  name: { ...type.row, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
});

export default BlastFormPicker;
