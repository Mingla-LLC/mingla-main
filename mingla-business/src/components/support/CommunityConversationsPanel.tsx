/** #3720 Host Community Ideas and Questions sections. */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
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
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Pill } from "../ui/Pill";

const IDEA_STATUS_LABELS: Record<string, string> = {
  new: "New",
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  not_now: "Not now",
};

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

export function findSimilarIdeas(
  ideas: CommunityPost[],
  query: string,
): CommunityPost[] {
  const queryWords = normalizedWords(query);
  if (queryWords.size === 0) return [];
  return ideas
    .map((idea) => ({
      idea,
      overlap: [...queryWords].filter((word) =>
        normalizedWords(`${idea.title} ${idea.body}`).has(word)
      ).length,
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.idea.vote_count - a.idea.vote_count)
    .slice(0, 3)
    .map((candidate) => candidate.idea);
}

function PostThread(
  { post, close }: { post: CommunityPost; close: () => void },
) {
  const thread = useCommunityComments(
    post.review_state === "published" ? post.id : null,
  );
  const [reply, setReply] = useState("");
  const submitReply = async () => {
    const body = reply.trim();
    if (!body || post.locked) return;
    await thread.add(body);
    setReply("");
  };
  return (
    <GlassCard variant="elevated" radius="md" padding={spacing.md}>
      <Button label="Back to Community" variant="secondary" onPress={close} />
      <View style={styles.titleRow}>
        <Text style={styles.title}>{post.title}</Text>
        {post.pinned ? <Pill variant="warn">PINNED</Pill> : null}
      </View>
      <Text style={styles.meta}>
        {post.author_label} · {post.brand_label} · {new Date(post.created_at).toLocaleDateString()}
      </Text>
      <Text style={styles.body}>{post.body}</Text>
      {post.public_response ? (
        <View style={styles.teamResponse}>
          <Text style={styles.teamBadge}>MINGLA TEAM</Text>
          <Text style={styles.body}>{post.public_response}</Text>
        </View>
      ) : null}
      {!post.is_mine ? (
        <View style={styles.actions}>
          <Button label="Report" variant="secondary" onPress={() => void thread.report("post", post.id, "Please review this against the Community guidelines.")} />
          <Button label="Block author" variant="secondary" onPress={() => void thread.block("post", post.id)} />
        </View>
      ) : null}
      <Text style={styles.sectionLabel}>
        {post.kind === "question" ? "Answers" : "Comments"}
      </Text>
      {thread.isLoading ? <ActivityIndicator color={textTokens.secondary} /> : thread.data.length === 0 ? (
        <Text style={styles.muted}>No replies yet.</Text>
      ) : (
        <View style={styles.list}>
          {thread.data.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.titleRow}>
                <Text style={styles.meta}>{comment.author_label}</Text>
                {comment.staff_answer ? <Text style={styles.teamBadge}>MINGLA TEAM</Text> : null}
              </View>
              <Text style={styles.body}>{comment.body}</Text>
              <View style={styles.actions}>
                {post.kind === "question" && post.is_mine && post.accepted_comment_id !== comment.id ? (
                  <Button label="Accept answer" variant="secondary" onPress={() => void thread.accept(comment.id)} />
                ) : null}
                {post.accepted_comment_id === comment.id ? <Text style={styles.accepted}>Accepted answer</Text> : null}
                {!comment.is_mine ? <Button label="Report" variant="secondary" onPress={() => void thread.report("comment", comment.id, "Please review this against the Community guidelines.")} /> : null}
              </View>
            </View>
          ))}
        </View>
      )}
      {post.locked ? <Text style={styles.muted}>This conversation is closed to new replies.</Text> : (
        <>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={post.kind === "question" ? "Write an answer" : "Write a comment"}
            placeholderTextColor={textTokens.tertiary}
            multiline
            maxLength={3000}
            style={[styles.input, styles.bodyInput]}
            accessibilityLabel={post.kind === "question" ? "Answer" : "Comment"}
          />
          <Button label="Reply" loading={thread.isSaving} disabled={!reply.trim()} onPress={() => void submitReply()} />
        </>
      )}
    </GlassCard>
  );
}

