/**
 * #4514 wave 3 — the answers chip on each guest list row and the answers panel
 * in the guest's detail drawer (§4.8), for event, experience and trip guest
 * lists. Loaded through `formsOwner` only (lazy), so nothing here is eager.
 *
 * Who sees it: the guest list itself is event manager and up; reading answers
 * is marketing manager and up (C5), so every guest list viewer may read them.
 * Words, never colour alone. A page with no published form draws nothing.
 */

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useRosterAnswers } from "../../hooks/useBrandForms";
import { answerText } from "../../utils/brandFormResponses";
import {
  chipForRow,
  chipLabel,
  GUEST_ANSWERS_CHIP_COPY as COPY,
} from "../../utils/guestRosterAnswers";
import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { FORM_REQUEST_COPY } from "./brandFormsCopy";
import { FormRequestSheet } from "./FormRequestSheet";
import { useFormsToast } from "./useFormsToast";

export interface GuestAnswersRowRef {
  eventId: string;
  rsvpId: string | null;
  orderIds: readonly string[];
}

/** The chip before a row's other pills. Draws nothing while loading, on error, or with no form. */
export const GuestAnswersChip: React.FC<GuestAnswersRowRef> = ({ eventId, rsvpId, orderIds }) => {
  const answers = useRosterAnswers(eventId);
  if (answers.data === undefined || answers.data === null) return null;
  const state = chipForRow(answers.data, { rsvpId, orderIds });
  const label = chipLabel(state);
  if (label === null) return null;
  return (
    <Pill variant={state.kind === "answered" ? "ok" : state.kind === "not_answered" && !state.addedByHost ? "warn" : "muted"}>
      {label}
    </Pill>
  );
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/** The answers section in the guest's detail drawer: every question, read-only, with the version. */
export const GuestAnswersPanel: React.FC<GuestAnswersRowRef> = ({ eventId, rsvpId, orderIds }) => {
  const answers = useRosterAnswers(eventId);
  // Wave 4: Remind this guest (not answered) or ask again, through the send sheet.
  const [asking, setAsking] = useState(false);
  const { show, toast } = useFormsToast();
  if (answers.isLoading) return <Text style={styles.muted}>{COPY.loading}</Text>;
  if (answers.isError) {
    return (
      <View style={styles.block} accessibilityRole="alert">
        <Text style={styles.muted}>{COPY.failed}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void answers.refetch()} />
      </View>
    );
  }
  const index = answers.data;
  if (index === undefined || index === null) return null;
  const state = chipForRow(index, { rsvpId, orderIds });
  if (state.kind === "none") return null;
  if (state.kind === "not_loaded") {
    return (
      <View style={styles.block} testID="guest-answers-panel">
        <Text style={styles.title}>{`${COPY.drawerTitle} · ${index.formName}`}</Text>
        <Text style={styles.muted}>{COPY.truncated(index.page.rows.length)}</Text>
      </View>
    );
  }
  const response = state.kind === "answered" ? state.response : null;
  const version = response !== null ? index.page.versions[response.versionId] : undefined;
  const live = index.page.form.liveVersionId !== null ? index.page.versions[index.page.form.liveVersionId] : undefined;
  const def = version?.definition ?? live?.definition;
  return (
    <View style={styles.block} testID="guest-answers-panel">
      <Text style={styles.title}>{`${COPY.drawerTitle} · ${index.formName}`}</Text>
      {response !== null ? (
        <Text style={styles.muted}>
          {`${COPY.answeredOn(formatDate(response.updatedAt))} · ${
            response.earlierVersion ? COPY.earlierVersion : COPY.currentVersion
          }${response.viaLink ? ` · ${COPY.viaLink}` : ""}`}
        </Text>
      ) : (
        <Text style={styles.muted}>{chipLabel(state)}</Text>
      )}
      {index.page.form.status === "live" && (rsvpId !== null || orderIds.length > 0) ? (
        <Button
          label={response === null ? FORM_REQUEST_COPY.remindOne : FORM_REQUEST_COPY.askOne}
          variant="secondary"
          size="sm"
          onPress={() => setAsking(true)}
          testID="guest-answers-ask"
        />
      ) : null}
      {asking ? (
        <FormRequestSheet
          visible
          onClose={() => setAsking(false)}
          formId={index.page.form.id}
          eventId={eventId}
          mode={response === null ? "remind" : "ask"}
          subjects={rsvpId !== null ? [{ kind: "rsvp", id: rsvpId }] : orderIds.map((id) => ({ kind: "order" as const, id }))}
          notify={show}
        />
      ) : null}
      {toast}
      {def !== undefined
        ? [...def.questions].sort((a, b) => a.position - b.position).map((q) => {
          const text = response !== null ? answerText(q, response.answers[q.id]).trim() : "";
          return (
            <View key={q.id} style={styles.qa}>
              <Text style={styles.q}>{q.label}</Text>
              <Text style={text.length > 0 ? styles.a : styles.muted}>{text.length > 0 ? text : COPY.empty}</Text>
            </View>
          );
        })
        : null}
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  title: { ...type.row, color: color.text1 },
  qa: { gap: 2, paddingTop: space[2] },
  q: { ...type.caption, color: color.text3 },
  a: { ...type.body, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
});
