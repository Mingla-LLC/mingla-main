/**
 * #4111 — the signed-out guest's conversation with a brand, at
 * https://host.usemingla.com/m/{token} (edge `public-enquiry-thread`).
 *
 * ANON ROUTE: no useAuth, no sign-in redirect (`/m/` is on
 * PUBLIC_BUYER_ROUTE_PREFIXES). The token in the URL is the only key: either
 * the emailed token (its first open confirms the guest's email) or the sending
 * browser's own token from "View conversation" (reads and posts, never
 * confirms — #4111 P1-2). The page treats both alike. Brand-themed.
 *
 * States (guestThreadModel): loading · error (Try again) · invalid · expired
 * ("Email me a new link") · thread (resolved banner, "Get replies instantly"
 * app card, pinned composer above the privacy bar).
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Head from "expo-router/head";
// ORCH-0892 — keyboard-aware on native (focused field clears the keyboard), plain on web.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createThemePalette,
  resolveTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";

import { publicEnquiryKeys } from "../../hooks/publicEnquiryKeys";
import { explorerAppUrl, openExternalUrl } from "./brandContactLinks";
import { guestThreadModel, isGuestThreadToken, type GuestThreadLoad } from "./guestThreadModel";
import { PINNED_BAR_IN_FLOW, PinnedBottomBar } from "./PinnedBottomBar";

const REPLY_MAX = 2000;
const COMPOSER_SPACE = 92;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REPLY_ERROR: Record<"expired" | "invalid" | "rate_limited" | "body" | "network", string> = {
  expired: "This link has expired. Ask for a new one below.",
  invalid: "This link isn't valid any more.",
  rate_limited: "You've sent a lot of replies. Wait a few minutes and try again.",
  body: "Write a reply of up to 2,000 characters.",
  network: "We couldn't send that. Check your connection and try again.",
};

export interface GuestThreadScreenProps {
  token: string | null;
}

export default function GuestThreadScreen({ token }: GuestThreadScreenProps): React.ReactElement {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const validToken = isGuestThreadToken(token) ? token : null;

  const threadQuery = useQuery({
    queryKey: publicEnquiryKeys.guestThread(validToken ?? ""),
    queryFn: async () => (await import("../../services/publicEnquiryService")).fetchGuestThread(validToken as string),
    enabled: validToken !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  const load: GuestThreadLoad =
    validToken === null
      ? { kind: "invalid" }
      : threadQuery.data !== undefined
        ? threadQuery.data
        : threadQuery.isError
          ? { kind: "error" }
          : { kind: "loading" };
  const model = guestThreadModel(load);

  const accent = model.view === "thread" ? model.accent : null;
  const palette = useMemo<ThemePalette>(
    () => createThemePalette(resolveTheme(accent === null ? null : { color: accent }, null)),
    [accent],
  );

  const [draft, setDraft] = useState("");
  // Web: how far the pinned composer rose above floating UI (privacy button /
  // consent card), so the last message can still scroll clear of it.
  const [composerLift, setComposerLift] = useState(0);
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [linkError, setLinkError] = useState<string | null>(null);

  const sendReply = useCallback(async (): Promise<void> => {
    const body = draft.trim();
    if (validToken === null || body.length === 0 || sending) return;
    setSending(true);
    setReplyError(null);
    try {
      const service = await import("../../services/publicEnquiryService");
      const outcome = await service.postGuestReply(validToken, body, hp);
      if (!outcome.ok) {
        setReplyError(REPLY_ERROR[outcome.reason]);
        if (outcome.reason === "expired" || outcome.reason === "invalid") {
          await queryClient.invalidateQueries({ queryKey: publicEnquiryKeys.guestThread(validToken) });
        }
        return;
      }
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: publicEnquiryKeys.guestThread(validToken) });
    } catch (error: unknown) {
      console.warn("[guest-thread] reply failed", error instanceof Error ? error.message : String(error));
      setReplyError(REPLY_ERROR.network);
    } finally {
      setSending(false);
    }
  }, [draft, hp, queryClient, sending, validToken]);

  const requestLink = useCallback(async (): Promise<void> => {
    const email = linkEmail.trim();
    if (!EMAIL_RE.test(email)) {
      setLinkError("Enter a full email address, like name@example.com.");
      return;
    }
    setLinkError(null);
    setLinkState("sending");
    try {
      const service = await import("../../services/publicEnquiryService");
      setLinkState((await service.requestNewThreadLink(email)) ? "sent" : "error");
    } catch (error: unknown) {
      console.warn("[guest-thread] new link failed", error instanceof Error ? error.message : String(error));
      setLinkState("error");
    }
  }, [linkEmail]);

  const openBrand = (): void => {
    if (model.view === "thread" && model.brandSlug !== null) {
      router.push(`/b/${model.brandSlug}` as never);
    }
  };

  const head =
    Platform.OS === "web" ? (
      <Head>
        <title>{model.view === "thread" ? `Your conversation with ${model.brandName}` : "Your conversation"}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
      </Head>
    ) : null;

  const button = (
    label: string,
    onPress: () => void,
    opts: { testID: string; kind?: "primary" | "line"; busy?: boolean },
  ): React.ReactElement => {
    const primary = opts.kind !== "line";
    return (
      <Pressable
        onPress={onPress}
        disabled={opts.busy === true}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: opts.busy === true }}
        testID={opts.testID}
        style={({ pressed }) => [
          primary ? styles.primaryBtn : styles.lineBtn,
          primary ? { backgroundColor: palette.accent } : { borderColor: palette.accent },
          opts.busy === true && styles.dim,
          pressed && styles.pressed,
        ]}
      >
        {opts.busy === true ? (
          <ActivityIndicator color={primary ? palette.accentText : palette.accent} />
        ) : (
          <Text
            numberOfLines={1}
            style={[primary ? styles.primaryLabel : styles.lineLabel, { color: primary ? palette.accentText : palette.primaryText }]}
          >
            {label}
          </Text>
        )}
      </Pressable>
    );
  };

  if (model.view === "loading") {
    return (
      <View style={[styles.page, styles.centered, { backgroundColor: palette.page }]} testID="guest-thread-loading">
        {head}
        <ActivityIndicator color={palette.accent} />
        <Text style={[styles.stateBody, { color: palette.secondaryText }]}>Loading your conversation…</Text>
      </View>
    );
  }

  if (model.view !== "thread") {
    return (
      <ScrollView
        style={[styles.page, { backgroundColor: palette.page }]}
        contentContainerStyle={[styles.stateWrap, { paddingTop: insets.top + 48 }]}
        keyboardShouldPersistTaps="handled"
        testID={`guest-thread-${model.view}`}
      >
        {head}
        <View style={[styles.stateCard, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}>
          <Text style={[styles.stateTitle, { color: palette.primaryText }]} accessibilityRole="header">
            {model.title}
          </Text>
          <Text style={[styles.stateBody, { color: palette.secondaryText }]}>{model.body}</Text>
          {model.view === "error"
            ? button("Try again", () => {
                void threadQuery.refetch();
              }, { testID: "guest-thread-retry" })
            : null}
          {model.view === "expired" ? (
            linkState === "sent" ? (
              <Text style={[styles.stateBody, { color: palette.primaryText }]} accessibilityLiveRegion="polite" testID="guest-thread-link-sent">
                If that email has a conversation, a new link is on its way.
              </Text>
            ) : (
              <View style={styles.linkForm}>
                <TextInput
                  value={linkEmail}
                  onChangeText={(next) => {
                    setLinkEmail(next);
                    if (linkError !== null) setLinkError(null);
                  }}
                  placeholder="Your email"
                  placeholderTextColor={palette.tertiaryText}
                  accessibilityLabel="Your email"
                  keyboardType="email-address"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="guest-thread-link-email"
                  style={[styles.input, { color: palette.primaryText, borderColor: linkError !== null ? "#ef4444" : palette.panelBorder, backgroundColor: palette.page }]}
                />
                {linkError !== null ? <Text style={styles.errorText}>{linkError}</Text> : null}
                {linkState === "error" ? (
                  <Text style={styles.errorText}>We couldn&apos;t send that. Check your connection and try again.</Text>
                ) : null}
                {button("Email me a new link", () => {
                  void requestLink();
                }, { testID: "guest-thread-new-link", busy: linkState === "sending" })}
              </View>
            )
          ) : null}
          {model.view === "invalid"
            ? button("Get the Mingla app", () => openExternalUrl(explorerAppUrl()), {
                testID: "guest-thread-get-app",
                kind: "line",
              })
            : null}
        </View>
      </ScrollView>
    );
  }

  const initial = model.brandName.trim().charAt(0).toUpperCase() || "M";
  const composer = (
    <View
      style={[
        styles.composerRow,
        { borderTopColor: palette.panelBorder, paddingBottom: 12 + insets.bottom },
      ]}
    >
      <View style={styles.column}>
        {replyError !== null ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite" testID="guest-thread-reply-error">
            {replyError}
          </Text>
        ) : null}
        <View style={styles.composerInner}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={model.composerPlaceholder}
            placeholderTextColor={palette.tertiaryText}
            accessibilityLabel="Write a reply"
            multiline
            maxLength={REPLY_MAX}
            testID="guest-thread-composer"
            style={[styles.composerInput, { color: palette.primaryText, backgroundColor: palette.card, borderColor: palette.panelBorder }]}
          />
          <TextInput
            value={hp}
            onChangeText={setHp}
            accessibilityElementsHidden
            aria-hidden
            tabIndex={-1}
            focusable={false}
            importantForAccessibility="no-hide-descendants"
            autoComplete="off"
            testID="guest-thread-hp"
            style={styles.honeypot}
          />
          <Pressable
            onPress={() => {
              void sendReply();
            }}
            disabled={sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Send reply"
            accessibilityState={{ disabled: sending || draft.trim().length === 0, busy: sending }}
            testID="guest-thread-send"
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: palette.accent },
              (sending || draft.trim().length === 0) && styles.dim,
              pressed && styles.pressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color={palette.accentText} />
            ) : (
              <Text style={[styles.sendLabel, { color: palette.accentText }]}>Send</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.page, { backgroundColor: palette.page }]} testID="guest-thread-thread">
      {head}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: palette.panelBorder }]}>
        <View style={[styles.column, styles.headerRow]}>
          {model.logoUrl !== null ? (
            <Image
              source={{ uri: model.logoUrl }}
              style={[styles.avatar, { borderColor: palette.accent }]}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { borderColor: palette.accent, backgroundColor: palette.accentWash }]}>
              <Text style={[styles.avatarInitial, { color: palette.accent }]}>{initial}</Text>
            </View>
          )}
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: palette.primaryText }]} accessibilityRole="header">
              {model.brandName}
            </Text>
            {model.subtitle !== null ? (
              <Text numberOfLines={1} style={[styles.headerSub, { color: palette.tertiaryText }]}>
                {model.subtitle}
              </Text>
            ) : null}
          </View>
          {model.brandSlug !== null
            ? button("View brand", openBrand, { testID: "guest-thread-view-brand", kind: "line" })
            : null}
        </View>
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.thread, !PINNED_BAR_IN_FLOW && { paddingBottom: COMPOSER_SPACE + 24 + composerLift }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.column, styles.threadColumn]}>
          {model.bubbles.map((bubble) => (
            <View key={bubble.key} style={[styles.bubbleWrap, bubble.mine && styles.bubbleWrapMine]}>
              <Text style={[styles.bubbleMeta, { color: palette.tertiaryText }, bubble.mine && styles.textRight]}>
                {bubble.meta}
              </Text>
              <View
                style={[
                  styles.bubble,
                  bubble.mine
                    ? { backgroundColor: palette.accent }
                    : { backgroundColor: palette.card, borderColor: palette.panelBorder, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.bubbleText, { color: bubble.mine ? palette.accentText : palette.primaryText }]}>
                  {bubble.body}
                </Text>
              </View>
            </View>
          ))}
          {model.resolvedBanner !== null ? (
            <View
              style={[styles.banner, { backgroundColor: palette.accentWash, borderColor: palette.panelBorder }]}
              testID="guest-thread-resolved"
            >
              <Text style={[styles.bannerText, { color: palette.primaryText }]}>{model.resolvedBanner}</Text>
            </View>
          ) : null}
          <View
            style={[styles.appCard, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
            testID="guest-thread-app-card"
          >
            <View style={styles.flex}>
              <Text style={[styles.appTitle, { color: palette.primaryText }]}>{model.appCard.title}</Text>
              <Text style={[styles.appBody, { color: palette.secondaryText }]}>{model.appCard.body}</Text>
            </View>
            {button(model.appCard.cta, () => openExternalUrl(explorerAppUrl()), {
              testID: "guest-thread-app-cta",
              kind: "line",
            })}
          </View>
        </View>
      </ScrollView>
      <PinnedBottomBar background={palette.page} onLiftChange={setComposerLift}>{composer}</PinnedBottomBar>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, minHeight: "100%" },
  flex: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", gap: 12 },
  column: { width: "100%", maxWidth: 640, alignSelf: "center", paddingHorizontal: 16 },
  stateWrap: { paddingHorizontal: 16, paddingBottom: 48 },
  stateCard: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  stateTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  stateBody: { fontSize: 15, lineHeight: 22 },
  linkForm: { gap: 10 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 48, paddingHorizontal: 14, fontSize: 16 },
  errorText: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
  header: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 17, fontWeight: "800" },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, lineHeight: 22, fontWeight: "700" },
  headerSub: { fontSize: 13, lineHeight: 18 },
  thread: { paddingTop: 16 },
  threadColumn: { gap: 12 },
  bubbleWrap: { alignItems: "flex-start", gap: 4, maxWidth: "86%" },
  bubbleWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleMeta: { fontSize: 12, lineHeight: 16 },
  textRight: { textAlign: "right" },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 12 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  appCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 4,
  },
  appTitle: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  appBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  composerRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  composerInner: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    fontSize: 16,
    lineHeight: 21,
  },
  sendBtn: { minHeight: 44, minWidth: 72, borderRadius: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  sendLabel: { fontSize: 15, fontWeight: "700" },
  honeypot: { position: "absolute", left: -10000, width: 1, height: 1, opacity: 0 },
  primaryBtn: { minHeight: 48, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primaryLabel: { fontSize: 16, fontWeight: "700" },
  lineBtn: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  lineLabel: { fontSize: 14, fontWeight: "700" },
  dim: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
