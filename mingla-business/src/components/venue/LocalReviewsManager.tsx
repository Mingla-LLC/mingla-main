import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "../ui/Button";
import type { BrandLocalReview } from "../../services/localReviewsService";
import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

type Props = { brandId: string; placePoolId: string };

export function LocalReviewsManager({ brandId, placePoolId }: Props): React.ReactElement | null {
  const [reviews, setReviews] = useState<BrandLocalReview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const { localReviewsService } = await import("../../services/localReviewsService");
    const next = await localReviewsService.forClaimedPlace(brandId, placePoolId);
    setReviews(next);
    setDrafts((current) => {
      const merged = { ...current };
      for (const review of next) {
        if (merged[review.local_month_id] === undefined) {
          merged[review.local_month_id] = review.reply ?? "";
        }
      }
      return merged;
    });
  }, [brandId, placePoolId]);

  useEffect(() => {
    void load().catch(() => {
      // This optional public-review module stays absent if its scoped read is unavailable.
    });
  }, [load]);

  const save = async (review: BrandLocalReview): Promise<void> => {
    const reply = drafts[review.local_month_id]?.trim() ?? "";
    if (!reply) return;
    setBusyId(review.local_month_id);
    try {
      const { localReviewsService } = await import("../../services/localReviewsService");
      await localReviewsService.reply(brandId, review.local_month_id, reply);
      await load();
      Alert.alert("Reply published", "Your place reply is now visible with this Local review.");
    } catch (error) {
      Alert.alert(
        "Couldn’t publish reply",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (reviews.length === 0) return null;

  return (
    <View style={styles.wrap} testID="venue-local-reviews-manager">
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.grow}>
            <Text style={styles.eyebrow}>MINGLA LOCAL REVIEWS</Text>
            <Text style={styles.heading}>Reply as this place</Text>
          </View>
          <Text style={styles.count}>{reviews.length}</Text>
        </View>
        <Text style={styles.explainer}>
          Local visits are independent and cannot be bought or approved by a place.
          You may publish one factual reply and edit it for 24 hours.
        </Text>
        {reviews.map((review) => {
          const editable =
            review.reply_at === null ||
            (review.reply_editable_until !== null &&
              new Date(review.reply_editable_until).getTime() > Date.now());
          return (
            <View key={review.local_month_id} style={styles.review}>
              <View style={styles.reviewTop}>
                <Text style={styles.name}>{review.name}</Text>
                <Text style={styles.rating}>{"★".repeat(review.rating)}</Text>
              </View>
              <Text style={styles.title}>{review.title}</Text>
              <Text style={styles.body}>{review.body}</Text>
              <Text style={styles.visited}>
                Visited {new Date(review.visited_on).toLocaleDateString()}
              </Text>
              {editable ? (
                <>
                  <TextInput
                    value={drafts[review.local_month_id] ?? ""}
                    onChangeText={(value) =>
                      setDrafts((current) => ({
                        ...current,
                        [review.local_month_id]: value.slice(0, 500),
                      }))
                    }
                    placeholder="Write one public reply (500 characters max)"
                    placeholderTextColor={textTokens.tertiary}
                    multiline
                    maxLength={500}
                    accessibilityLabel="Place reply"
                    style={styles.input}
                  />
                  <View style={styles.actionRow}>
                    <Text style={styles.counter}>
                      {(drafts[review.local_month_id] ?? "").length}/500
                    </Text>
                    <Button
                      label={review.reply ? "Update reply" : "Publish reply"}
                      size="sm"
                      loading={busyId === review.local_month_id}
                      disabled={
                        busyId !== null ||
                        !(drafts[review.local_month_id] ?? "").trim()
                      }
                      onPress={() => void save(review)}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.closedReply}>
                  <Text style={styles.replyLabel}>YOUR PLACE REPLY</Text>
                  <Text style={styles.reply}>{review.reply}</Text>
                  <Text style={styles.closed}>The 24-hour edit window has closed.</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  card: { padding: spacing.lg, gap: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.border.profileBase, backgroundColor: glass.tint.profileBase },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  grow: { flex: 1, gap: spacing.xs },
  eyebrow: { color: accent.warm, fontWeight: "900", fontSize: 11, letterSpacing: 1.2 },
  heading: { color: textTokens.primary, fontWeight: "900", fontSize: 20 },
  count: { color: accent.warm, fontWeight: "900", fontSize: 20 },
  explainer: { color: textTokens.secondary, lineHeight: 20 },
  review: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: textTokens.tertiary, paddingTop: spacing.md, gap: spacing.sm },
  reviewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  name: { flex: 1, color: textTokens.primary, fontWeight: "900" },
  rating: { color: accent.warm, letterSpacing: 1 },
  title: { color: textTokens.primary, fontWeight: "800", fontSize: 16 },
  body: { color: textTokens.secondary, lineHeight: 20 },
  visited: { color: textTokens.tertiary, fontSize: 12 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileElevated,
    color: textTokens.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlignVertical: "top",
  },
  actionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  counter: { color: textTokens.tertiary, fontSize: 12 },
  closedReply: { borderRadius: 12, backgroundColor: semantic.infoTint, padding: spacing.md, gap: spacing.xs },
  replyLabel: { color: textTokens.secondary, fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  reply: { color: textTokens.primary, lineHeight: 20 },
  closed: { color: textTokens.secondary, fontSize: 12 },
});
