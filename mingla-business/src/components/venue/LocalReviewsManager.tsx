import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { SheetBody } from "../programs/ProgramKit";
import type { BrandLocalReview } from "../../services/localReviewsService";
import { replyState } from "./localReplyState";
import {
  programErrorMessage,
  shortDate,
} from "../../utils/creatorProgramFormat";
import {
  radius,
  color,
  space,
  edge,
} from "../../constants/designSystem";

type Props = { brandId: string; placePoolId: string };

/*
 * #3872 round 2 (H2.7, keyboard rule): the reply is written in a sheet whose
 * body is the keyboard-aware program SheetBody, so the field stays just above
 * the keyboard and the Publish button (its footer) hides while typing. The
 * page itself has no keyboard-aware scroll, which is why the inline editor
 * was covered by the keyboard.
 */

export function LocalReviewsManager({
  brandId,
  placePoolId,
}: Props): React.ReactElement | null {
  const [reviews, setReviews] = useState<BrandLocalReview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which published reply is open for editing, and per-review outcome text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [notices, setNotices] = useState<Record<string, string | null>>({});

  const load = useCallback(async (): Promise<void> => {
    const { localReviewsService } =
      await import("../../services/localReviewsService");
    const next = await localReviewsService.forClaimedPlace(
      brandId,
      placePoolId,
    );
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
      const { localReviewsService } =
        await import("../../services/localReviewsService");
      const result = await localReviewsService.reply(brandId, id, reply);
      // A {ok:false} answer is a failure, never a success message.
      if (
        result &&
        typeof result === "object" &&
        (result as { ok?: unknown }).ok === false
      ) {
        throw new Error(
          String((result as { error?: unknown }).error ?? "reply_failed"),
        );
      }
      setEditingId(null);
      await load();
      setNotices((current) => ({
        ...current,
        [id]: review.reply
          ? "Reply updated."
          : "Reply published. You can edit it for 24 hours.",
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setErrors((current) => ({
        ...current,
        [id]: /edit_window|locked|closed/.test(code)
          ? "The 24-hour edit window has closed, so this reply is final."
          : programErrorMessage(
              error,
              "We couldn't publish your reply. Try again.",
            ),
      }));
    } finally {
      setBusyId(null);
    }
  };

  if (reviews.length === 0) return null;
  const editingReview =
    editingId === null
      ? null
      : (reviews.find((review) => review.local_month_id === editingId) ?? null);
  const editingDraft = editingReview
    ? (drafts[editingReview.local_month_id] ?? "")
    : "";

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
          Local visits are independent and cannot be bought or approved by a
          place. You may publish one factual reply and edit it for 24 hours.
        </Text>
        {reviews.map((review) => {
          const state = replyState(review, Date.now());
          const id = review.local_month_id;
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
              {state.kind === "none" ? (
                <>
                  <Button
                    label="Write a reply"
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setErrors((current) => ({ ...current, [id]: null }));
                      setEditingId(id);
                    }}
                  />
                  <Text style={styles.hint}>
                    You can reply once and edit it for 24 hours after
                    publishing.
                  </Text>
                </>
              ) : (
                <View style={styles.closedReply}>
                  <Text style={styles.replyLabel}>YOUR PLACE REPLY</Text>
                  <Text style={styles.reply}>{review.reply}</Text>
                  {state.kind === "editable" ? (
                    <View style={styles.actionRow}>
                      <Text
                        style={styles.closed}
                      >{`Published · you can edit it for ${state.hoursLeft} more hour${state.hoursLeft === 1 ? "" : "s"}.`}</Text>
                      <Button
                        label="Edit reply"
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          setEditingId(id);
                          setDrafts((current) => ({
                            ...current,
                            [id]: review.reply ?? "",
                          }));
                        }}
                      />
                    </View>
                  ) : (
                    <Text style={styles.closed}>
                      The 24-hour edit window has closed, so this reply is
                      final.
                    </Text>
                  )}
                </View>
              )}
              {errors[id] ? (
                <Text style={styles.error}>{errors[id]}</Text>
              ) : null}
              {notices[id] ? (
                <Text style={styles.notice}>{notices[id]}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {editingReview ? (
        <Sheet visible onClose={() => setEditingId(null)} snapPoint="full">
          <SheetBody
            title={editingReview.reply ? "Edit your reply" : "Reply as this place"}
            footer={
              <View style={styles.buttons}>
                <Button
                  label="Cancel"
                  size="md"
                  variant="ghost"
                  onPress={() => {
                    setEditingId(null);
                    setDrafts((current) => ({
                      ...current,
                      [editingReview.local_month_id]: editingReview.reply ?? "",
                    }));
                  }}
                />
                <Button
                  label={editingReview.reply ? "Update reply" : "Publish reply"}
                  size="md"
                  loading={busyId === editingReview.local_month_id}
                  disabled={
                    busyId !== null ||
                    !editingDraft.trim() ||
                    editingDraft.trim() === (editingReview.reply ?? "")
                  }
                  onPress={() => void save(editingReview)}
                />
              </View>
            }
          >
            <Text style={styles.title}>{editingReview.title}</Text>
            <TextInput
              value={editingDraft}
              onChangeText={(value) =>
                setDrafts((current) => ({
                  ...current,
                  [editingReview.local_month_id]: value.slice(0, 500),
                }))
              }
              placeholder="Write one public reply (500 characters max)"
              placeholderTextColor={color.text3}
              multiline
              maxLength={500}
              autoFocus
              accessibilityLabel="Place reply"
              style={styles.input}
            />
            <Text style={styles.counter}>{`${editingDraft.length}/500`}</Text>
            {errors[editingReview.local_month_id] ? (
              <Text style={styles.error}>
                {errors[editingReview.local_month_id]}
              </Text>
            ) : null}
          </SheetBody>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space[4], paddingBottom: space[2] },
  card: {
    padding: space[6],
    gap: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: space[4] },
  grow: { flex: 1, gap: space[1] },
  eyebrow: {
    color: color.accent,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.2,
  },
  heading: { color: color.text1, fontWeight: "900", fontSize: 20 },
  count: { color: color.accent, fontWeight: "900", fontSize: 20 },
  explainer: { color: color.text2, lineHeight: 20 },
  review: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.text3,
    paddingTop: space[4],
    gap: space[2],
  },
  reviewTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  name: { flex: 1, color: color.text1, fontWeight: "900" },
  rating: { color: color.accent, letterSpacing: 1 },
  title: { color: color.text1, fontWeight: "800", fontSize: 16 },
  body: { color: color.text2, lineHeight: 20 },
  visited: { color: color.text3, fontSize: 12 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: edge.ringInputFocus.borderColor,
    borderRadius: radius.md,
    backgroundColor: color.fill.tile,
    color: color.text1,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    textAlignVertical: "top",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[2],
  },
  counter: { color: color.text3, fontSize: 12 },
  buttons: { flexDirection: "row", gap: space[2], alignItems: "center" },
  hint: { color: color.text3, fontSize: 12 },
  error: { color: color.errorText, fontSize: 13, fontWeight: "600" },
  notice: { color: color.success, fontSize: 13, fontWeight: "600" },
  closedReply: {
    borderRadius: 12,
    backgroundColor: color.infoTint,
    padding: space[4],
    gap: space[1],
  },
  replyLabel: {
    color: color.text2,
    fontWeight: "900",
    fontSize: 10,
    letterSpacing: 1,
  },
  reply: { color: color.text1, lineHeight: 20 },
  closed: { color: color.text2, fontSize: 12 },
});
