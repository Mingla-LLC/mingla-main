/**
 * #4522 / DISC-0893 — the first thing the 4-step trip builder shows on a new
 * trip. Nothing is stored on the server until the host names the trip: opening
 * "New trip" and backing out leaves no empty draft behind (the 8-step wizard
 * created the server draft the moment the screen mounted).
 *
 * The draft is created with the typed title, so the builder opens on step 1 with
 * the name already in place. A failed create is said on this screen, with a way
 * to try again; nothing is swallowed.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { color, radius, space, type } from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

export const TRIP_START_FAILED_MESSAGE =
  "We couldn't start this trip. Check your connection and try again.";

export interface TripStartGateProps {
  brandName: string;
  /** Creates the server draft with this title; rejects when it could not. */
  onStart: (title: string) => Promise<void>;
  onCancel: () => void;
}

export const TripStartGate: React.FC<TripStartGateProps> = ({
  brandName,
  onStart,
  onCancel,
}) => {
  const [title, setTitle] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [failed, setFailed] = useState<boolean>(false);
  const trimmed = title.trim();

  const submit = useCallback(async (): Promise<void> => {
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onStart(trimmed);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }, [trimmed, busy, onStart]);

  return (
    <View style={styles.host}>
      <GlassCard variant="elevated" padding={space[6]} radius="xl" contentStyle={styles.card}>
        <Text style={styles.eyebrow}>{brandName}</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Name your trip
        </Text>
        <Text style={styles.body}>
          Nothing is saved until you do. You can change it any time.
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={() => {
            void submit();
          }}
          placeholder="e.g. Tulum Yoga Retreat"
          placeholderTextColor={color.text3}
          editable={!busy}
          autoFocus
          returnKeyType="go"
          accessibilityLabel="Trip title"
          style={styles.input}
          testID="trip-start-title"
        />
        {failed ? (
          <Text style={styles.error} accessibilityRole="alert" testID="trip-start-error">
            {TRIP_START_FAILED_MESSAGE}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Button
            label="Cancel"
            variant="ghost"
            size="md"
            onPress={onCancel}
            disabled={busy}
            testID="trip-start-cancel"
          />
          <Button
            label={busy ? "Starting…" : failed ? "Try again" : "Start planning"}
            variant="primary"
            size="md"
            onPress={() => {
              void submit();
            }}
            loading={busy}
            disabled={busy || trimmed.length === 0}
            testID="trip-start-submit"
          />
        </View>
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space[5],
    backgroundColor: color.canvas,
  },
  card: {
    gap: space[4],
    width: "100%",
    maxWidth: 480,
  },
  eyebrow: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: color.text3,
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  body: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: color.text2,
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.lineStrong,
    color: color.text1,
    fontSize: type.body.fontSize,
  },
  error: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: color.danger,
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space[3],
  },
});
