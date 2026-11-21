/**
 * #4514 wave 4 review — the host's delivery log: who each form request went
 * to, by text or email, and what happened (sent, on the way, failed, can't be
 * reached, not sent and why), plus the automatic reminder runs. Event manager
 * and up (the server checks). Shown on the Responses screen and in the guest
 * answers drawer; mounted only when the host opens it (so the read runs only
 * then), inside the one lazy forms owner chunk: never import it through its own
 * async boundary, that hoists the shared forms modules into __common. Never a contact or a link.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useFormRequestLog } from "../../hooks/useBrandForms";
import type { FormRequestSubject } from "../../services/brandFormRequestService";
import { logLine, logWhen } from "../../utils/formRequestLog";
import { Button } from "../ui/Button";
import { FORM_REQUEST_LOG_COPY as COPY } from "./brandFormsCopy";
import { errorSentence } from "./useFormsToast";

export interface FormRequestLogProps {
  formId: string;
  eventId: string;
  /** One guest (the answers drawer); absent: the whole page. */
  subject?: FormRequestSubject;
}

export const FormRequestLog: React.FC<FormRequestLogProps> = ({ formId, eventId, subject }) => {
  const log = useFormRequestLog({ formId, eventId, subject });
  if (log.isLoading) return <Text style={styles.muted}>{COPY.loading}</Text>;
  if (log.isError || log.data === undefined) {
    return (
      <View style={styles.block} accessibilityRole="alert">
        <Text style={styles.warn}>{errorSentence(log.error, COPY.failed)}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void log.refetch()} />
      </View>
    );
  }
  const { sends, counts, runs } = log.data;
  return (
    <View style={styles.block} testID="form-request-log">
      <Text style={styles.title} accessibilityRole="header">{COPY.title}</Text>
      {sends.length === 0 && runs.length === 0 ? (
        <Text style={styles.muted}>{COPY.empty}</Text>
      ) : (
        <Text style={styles.line}>{COPY.counts(counts.sent, counts.queued, counts.failed, counts.unreachable)}</Text>
      )}
      {runs.map((r) => (
        <Text key={`run-${r.startsAt}`} style={styles.muted}>{COPY.run(logWhen(r.startsAt), r.outcome)}</Text>
      ))}
      {sends.map((row) => (
        <Text key={row.id} style={row.status === "failed" ? styles.warn : styles.line}>
          {logLine(row)}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    gap: space[2],
    marginTop: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.tile,
  },
  title: { ...type.row, color: color.text1 },
  line: { ...type.small, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
  warn: { ...type.small, color: color.warningText },
});

export default FormRequestLog;