function ComposerSheet({
  visible,
  kind,
  ideas,
  firstPost,
  saving,
  onClose,
  onSubmit,
  onOpenIdea,
}: {
  visible: boolean;
  kind: CommunityPostKind;
  ideas: CommunityPost[];
  firstPost: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (title: string, body: string) => Promise<void>;
  onOpenIdea: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [settledTitle, setSettledTitle] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSettledTitle(title), 600);
    return () => clearTimeout(timer);
  }, [title]);
  useEffect(() => {
    if (!visible) {
      setTitle("");
      setBody("");
      setSettledTitle("");
    }
  }, [visible]);

  const similar = useMemo(
    () => kind === "idea" ? findSimilarIdeas(ideas, settledTitle) : [],
    [ideas, kind, settledTitle],
  );
  const ready = title.trim().length >= 3 && body.trim().length >= 3 && !saving;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.composerHost, { paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={styles.composerHeader}>
          <View style={styles.headerCopy}>
            <Text style={styles.composerTitle}>{kind === "idea" ? "Suggest an idea" : "Ask a question"}</Text>
            <Text style={styles.muted}>Share enough detail for other Hosts to understand and respond.</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close composer" onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={20} color={textTokens.primary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.composerScroll, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]} keyboardShouldPersistTaps="handled">
          {firstPost ? (
            <GlassCard variant="elevated" radius="md" padding={spacing.md}>
              <Text style={styles.title}>Community guidelines</Text>
              <Text style={styles.body}>Be constructive, protect private information, and keep the conversation useful for other Hosts. Your first three posts are reviewed before everyone can see them.</Text>
            </GlassCard>
          ) : null}
          <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={textTokens.tertiary} maxLength={160} style={styles.input} accessibilityLabel="Post title" />
          {kind === "idea" && similar.length > 0 ? (
            <View style={styles.similarBox}>
              <Text style={styles.similarHeading}>Vote instead?</Text>
              {similar.map((idea) => (
                <Pressable key={idea.id} onPress={() => onOpenIdea(idea.id)} style={styles.similarRow} accessibilityRole="button" accessibilityLabel={`Open similar idea: ${idea.title}`}>
                  <Text style={styles.similarTitle} numberOfLines={2}>{idea.title}</Text>
                  <Text style={styles.meta}>{idea.vote_count} votes</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput value={body} onChangeText={setBody} placeholder={kind === "idea" ? "What would make Mingla better?" : "What would you like help with?"} placeholderTextColor={textTokens.tertiary} multiline maxLength={5000} style={[styles.input, styles.bodyInput]} accessibilityLabel="Post details" />
          <Button label={kind === "idea" ? "Suggest idea" : "Ask question"} loading={saving} disabled={!ready} onPress={() => void onSubmit(title.trim(), body.trim())} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export function CommunityConversationsPanel({
  kind,
  targetPostId,
  composeRequestKey = 0,
}: {
  kind: CommunityPostKind;
  targetPostId?: string;
  composeRequestKey?: number;
}) {
  // Legacy label marker for the renamed surface: Q&A is now Questions.
  const posts = useCommunityPosts(kind);
  const moderationActions = useCommunityComments(null);
  const [selectedId, setSelectedId] = useState<string | null>(targetPostId ?? null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const { isWideDesktop } = useResponsiveLayout();

  useEffect(() => {
    if (targetPostId) setSelectedId(targetPostId);
  }, [targetPostId]);
  useEffect(() => {
    if (composeRequestKey > 0) setComposerOpen(true);
  }, [composeRequestKey]);

  const selected = posts.data.find((post) => post.id === selectedId) ?? null;
  const firstPost = !posts.data.some((post) => post.is_mine);

  const submit = async (title: string, body: string) => {
    const reviewState = await posts.submit(title, body);
    setComposerOpen(false);
    setNotice(reviewState === "pending" ? "Submitted for review. Your first three posts are reviewed before everyone can see them." : "Published to Community.");
  };

  if (selected) return <PostThread post={selected} close={() => setSelectedId(null)} />;

  return (
    <View style={styles.list}>
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {posts.isLoading ? <ActivityIndicator color={textTokens.secondary} /> : posts.isError ? (
        <Button label="Try again" variant="secondary" onPress={() => void posts.refetch()} />
      ) : posts.data.length === 0 ? (
        <GlassCard variant="elevated" radius="md" padding={spacing.xl}>
          <View style={styles.emptyIcon}><Icon name={kind === "idea" ? "sparkle" : "chat"} size={24} color={accent.warm} /></View>
          <Text style={styles.emptyTitle}>{kind === "idea" ? "Be the first to shape Mingla" : "No questions yet"}</Text>
          <Text style={styles.emptyCopy}>{kind === "idea" ? "Suggest something that would make hosting easier. Other Hosts can vote and add context." : "Start a useful conversation with other Hosts."}</Text>
          <Button label={kind === "idea" ? "Suggest an idea" : "Ask a question"} onPress={() => setComposerOpen(true)} />
        </GlassCard>
      ) : (
        <View style={[styles.postGrid, isWideDesktop && styles.postGridWide]}>
          {posts.data.map((post) => (
            <GlassCard key={post.id} variant="elevated" radius="md" padding={spacing.md} style={isWideDesktop ? styles.postCardWide : undefined}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${post.title}`} onPress={() => setSelectedId(post.id)}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{post.title}</Text>
                  {post.review_state !== "published" ? <Text style={styles.pending}>{post.review_state === "pending" ? "In review" : "Needs attention"}</Text> : kind === "idea" ? <Pill variant={post.workflow_status === "shipped" ? "live" : "info"}>{IDEA_STATUS_LABELS[post.workflow_status ?? "new"] ?? "New"}</Pill> : post.staff_answered ? <Pill variant="live">ANSWERED</Pill> : null}
                </View>
                <Text numberOfLines={3} style={styles.body}>{post.body}</Text>
                <Text style={styles.meta}>{post.author_label} · {post.brand_label} · {post.comment_count} {kind === "question" ? "answers" : "comments"}</Text>
              </Pressable>
              {post.review_state === "published" ? <Button label={`${post.voted_by_me ? "Voted" : "Vote"} · ${post.vote_count}`} variant="secondary" onPress={() => void posts.toggleVote(post.id)} /> : post.is_mine && post.review_state !== "pending" ? <Button label="Appeal decision" variant="secondary" onPress={() => void moderationActions.appeal("post", post.id, "Please review this decision again.")} /> : null}
            </GlassCard>
          ))}
        </View>
      )}
      <ComposerSheet visible={composerOpen} kind={kind} ideas={kind === "idea" ? posts.data : []} firstPost={firstPost} saving={posts.isSaving} onClose={() => setComposerOpen(false)} onSubmit={submit} onOpenIdea={(id) => { setComposerOpen(false); setSelectedId(id); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  postGrid: { gap: spacing.md },
  postGridWide: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  postCardWide: { flexBasis: "48%", flexGrow: 1, minWidth: 320 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  headerCopy: { flex: 1, minWidth: 0 },
  heading: { fontSize: 20, fontWeight: "800", color: textTokens.primary },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: textTokens.tertiary },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: textTokens.primary, marginBottom: spacing.sm },
  body: { fontSize: 14, lineHeight: 20, color: textTokens.secondary, marginBottom: spacing.sm },
  meta: { fontSize: 12, color: textTokens.tertiary, marginBottom: spacing.sm },
  input: { minHeight: 46, borderWidth: 1, borderColor: glass.border.profileElevated, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: textTokens.primary, marginBottom: spacing.sm, letterSpacing: 0 },
  bodyInput: { minHeight: 120, textAlignVertical: "top" },
  pending: { fontSize: 11, fontWeight: "700", color: accent.warm },
  notice: { color: textTokens.secondary, fontSize: 12 },
  muted: { color: textTokens.secondary, fontSize: 13 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  comment: { borderTopWidth: 1, borderTopColor: glass.border.profileElevated, paddingTop: spacing.sm },
  accepted: { color: accent.warm, fontWeight: "700", fontSize: 12 },
  teamResponse: { borderLeftWidth: 3, borderLeftColor: accent.warm, paddingLeft: spacing.md, marginBottom: spacing.md },
  teamBadge: { color: accent.warm, fontSize: 10, fontWeight: "800", letterSpacing: 0 },
  composerHost: { flex: 1, backgroundColor: canvas.profile },
  composerHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  composerTitle: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: glass.border.profileElevated },
  composerScroll: { width: "100%", maxWidth: 760, alignSelf: "center", padding: spacing.md, gap: spacing.md },
  similarBox: { borderWidth: 1, borderColor: accent.border, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  similarHeading: { color: accent.warm, fontSize: 12, fontWeight: "800" },
  similarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingVertical: spacing.xs },
  similarTitle: { flex: 1, color: textTokens.primary, fontSize: 13, fontWeight: "600" },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: accent.tint, marginBottom: spacing.md },
  emptyTitle: { color: textTokens.primary, fontSize: 18, fontWeight: "800", marginBottom: spacing.xs },
  emptyCopy: { color: textTokens.secondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
});
