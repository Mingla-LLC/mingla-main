/**
 * EventCardInserter — sub-sheet listing the brand's events; tapping one
 * fires onSelect(eventId) with the UUID the composer body should embed
 * as `{{event:<id>}}`.
 *
 * MUST render inside the parent composer Sheet (parent owns visibility).
 */

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Sheet } from "../ui/Sheet";
import { supabase } from "../../services/supabase";
import {
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface EventCardOption {
  id: string;
  title: string;
  date_label: string | null;
  cover_image_url: string | null;
}

export interface EventCardInserterProps {
  visible: boolean;
  brandId: string | null;
  onClose: () => void;
  onSelect: (event: EventCardOption) => void;
}

export const EventCardInserter: React.FC<EventCardInserterProps> = ({
  visible,
  brandId,
  onClose,
  onSelect,
}) => {
  const [events, setEvents] = useState<EventCardOption[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || brandId === null) return;
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);
    (async () => {
      try {
        // Read from events_with_master_date_view (ORCH-0792 — events left-
        // joined with their master event_dates row). The events table has
        // no direct start_at column; cover lives in cover_media_url.
        const { data, error } = await supabase
          .from("events_with_master_date_view")
          .select("id, title, master_start_at, cover_media_url")
          .eq("brand_id", brandId)
          .is("deleted_at", null)
          .order("master_start_at", { ascending: false, nullsFirst: false })
          .limit(50);
        if (error) throw error;
        if (cancelled) return;
        const parsed = (data ?? []).map((row) => {
          const r = row as {
            id: string;
            title: string | null;
            master_start_at: string | null;
            cover_media_url: string | null;
          };
          return {
            id: r.id,
            title: r.title ?? "Untitled event",
            date_label: r.master_start_at !== null
              ? new Date(r.master_start_at).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })
              : null,
            cover_image_url: r.cover_media_url,
          };
        });
        setEvents(parsed);
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Couldn't load events",
        );
        setEvents([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, brandId]);

  return (
    <Sheet visible={visible} onClose={onClose} snapPoint="half">
      <View style={styles.host}>
        <Text style={styles.title}>Embed an event card</Text>
        <Text style={styles.subtitle}>
          Pick an event to drop a styled card into your email body.
        </Text>
        {isLoading ? (
          <View style={styles.centerHost}>
            <ActivityIndicator size="small" color={textTokens.secondary} />
          </View>
        ) : errorMessage !== null ? (
          <Text style={styles.errorText}>{errorMessage}</Text>
        ) : events === null || events.length === 0 ? (
          <View style={styles.emptyHost}>
            <Text style={styles.emptyText}>
              No events yet — create one first.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {events.map((event) => (
              <Pressable
                key={event.id}
                onPress={() => {
                  onSelect(event);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Insert event ${event.title}`}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {event.title}
                </Text>
                {event.date_label !== null ? (
                  <Text style={styles.rowDate}>{event.date_label}</Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  subtitle: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyHost: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  emptyText: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  errorText: {
    ...typography.bodySm,
    color: textTokens.secondary,
    paddingVertical: spacing.md,
  },
  list: {
    flex: 1,
    marginTop: spacing.sm,
  },
  listContent: {
    gap: spacing.xs,
    paddingBottom: spacing.lg,
  },
  row: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: 2,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowTitle: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  rowDate: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
