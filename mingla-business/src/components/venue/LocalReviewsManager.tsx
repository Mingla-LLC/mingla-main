import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "../ui/Button";
import type { BrandLocalReview } from "../../services/localReviewsService";
import { replyState } from "./localReplyState";
import { programErrorMessage, shortDate } from "../../utils/creatorProgramFormat";
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
  // Which published reply is open for editing, and per-review outcome text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notices, setNotices] = useState<Record<string, string | null>>({});

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
    const id = review.local_month_id;
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: null }));
    setNotices((current) => ({ ...current, [id]: null }));
    try {
      const { localReviewsService } = await import("../../services/localReviewsService");
      const result = await localReviewsService.reply(brandId, id, reply);
      // A {ok:false} answer is a failure, never a success message.
      if (result && typeof result === "object" && (result as { ok?: unknown }).ok === false) {
        throw new Error(String((result as { error?: unknown }).error ?? "reply_failed"));
      }
      setEditingId(null);
      await load();
      setNotices((current) => ({ ...current, [id]: review.reply ? "Reply updated." : "Reply published. You can edit it for 24 hours." }));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setErrors((current) => ({
        ...current,
        [id]: /edit_window|locked|closed/.test(code)
          ? "The 24-hour edit window has closed, so this reply is final."
          : programErrorMessage(error, "We couldn't publish your reply. Try again."),
      }));
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
          const state = replyState(review, Date.now());
          const id = review.local_month_id;
          const showEditor = state.kind === "none" || (state.kind === "editable" && editingId === id);
          return (
            <View key={review.local_month_id} style={styles.review}>
              <View style={styles.reviewTop}>
                <Text style={styles.name}>{review.name}</Text>
                <Text style={styles.rating}>{"★".repeat(review.rating)}</Text>
              </View>
              <Text style={styles.title}>{review.title}</Text>
              <Text style={styles.body}>{review.body}</Text>
              <Text style={styles.visited}>
                Visited {shortDate(review.visited_on)}
              </Text>
              {showEditor ? (
                <>
                  <TextInput
                    value={drafts[id] ?? ""}
                    onChangeText={(value) =>
                      setDrafts((current) => ({ ...current, [id]: value.slice(0, 500) }))
                    }
                    placeholder="Write one public reply (500 characters max)"
                    placeholderTextColor={textTokens.tertiary}
                    multiline
                    maxLength={500}
                    accessibilityLabel="Place reply"
                    style={styles.input}
                  />
                  <View style={styles.actionRow}>
                    <Text style={styles.counter}>{(drafts[id] ?? "").length}/500</Text>
                    <View style={styles.buttons}>
                      {state.kind === "editable" ? (
                        <Button label="Cancel" size="sm" variant="ghost" onPress={() => { setEditingId(null); setDrafts((current) => ({ ...current, [id]: review.reply ?? "" })); }} />
                      ) : null}
                      <Button
                        label={review.reply ? "Update reply" : "Publish reply"}
                        size="sm"
                        loading={busyId === id}
                        disabled={busyId !== null || !(drafts[id] ?? "").trim() || (drafts[id] ?? "").trim() === (review.reply ?? "")}
                        onPress={() => void save(review)}
                      />
                    </View>
                  </View>
                  {state.kind === "none" ? <Text style={styles.hint}>You can reply once and edit it for 24 hours after publishing.</Text> : null}
                </>
              ) : (
                <View style={styles.closedReply}>
                  <Text style={styles.replyLabel}>YOUR PLACE REPLY</Text>
                  <Text style={styles.reply}>{review.reply}</Text>
                  {state.kind === "editable" ? (
                    <View style={styles.actionRow}>
                      <Text style={styles.closed}>{`Published · you can edit it for ${state.hoursLeft} more hour${state.hoursLeft === 1 ? "" : "s"}.`}</Text>
                      <Button label="Edit reply" size="sm" variant="secondary" onPress={() => { setEditingId(id); setDrafts((current) => ({ ...current, [id]: review.reply ?? "" })); }} />
                    </View>
                  ) : (
                    <Text style={styles.closed}>The 24-hour edit window has closed, so this reply is final.</Text>
                  )}
                </View>
              )}
              {errors[id] ? <Text style={styles.error}>{errors[id]}</Text> : null}
              {notices[id] ? <Text style={styles.notice}>{notices[id]}</Text> : null}
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
  buttons: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  hint: { color: textTokens.tertiary, fontSize: 12 },
  error: { color: semantic.errorText, fontSize: 13, fontWeight: "600" },
  notice: { color: semantic.success, fontSize: 13, fontWeight: "600" },
  closedReply: { borderRadius: 12, backgroundColor: semantic.infoTint, padding: spacing.md, gap: spacing.xs },
  replyLabel: { color: textTokens.secondary, fontWeight: "900", fontSize: 10, letterSpacing: 1 },
  reply: { color: textTokens.primary, lineHeight: 20 },
  closed: { color: textTokens.secondary, fontSize: 12 },
});
