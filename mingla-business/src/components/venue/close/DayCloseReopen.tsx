/**
 * #4490 spec 08 O5 part B — Reopen this day: a reason, then (on a shared Till
 * device) the PIN again, inside this same sheet (TillStepUpHost: never a
 * second native sheet). The closed snapshot moves into the day's history and
 * the cash is counted again at the next close. Money rights, within 7 days.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import type { TillPinPerson } from "../../../services/venueTillService";
import { Banner } from "../../ui/Banner";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { SheetScrollLayout } from "../../ui/SheetScrollLayout";
import { TillStepUpHost } from "../till/TillStepUp";
import { CLOSE_COPY } from "./dayCloseCopy";

export interface DayCloseReopenProps {
  venueId: string;
  /** On a Till device: who may approve on the spot. Null on an own phone. */
  approvers: readonly TillPinPerson[] | null;
  busy: boolean;
  error: string | null;
  onReopen: (reason: string) => void;
}

export function DayCloseReopen({ venueId, approvers, busy, error, onReopen }: DayCloseReopenProps): React.ReactElement {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const missing = touched && trimmed.length === 0;
  const form = (
    <SheetScrollLayout
      keyboardAware
      contentStyle={styles.body}
      footer={
        <Button label={approvers !== null ? CLOSE_COPY.reopenGoPin : CLOSE_COPY.reopenGo} variant="primary" size="lg" fullWidth
          loading={busy} disabled={busy}
          onPress={() => {
            setTouched(true);
            if (trimmed.length > 0) onReopen(trimmed);
          }}
          testID="day-close-reopen-go" />
      }
    >
      <View style={styles.field}>
        <Text style={styles.label}>{CLOSE_COPY.reopenReason}</Text>
        <Input value={reason} onChangeText={(v) => setReason(v.slice(0, 140))} placeholder={CLOSE_COPY.reopenReasonPlaceholder}
          accessibilityLabel={CLOSE_COPY.reopenReason} testID="day-close-reopen-reason" />
        <Text style={[styles.hint, missing && styles.error]}>{missing ? CLOSE_COPY.reopenReason : `${reason.length} of 140`}</Text>
      </View>
      <Text style={styles.hint}>{CLOSE_COPY.reopenBody}</Text>
      {error !== null ? <Banner tone="danger" title={error} testID="day-close-reopen-error" /> : null}
    </SheetScrollLayout>
  );
  return approvers !== null
    ? <TillStepUpHost venueId={venueId} approvers={approvers}>{form}</TillStepUpHost>
    : form;
}

const styles = StyleSheet.create({
  body: { gap: space[4], paddingBottom: space[4], paddingHorizontal: space[1] },
  field: { gap: space[1] },
  label: { ...type.label, color: color.text3 },
  hint: { ...type.caption, color: color.text3 },
  error: { color: color.errorText },
});
