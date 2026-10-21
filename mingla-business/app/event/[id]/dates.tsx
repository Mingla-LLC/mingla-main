/**
 * issue #3281 many-dates — Host Dates list (PR 3 + dark-theme follow-up).
 * Edit per-date title / venue via business_set_event_date_override.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892: ScrollView via SmartScrollView (keyboard-aware), not bare RN.
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TopBar } from "../../../src/components/ui/TopBar";
import { Button } from "../../../src/components/ui/Button";
import { Toast } from "../../../src/components/ui/Toast";
import { supabase } from "../../../src/services/supabase";
import {
  accent,
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";

type DateRow = {
  id: string;
  start_at: string;
  end_at: string;
  timezone: string | null;
  override_title: string | null;
  override_location: string | null;
};

const formatInZone = (iso: string, zone: string | null): string => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone && zone.length > 0 ? zone : "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const isPastEnd = (endAt: string, nowMs: number): boolean => {
  const end = Date.parse(endAt);
  return Number.isFinite(end) && end <= nowMs;
};

export default function EventDatesScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<DateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { title: string; location: string }>
  >({});
  /** Row ids with unsaved local edits — refresh keeps these, reloads the rest. */
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const nowMs = useMemo(() => Date.now(), [rows]);

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (typeof id !== "string" || id.length === 0) {
      setLoading(false);
      return;
    }
    if (opts?.soft === true) setRefreshing(true);
    else setLoading(true);
    const { data, error } = await supabase
      .from("event_dates")
      .select("id, start_at, end_at, timezone, override_title, override_location")
      .eq("event_id", id)
      .order("start_at", { ascending: true });
    if (opts?.soft === true) setRefreshing(false);
    else setLoading(false);
    if (error) {
      setToast(error.message);
      return;
    }
    const list = (data ?? []) as DateRow[];
    const dirty = dirtyIdsRef.current;
    setRows(list);
    setDrafts((prev) => {
      const next: Record<string, { title: string; location: string }> = {};
      for (const r of list) {
        if (dirty.has(r.id) && prev[r.id] !== undefined) {
          next[r.id] = prev[r.id]!;
        } else {
          next[r.id] = {
            title: r.override_title ?? "",
            location: r.override_location ?? "",
          };
        }
      }
      return next;
    });
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveRow = async (rowId: string) => {
    if (typeof id !== "string") return;
    const row = rows.find((r) => r.id === rowId);
    if (row !== undefined && isPastEnd(row.end_at, Date.now())) {
      setToast("Past dates can’t be edited.");
      return;
    }
    const d = drafts[rowId] ?? { title: "", location: "" };
    const saved = { title: d.title, location: d.location };
    setSavingId(rowId);
    const { error } = await supabase.rpc("business_set_event_date_override", {
      p_event_id: id,
      p_event_date_id: rowId,
      p_title: saved.title,
      p_location: saved.location,
      p_reason: "Host updated this date's title or place for guests.",
    });
    setSavingId(null);
    if (error) {
      setToast(error.message);
      return;
    }
    setToast("Saved");
    // Keep dirty if the organiser typed more while the request was in flight.
    const latest = draftsRef.current[rowId] ?? saved;
    if (latest.title === saved.title && latest.location === saved.location) {
      dirtyIdsRef.current.delete(rowId);
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              override_title:
                saved.title.trim().length > 0 ? saved.title.trim() : null,
              override_location:
                saved.location.trim().length > 0 ? saved.location.trim() : null,
            }
          : r,
      ),
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        leftKind="back"
        title="Dates"
        onBack={() => router.back()}
        rightSlot={null}
      />
      {loading ? (
        <ActivityIndicator color={accent.warm} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load({ soft: true })}
              tintColor={accent.warm}
            />
          }
        >
          <Text style={styles.note}>
            Titles and places you save here show on the guest date picker when
            guests choose days.
          </Text>
          {rows.length === 0 ? (
            <Text style={styles.muted}>No dates on this event yet.</Text>
          ) : (
            rows.map((r) => {
              const d = drafts[r.id] ?? { title: "", location: "" };
              const past = isPastEnd(r.end_at, nowMs);
              return (
                <View key={r.id} style={styles.card}>
                  <Text style={styles.when}>
                    {formatInZone(r.start_at, r.timezone)}
                    {past ? " · ended" : ""}
                  </Text>
                  <Text style={styles.label}>Title for this date</Text>
                  <TextInput
                    value={d.title}
                    editable={!past && savingId === null}
                    onChangeText={(title) => {
                      dirtyIdsRef.current.add(r.id);
                      setDrafts((prev) => ({
                        ...prev,
                        [r.id]: { ...d, title },
                      }));
                    }}
                    placeholder="Inherits event title"
                    placeholderTextColor={textTokens.quaternary}
                    maxLength={120}
                    style={[styles.input, past ? styles.inputDisabled : null]}
                  />
                  <Text style={styles.label}>Place for this date</Text>
                  <TextInput
                    value={d.location}
                    editable={!past && savingId === null}
                    onChangeText={(location) => {
                      dirtyIdsRef.current.add(r.id);
                      setDrafts((prev) => ({
                        ...prev,
                        [r.id]: { ...d, location },
                      }));
                    }}
                    placeholder="Inherits venue"
                    placeholderTextColor={textTokens.quaternary}
                    maxLength={120}
                    style={[styles.input, past ? styles.inputDisabled : null]}
                  />
                  {past ? (
                    <Text style={styles.mutedInline}>
                      Past dates are read-only.
                    </Text>
                  ) : (
                    <Button
                      label={savingId === r.id ? "Saving…" : "Save"}
                      onPress={() => void saveRow(r.id)}
                      // One in-flight save at a time: a second row's save must not
                      // re-enable this row while its request is still pending.
                      disabled={savingId !== null}
                    />
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
      <Toast
        visible={toast !== null}
        kind="info"
        message={toast ?? ""}
        onDismiss={() => setToast(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: canvas.discover },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: 48 },
  note: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginBottom: 4,
  },
  card: {
    gap: 8,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  when: {
    ...typography.body,
    fontWeight: "600",
    color: textTokens.primary,
  },
  label: { ...typography.caption, color: textTokens.tertiary },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    color: textTokens.primary,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  inputDisabled: { opacity: 0.55 },
  muted: { color: textTokens.tertiary, marginTop: 16 },
  mutedInline: { color: textTokens.tertiary, marginTop: 4 },
});
