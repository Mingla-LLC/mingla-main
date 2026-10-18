import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  useCommunityComments,
  useCommunityPosts,
} from "../../hooks/useCommunity";
import type {
  CommunityPost,
  CommunityPostKind,
} from "../../services/communityService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

function PostThread(
  { post, close }: { post: CommunityPost; close: () => void },
) {
  const thread = useCommunityComments(
    post.review_state === "published" ? post.id : null,
  );
  const [reply, setReply] = useState("");
  const submitReply = async () => {
    const body = reply.trim();
    if (!body) return;
    await thread.add(body);
    setReply("");
  };
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.md}>
      <Button label="Back to Community" variant="secondary" onPress={close} />
      <Text style={styles.title}>{post.title}</Text>
      <Text style={styles.meta}>
        {post.author_label} · {new Date(post.created_at).toLocaleDateString()}
      </Text>
      <Text style={styles.body}>{post.body}</Text>
      {!post.is_mine
        ? (
          <View style={styles.actions}>
            <Button
              label="Report"
              variant="secondary"
              onPress={() =>
                void thread.report(
                  "post",
                  post.id,
                  "Please review this against the Community guidelines.",
                )}
            />
            <Button
              label="Block author"
              variant="secondary"
              onPress={() => void thread.block("post", post.id)}
            />
          </View>
        )
        : null}
      <Text style={styles.sectionLabel}>
        {post.kind === "question" ? "Answers" : "Comments"}
      </Text>
      {thread.isLoading
        ? <ActivityIndicator color={textTokens.secondary} />
        : thread.data.length === 0
        ? <Text style={styles.muted}>No replies yet.</Text>
        : (
          <View style={styles.list}>
            {thread.data.map((comment) => (
              <View key={comment.id} style={styles.comment}>
                <Text style={styles.meta}>{comment.author_label}</Text>
                <Text style={styles.body}>{comment.body}</Text>
                <View style={styles.actions}>
                  {post.kind === "question" && post.is_mine &&
                      post.accepted_comment_id !== comment.id
                    ? (
                      <Button
                        label="Accept answer"
                        variant="secondary"
                        onPress={() => void thread.accept(comment.id)}
                      />
                    )
                    : null}
                  {post.accepted_comment_id === comment.id
                    ? <Text style={styles.accepted}>Accepted answer</Text>
                    : null}
                  {!comment.is_mine
                    ? (
                      <Button
                        label="Report"
                        variant="secondary"
                        onPress={() =>
                          void thread.report(
                            "comment",
                            comment.id,
                            "Please review this against the Community guidelines.",
                          )}
                      />
                    )
                    : null}
                </View>
              </View>
            ))}
          </View>
        )}
      <TextInput
        value={reply}
        onChangeText={setReply}
        placeholder={post.kind === "question"
          ? "Write an answer"
          : "Write a comment"}
        placeholderTextColor={textTokens.tertiary}
        multiline
        maxLength={3000}
        style={[styles.input, styles.bodyInput]}
        accessibilityLabel={post.kind === "question" ? "Answer" : "Comment"}
      />
      <Button
        label="Reply"
        loading={thread.isSaving}
        disabled={!reply.trim()}
        onPress={() => void submitReply()}
      />
    </GlassCard>
  );
}

