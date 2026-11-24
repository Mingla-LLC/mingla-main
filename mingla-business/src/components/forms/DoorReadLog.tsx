/**
 * #4541 R8.3 — the host's door-read log: who opened a guest's full answers at
 * the door, and when ("Door" tab on Responses, event manager and up; the
 * server checks). Reads `brand_form_door_reads` through
 * `biz_brand_form_door_reads`, latest first. Names only: never an answer.
 *
 * Inside the one lazy forms owner (`formsOwner`): imported only by the
 * Responses screen, never through an async boundary of its own.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { useDoorReads } from "../../hooks/useBrandForms";
import type { DoorReadRow } from "../../services/brandFormsService";
import { logWhen } from "../../utils/formRequestLog";
import { Button } from "../ui/Button";
import { DOOR_READS_COPY as COPY } from "./brandFormsCopy";
import { errorSentence } from "./useFormsToast";

/** "{staff} opened {guest}'s answers · {time}". Pure; exported for tests. */
export function doorReadLine(row: DoorReadRow, when: (iso: string) => string = logWhen): string {
  const staff = row.actorName !== null && row.actorName.trim().length > 0 ? row.actorName.trim() : COPY.someone;
  const guest = row.guestName !== null && row.guestName.trim().length > 0 ? row.guestName.trim() : COPY.aGuest;
  return COPY.row(staff, guest, when(row.at));
}

export interface DoorReadLogProps {
  eventId: string;
}

export const DoorReadLog: React.FC<DoorReadLogProps> = ({ eventId }) => {
  const reads = useDoorReads(eventId);
  if (reads.isLoading) {
    return (
      <Text style={styles.muted} testID="door-read-log-loading">
        {COPY.loading}
      </Text>
    );
  }
  if (reads.isError || reads.data === undefined) {
    return (
      <View style={styles.block} accessibilityRole="alert" testID="door-read-log-error">
        <Text style={styles.warn}>{errorSentence(reads.error, COPY.failed)}</Text>
        <Button label={COPY.retry} variant="secondary" size="sm" onPress={() => void reads.refetch()} />
      </View>
    );
  }
  return (
    <View style={styles.block} testID="door-read-log">
      <Text style={styles.title} accessibilityRole="header">
        {COPY.title}
      </Text>
      {reads.data.length === 0 ? (
        <Text style={styles.muted} testID="door-read-log-empty">
          {COPY.empty}
        </Text>
      ) : (
        reads.data.map((row, i) => (
          <Text key={`${row.at}-${i}`} style={styles.line}>
            {doorReadLine(row)}
          </Text>
        ))
      )}
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
  line: { ...type.small, color: color.text1 },
  muted: { ...type.small, color: color.text3 },
  warn: { ...type.small, color: color.warningText },
});

export default DoorReadLog;
