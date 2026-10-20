/**
 * issue #3281 many-dates — Host Dates list (PR 3).
 * Edit per-date title / venue via business_set_event_date_override.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
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
  spacing,
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

export default function EventDatesScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<DateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { title: string; location: string }>
  >({});

  const load = useCallback(async () => {
    if (typeof id !== "string" || id.length === 0) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("event_dates")
      .select("id, start_at, end_at, timezone, override_title, override_location")
      .eq("event_id", id)
      .order("start_at", { ascending: true });
    setLoading(false);
    if (error) {
      setToast(error.message);
      return;
    }
    const list = (data ?? []) as DateRow[];
    setRows(list);
    setDrafts((prev) => {
      const next: Record<string, { title: string; location: string }> = { ...prev };
      for (const r of list) {
        if (next[r.id] === undefined) {
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
    const d = drafts[rowId] ?? { title: "", location: "" };
    setSavingId(rowId);
    const { error } = await supabase.rpc("business_set_event_date_override", {
      p_event_id: id,
      p_event_date_id: rowId,
      p_title: d.title,
      p_location: d.location,
      p_reason: "Host updated this date's title or place for guests.",
    });
    setSavingId(null);
    if (error) {
      setToast(error.message);
      return;
    }
    setToast("Saved");
    setRows((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              override_title: d.title.trim().length > 0 ? d.title.trim() : null,
              override_location:
                d.location.trim().length > 0 ? d.location.trim() : null,
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
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.length === 0 ? (
            <Text style={styles.muted}>No dates on this event yet.</Text>
          ) : (
            rows.map((r) => {
              const d = drafts[r.id] ?? { title: "", location: "" };
              return (
                <View key={r.id} style={styles.card}>
                  <Text style={styles.when}>
                    {formatInZone(r.start_at, r.timezone)}
                  </Text>
                  <Text style={styles.label}>Title for this date</Text>
                  <TextInput
                    value={d.title}
                    onChangeText={(title) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [r.id]: { ...d, title },
                      }))
                    }
                    placeholder="Inherits event title"
                    maxLength={120}
                    style={styles.input}
                  />
                  <Text style={styles.label}>Place for this date</Text>
                  <TextInput
                    value={d.location}
                    onChangeText={(location) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [r.id]: { ...d, location },
                      }))
                    }
                    placeholder="Inherits venue"
                    maxLength={120}
                    style={styles.input}
                  />
                  <Button
                    label={savingId === r.id ? "Saving…" : "Save"}
                    onPress={() => void saveRow(r.id)}
                    disabled={savingId === r.id}
                  />
                </View>
              );
            })
          )}
          <Pressable onPress={() => void load()} style={styles.refresh}>
            <Text style={{ color: accent.warm }}>Refresh</Text>
          </Pressable>
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
  root: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.md, paddingBottom: 48 },
  card: {
    gap: 8,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D0D5DD",
  },
  when: { ...typography.body, fontWeight: "600" },
  label: { ...typography.caption, color: "#667085" },
  input: {
    borderWidth: 1,
    borderColor: "#D0D5DD",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  muted: { color: "#667085", marginTop: 16 },
  refresh: { alignSelf: "center", minHeight: 44, justifyContent: "center" },
});
