/**
 * #3355 — local-only production Ari conversation.
 *
 * This is intentionally one real MessageList + InputBar thread. Every fixture
 * is serialized through the same structured-message contract that a server
 * response uses, so browser and simulator QA exercise production rendering,
 * interaction, scrolling, grouping, and composer behavior.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  ariPalette,
  ariThread,
  canvas,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { AriOrb } from "../../components/ari/AriOrb";
import { AiDisclosureModal } from "../../components/ari/AiDisclosureModal";
import { InputBar } from "../../components/ari/InputBar";
import { MessageList } from "../../components/ari/MessageList";
import { Button } from "../../components/ui/Button";
import type { AgentMessage } from "../../services/agentChatService";
import {
  ARI_RENDITION_FIXTURES,
  ARI_RENDITION_GROUPS,
  ARI_RENDITION_TOTAL,
  type AriRenditionFixture,
  type AriRenditionGroup,
} from "../../components/ari/renditions/ariRenditionCatalog";
import {
  buildAriRenditionExample,
  type AriRenditionInteraction,
} from "../../components/ari/renditions/AriRenditionPreview";
import {
  ariRenditionCopyText,
  buildAriRenditionSubmission,
} from "../../components/ari/renditions/ariRenditionProtocol";

function harnessMessage(
  id: string,
  role: "user" | "assistant",
  content: AgentMessage["content"],
  offset: number,
): AgentMessage {
  return {
    id,
    conversation_id: "local-rendition-thread",
    role,
    content,
    client_turn_id: null,
    tool_calls: null,
    tool_results: null,
    created_at: new Date(Date.UTC(2026, 9, 29, 12, offset)).toISOString(),
  };
}

function buildThreadMessages(
  fixtures: readonly AriRenditionFixture[],
): AgentMessage[] {
  return fixtures.flatMap((fixture, index) => {
    const example = buildAriRenditionExample(fixture);
    const ordinal = String(index + 1).padStart(2, "0");
    const userMessage =
      example.userMessage ??
      `Show me the ${fixture.title.toLowerCase()} state.`;
    return [
      harnessMessage(
        `${fixture.id}-user`,
        "user",
        { text: `${ordinal} / ${fixtures.length} · ${userMessage}` },
        index * 2,
      ),
      harnessMessage(
        `${fixture.id}-ari`,
        "assistant",
        { text: "", structured: { rendition: example.rendition } },
        index * 2 + 1,
      ),
    ];
  });
}

const AriProductionThread: React.FC<{
  fixtures: readonly AriRenditionFixture[];
}> = ({ fixtures }) => {
  const router = useRouter();
  const contractMessages = useMemo(
    () => buildThreadMessages(fixtures),
    [fixtures],
  );
  const [draft, setDraft] = useState("");
  const [extraMessages, setExtraMessages] = useState<AgentMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft("");
    setExtraMessages([]);
    setNotice(null);
  }, [fixtures]);

  const messages = useMemo(
    () => [...contractMessages, ...extraMessages],
    [contractMessages, extraMessages],
  );

  const handleInteraction = (interaction: AriRenditionInteraction): void => {
    const { behavior } = interaction.action;
    setNotice(`${interaction.action.label} · production action received`);
    if (behavior.type === "reply") {
      setDraft(behavior.message);
      return;
    }
    if (behavior.type === "submit") {
      sendLocalTurn(buildAriRenditionSubmission(interaction));
      return;
    }
    if (behavior.type === "route") {
      router.push(behavior.route as never);
      return;
    }
    if (behavior.type === "external") {
      void Linking.openURL(behavior.url);
      return;
    }
    if (behavior.type === "confirm" || behavior.type === "cancel") {
      setNotice(
        `${behavior.type === "confirm" ? "Confirmed" : "Cancelled"} ${behavior.pending_action_id.slice(0, 8)}…`,
      );
      return;
    }
    if (behavior.command === "copy") {
      const copy =
        ariRenditionCopyText(interaction.rendition) ??
        (interaction.fieldValue || interaction.rendition.body);
      void Clipboard.setStringAsync(copy);
    } else if (behavior.command === "resume") {
      setDraft("Resume this plan from the last safe step");
    } else if (behavior.command === "retry") {
      setDraft("Retry the last step safely");
    }
  };

  const sendLocalTurn = (value: string): boolean => {
    const text = value.trim();
    if (!text) return false;
    setExtraMessages((current) => [
      ...current,
      harnessMessage(
        `local-user-${current.length}`,
        "user",
        { text, local_delivery: "sent" },
        fixtures.length * 2 + current.length,
      ),
    ]);
    setDraft("");
    setNotice("Local user turn rendered through MessageList");
    return true;
  };

  return (
    <View
      style={styles.thread}
      accessibilityLabel="Production Ari rendition thread"
    >
      <View style={styles.threadHeader}>
        <AriOrb size="sm" decorative />
        <View style={styles.threadHeaderCopy}>
          <Text style={styles.threadTitle}>Ari</Text>
          <Text style={styles.threadMeta}>
            {fixtures.length} states · actual MessageList · production contract
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveBadgeText}>INTERACTIVE</Text>
        </View>
      </View>

      <View style={styles.threadBody}>
        <MessageList
          conversationId={`local-rendition-thread-${fixtures.map((item) => item.id).join("-")}`}
          messages={messages}
          pendingAction={null}
          isExecuting={false}
          onConfirm={async () => ({
            ok: false,
            error: "No proposal is active in the local thread.",
          })}
          onCancel={() => undefined}
          onSeedMessage={setDraft}
          onRenditionAction={(_message, interaction) =>
            handleInteraction(interaction)
          }
        />
      </View>

      {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      <View style={styles.composer}>
        <InputBar
          value={draft}
          onChangeText={setDraft}
          onSend={sendLocalTurn}
          onAttach={() => setNotice("Attachment picker action received")}
          placeholder="Try the production composer…"
        />
      </View>
    </View>
  );
};

export const AriRenditionGalleryScreen: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState<AriRenditionGroup | "All">("All");
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [buttonSample, setButtonSample] = useState(
    "Press a sample to feel the spring response.",
  );
  const visible = useMemo(
    () =>
      group === "All"
        ? ARI_RENDITION_FIXTURES
        : ARI_RENDITION_FIXTURES.filter((fixture) => fixture.group === group),
    [group],
  );

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close Ari rendition thread"
          style={({ pressed }) => [
            styles.closeButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.closeButtonText}>‹ Close</Text>
        </Pressable>
        <View style={styles.headerIdentity}>
          <AriOrb size="sm" decorative />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Ari premium thread</Text>
            <Text style={styles.headerMeta}>
              {ARI_RENDITION_TOTAL} UI states in one real conversation
            </Text>
          </View>
        </View>
        <View
          style={styles.localBadge}
          accessibilityLabel="Development preview only"
        >
          <Text style={styles.localBadgeText}>LOCAL</Text>
        </View>
      </View>

      <View style={styles.filterRail}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
          accessibilityRole="tablist"
          accessibilityLabel="Rendition groups"
        >
          {(["All", ...ARI_RENDITION_GROUPS] as const).map((item) => {
            const active = group === item;
            const count =
              item === "All"
                ? ARI_RENDITION_TOTAL
                : ARI_RENDITION_FIXTURES.filter(
                    (fixture) => fixture.group === item,
                  ).length;
            return (
              <Pressable
                key={item}
                onPress={() => setGroup(item)}
                accessibilityLabel={`${item} renditions (${count})`}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.filter,
                  active && styles.filterActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.filterText, active && styles.filterTextActive]}
                >
                  {item}
                </Text>
                <Text
                  style={[
                    styles.filterCount,
                    active && styles.filterTextActive,
                  ]}
                >
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.stage}>
        <View
          style={styles.approvalPanel}
          accessibilityLabel="Simplified first-use sheet preview"
        >
          <View style={styles.approvalHeadingRow}>
            <View style={styles.approvalHeadingCopy}>
              <Text style={styles.approvalEyebrow}>
                FIRST-USE SHEET · SIMPLIFIED
              </Text>
              <Text style={styles.approvalTitle}>One clear introduction</Text>
              <Text style={styles.approvalMeta}>
                One promise, one boundary, one action. No nested boxes or
                competing choices.
              </Text>
            </View>
            <Button
              label="Preview simplified sheet"
              variant="primary"
              size="sm"
              edgeEffect="animatedGradient"
              onPress={() => setShowDisclosure(true)}
              accessibilityLabel="Preview simplified first-use sheet"
            />
          </View>
          <View
            style={styles.motionLab}
            accessibilityLabel="Animated Mingla button samples"
          >
            <View style={styles.motionLabCopy}>
              <Text style={styles.motionLabEyebrow}>ANIMATED EDGE · LIVE</Text>
              <Text style={styles.motionLabNote}>{buttonSample}</Text>
            </View>
            <View style={styles.motionLabButtons}>
              <Button
                label="Orange"
                size="sm"
                variant="primary"
                edgeEffect="animatedGradient"
                onPress={() =>
                  setButtonSample("Orange primary · press and release verified")
                }
              />
              <Button
                label="Black"
                size="sm"
                variant="secondary"
                edgeEffect="animatedGradient"
                onPress={() =>
                  setButtonSample(
                    "Black secondary · press and release verified",
                  )
                }
              />
              <Button
                label="White"
                size="sm"
                variant="step"
                edgeEffect="animatedGradient"
                onPress={() =>
                  setButtonSample("White step · press and release verified")
                }
              />
            </View>
          </View>
        </View>

        <View style={styles.stageCopy}>
          <Text style={styles.stageTitle}>
            {group === "All"
              ? "Every rendition and state"
              : `${group} renditions`}
          </Text>
          <View style={styles.stageActions}>
            <Text style={styles.stageMeta}>
              Scroll, tap choices and actions, edit fields, then send a real
              local turn.
            </Text>
          </View>
        </View>
        <AriProductionThread fixtures={visible} />
      </View>
      <AiDisclosureModal
        visible={showDisclosure}
        onAccept={() => setShowDisclosure(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
    backgroundColor: canvas.depth,
  },
  closeButton: { minWidth: 64, minHeight: 44, justifyContent: "center" },
  closeButtonText: {
    color: ariPalette.flame,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  headerIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  headerCopy: { gap: 1 },
  headerTitle: {
    color: textTokens.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  headerMeta: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 15 },
  localBadge: {
    minHeight: 30,
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "#2b211b",
    paddingHorizontal: spacing.sm,
  },
  localBadgeText: {
    color: ariPalette.gold,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 1,
  },
  filterRail: {
    borderBottomWidth: 1,
    borderBottomColor: glass.border.profileBase,
    backgroundColor: canvas.depth,
  },
  filters: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filter: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "#333a40",
    backgroundColor: ariThread.composerSurface,
    paddingHorizontal: spacing.md,
  },
  filterActive: {
    backgroundColor: textTokens.primary,
    borderColor: textTokens.primary,
  },
  filterText: {
    color: textTokens.primary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  filterCount: {
    color: ariThread.tertiaryText,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  filterTextActive: { color: canvas.depth },
  stage: {
    flex: 1,
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  approvalPanel: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: canvas.depth,
    paddingTop: spacing.md,
    overflow: "hidden",
  },
  approvalHeadingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  approvalHeadingCopy: { flex: 1, minWidth: 250, gap: 2 },
  approvalEyebrow: {
    color: ariPalette.flame,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  approvalTitle: {
    color: textTokens.primary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  approvalMeta: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 16 },
  motionLab: {
    minHeight: 62,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  motionLabCopy: { flex: 1, minWidth: 230, gap: 1 },
  motionLabEyebrow: {
    color: ariPalette.flame,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 1,
  },
  motionLabNote: {
    color: ariThread.tertiaryText,
    fontSize: 10,
    lineHeight: 15,
  },
  motionLabButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  stageCopy: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  stageTitle: {
    color: textTokens.primary,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
  },
  stageActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
  stageMeta: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 16 },
  thread: {
    flex: 1,
    width: "100%",
    borderWidth: 1,
    borderColor: "#30343b",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: canvas.depth,
    overflow: "hidden",
  },
  threadHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#2b3036",
  },
  threadHeaderCopy: { flex: 1, gap: 1 },
  threadTitle: {
    color: textTokens.primary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  threadMeta: { color: ariThread.tertiaryText, fontSize: 11, lineHeight: 15 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: "#17271f",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#61c78f" },
  liveBadgeText: {
    color: "#78d8a6",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  threadBody: { flex: 1, minHeight: 0 },
  notice: {
    color: ariPalette.gold,
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: "#211a16",
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#2b3036",
    padding: spacing.sm,
    backgroundColor: "#111418",
  },
  pressed: { opacity: 0.72 },
});
