/**
 * #4514 wave 4 — the guest list's "Ask guests to answer" row (§4.7), under the
 * header, for event, experience and trip guest lists. It shows only when the
 * page has a live form; the guest list itself is event manager and up, the
 * same rank Ask needs (C5), and the edge checks again. Loaded through the lazy
 * forms owner only.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import { useRosterAnswers } from "../../hooks/useBrandForms";
import { Button } from "../ui/Button";
import { FORM_REQUEST_COPY as COPY } from "./brandFormsCopy";
import { FormRequestSheet } from "./FormRequestSheet";
import { useFormsToast } from "./useFormsToast";

export const GuestFormRequestRow: React.FC<{ eventId: string; eventTitle?: string | null }> = ({ eventId, eventTitle }) => {
  const answers = useRosterAnswers(eventId);
  const [open, setOpen] = useState(false);
  const { show, toast } = useFormsToast();
  const index = answers.data;
  if (index === undefined || index === null || index.page.form.status !== "live") return toast;
  return (
    <View style={styles.row} testID="guest-form-request-row">
      <View style={styles.text}>
        <Text style={styles.title}>{`${COPY.askTitle} · ${index.formName}`}</Text>
        <Text style={styles.line}>{COPY.rowLine}</Text>
      </View>
      <Button label={COPY.askTitle} variant="secondary" size="sm" onPress={() => setOpen(true)} testID="guest-form-request-open" />
      {open ? (
        <FormRequestSheet
          visible
          onClose={() => setOpen(false)}
          formId={index.page.form.id}
          eventId={eventId}
          mode="ask"
          eventTitle={eventTitle ?? null}
          notify={show}
        />
      ) : null}
      {toast}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...type.row, color: color.text1 },
  line: { ...type.caption, color: color.text3 },
});

export default GuestFormRequestRow;