export function CommunityConversationsPanel(
  { targetPostId }: { targetPostId?: string },
) {
  const [kind, setKind] = useState<CommunityPostKind>("idea");
  const ideas = useCommunityPosts("idea");
  const questions = useCommunityPosts("question");
  const posts = kind === "idea" ? ideas : questions;
  const moderationActions = useCommunityComments(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    targetPostId ?? null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (targetPostId) setSelectedId(targetPostId);
  }, [targetPostId]);
  const selected = useMemo(
    () =>
      [...ideas.data, ...questions.data].find((post) =>
        post.id === selectedId
      ) ?? null,
    [ideas.data, questions.data, selectedId],
  );

  const submit = async () => {
    const reviewState = await posts.submit(title.trim(), body.trim());
    setTitle("");
    setBody("");
    setNotice(
      reviewState === "pending"
        ? "Submitted for review. Your first three posts are reviewed before everyone can see them."
        : "Published to Community.",
    );
  };

  if (selected) {
    return (
      <PostThread
        post={selected}
        close={() => setSelectedId(null)}
      />
    );
  }

  return (
    <View style={styles.list}>
      <Text style={styles.sectionLabel}>Host Community</Text>
      <View style={styles.tabs}>
        {(["idea", "question"] as CommunityPostKind[]).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === value }}
            onPress={() => {
              setKind(value);
              setSelectedId(null);
            }}
            style={[styles.tab, kind === value && styles.tabSelected]}
          >
            <Text
              style={[styles.tabText, kind === value && styles.tabTextSelected]}
            >
              {value === "idea" ? "Ideas" : "Q&A"}
            </Text>
          </Pressable>
        ))}
      </View>
      <GlassCard variant="elevated" radius="md" padding={spacing.md}>
        <Text style={styles.title}>
          {kind === "idea" ? "Share an idea" : "Ask other Hosts"}
        </Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title"
          placeholderTextColor={textTokens.tertiary}
          maxLength={160}
          style={styles.input}
          accessibilityLabel="Post title"
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={kind === "idea"
            ? "What would make Mingla better?"
            : "What would you like help with?"}
          placeholderTextColor={textTokens.tertiary}
          multiline
          maxLength={5000}
          style={[styles.input, styles.bodyInput]}
          accessibilityLabel="Post details"
        />
        {notice
          ? (
            <Text accessibilityRole="alert" style={styles.notice}>
              {notice}
            </Text>
          )
          : null}
        <Button
          label={kind === "idea" ? "Share idea" : "Ask question"}
          loading={posts.isSaving}
          disabled={title.trim().length < 3 || body.trim().length < 3}
          onPress={() => void submit()}
        />
      </GlassCard>
      {posts.isLoading
        ? <ActivityIndicator color={textTokens.secondary} />
        : posts.isError
        ? (
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void posts.refetch()}
          />
        )
        : posts.data.length === 0
        ? (
          <Text style={styles.muted}>
            No {kind === "idea" ? "ideas" : "questions"} yet.
          </Text>
        )
        : posts.data.map((post) => (
          <GlassCard
            key={post.id}
            variant="elevated"
            radius="md"
            padding={spacing.md}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${post.title}`}
              onPress={() => setSelectedId(post.id)}
            >
              <View style={styles.row}>
                <Text style={styles.title}>{post.title}</Text>
                {post.review_state !== "published"
                  ? (
                    <Text style={styles.pending}>
                      {post.review_state === "pending"
                        ? "In review"
                        : "Needs attention"}
                    </Text>
                  )
                  : null}
              </View>
              <Text numberOfLines={3} style={styles.body}>{post.body}</Text>
              <Text style={styles.meta}>
                {post.author_label} · {post.comment_count}{" "}
                {post.kind === "question" ? "answers" : "comments"}
              </Text>
            </Pressable>
            {post.review_state === "published"
              ? (
                <Button
                  label={`${
                    post.voted_by_me ? "Voted" : "Vote"
                  } · ${post.vote_count}`}
                  variant="secondary"
                  onPress={() => void posts.toggleVote(post.id)}
                />
              )
              : post.is_mine && post.review_state !== "pending"
              ? (
                <Button
                  label="Appeal decision"
                  variant="secondary"
                  onPress={() =>
                    void moderationActions.appeal(
                      "post",
                      post.id,
                      "Please review this decision again.",
                    )}
                />
              )
              : null}
          </GlassCard>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.tertiary,
    letterSpacing: 0.4,
  },
  tabs: { flexDirection: "row", gap: spacing.sm },
  tab: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  tabSelected: { backgroundColor: accent.warm, borderColor: accent.warm },
  tabText: { fontSize: 14, fontWeight: "700", color: textTokens.secondary },
  tabTextSelected: { color: "#ffffff" },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  meta: { fontSize: 12, color: textTokens.tertiary, marginBottom: spacing.sm },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: textTokens.primary,
    marginBottom: spacing.sm,
  },
  bodyInput: { minHeight: 96, textAlignVertical: "top" },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  pending: { fontSize: 11, fontWeight: "700", color: accent.warm },
  notice: {
    color: textTokens.secondary,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  muted: { color: textTokens.secondary, fontSize: 13 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  comment: {
    borderTopWidth: 1,
    borderTopColor: glass.border.profileElevated,
    paddingTop: spacing.sm,
  },
  accepted: { color: accent.warm, fontWeight: "700", fontSize: 12 },
});
