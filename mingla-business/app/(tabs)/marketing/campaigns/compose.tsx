/**
 * Marketing → Campaigns → Composer (ORCH-0815-B Phase 2).
 *
 * Single-page composer: Who → What → When → Compliance. Pre-fills the
 * audience from `?audience={kind}:{id}` (I-PROPOSED-BU). Auto-saves the
 * draft every 800ms after the first dirty field. Renders the review
 * sheet on tap, then triggers scheduleSend + (optionally) sendNow.
 *
 * Hard rules enforced here:
 *   - Sub-sheets (AudiencePickerSheet, EventCardInserter, ComposerReviewSheet)
 *     render INSIDE this component (feedback_rn_sub_sheet_must_render_inside_parent.md).
 *   - Keyboard rule: KeyboardAvoidingView wraps the ScrollView so subject /
 *     body inputs never get hidden (feedback_keyboard_never_blocks_input.md).
 *   - Dirty-state back-block: back-listener intercepts unsaved exits and
 *     prompts; sanctioned exits flip a ref disarm-flag first
 *     (feedback_back_listener_disarm_pattern.md).
 *   - randomId from utils — no bare crypto.randomUUID() (Hermes).
 *   - audience= query param parsed via parseAudienceParam (I-PROPOSED-BU).
 *
 * Cross-references:
 *   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0815_B_COMPOSER_AND_SEND.md §5.1
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import { Toast } from "../../../../src/components/ui/Toast";
import { ComposerHeader } from "../../../../src/components/marketing/ComposerHeader";
import { ComposerStepWho } from "../../../../src/components/marketing/ComposerStepWho";
import {
  ComposerStepWhat,
  insertVariableAtCursor,
  type PersonalizationToken,
} from "../../../../src/components/marketing/ComposerStepWhat";
import { ComposerStepWhen, type SendMode } from "../../../../src/components/marketing/ComposerStepWhen";
import { ComposerFooter } from "../../../../src/components/marketing/ComposerFooter";
import {
  AudiencePickerSheet,
  type AudienceOption,
} from "../../../../src/components/marketing/AudiencePickerSheet";
import {
  EventCardInserter,
  type EventCardOption,
} from "../../../../src/components/marketing/EventCardInserter";
import { EmbeddedEventChips } from "../../../../src/components/marketing/EmbeddedEventChips";
import { EmailPreviewPane } from "../../../../src/components/marketing/EmailPreviewPane";
import { ComposerReviewSheet } from "../../../../src/components/marketing/ComposerReviewSheet";
import { ComposerSentConfirmation } from "../../../../src/components/marketing/ComposerSentConfirmation";
import { Sheet } from "../../../../src/components/ui/Sheet";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import {
  parseAudienceParam,
  useResolveAudience,
} from "../../../../src/hooks/marketing/useResolveAudience";
import { useScheduleCampaign } from "../../../../src/hooks/marketing/useScheduleCampaign";
import { useComposerDraft } from "../../../../src/hooks/marketing/useComposerDraft";
import {
  createDraft,
  ensureBrandBuyersAudience,
  ensureEventBuyersAudience,
  getCampaign,
  updateDraft,
} from "../../../../src/services/marketing/marketingCampaignService";
import { supabase } from "../../../../src/services/supabase";
import type { MarketingChannelKind } from "../../../../src/components/marketing/ChannelTabs";
import type { PreviewVariables } from "../../../../src/services/marketing/marketingRenderingService";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useAuth } from "../../../../src/context/AuthContext";

export default function ComposeCampaignRoute(): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ audience?: string; draft?: string }>();
  // Memoize so the pre-fill useEffect's dep array doesn't re-trigger on every
  // render — `parseAudienceParam` returns a new object literal each call (QA
  // finding P2-5).
  const audienceParam = useMemo(
    () =>
      parseAudienceParam(
        typeof params.audience === "string" ? params.audience : null,
      ),
    [params.audience],
  );
  const draftId = typeof params.draft === "string" ? params.draft : null;

  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const currentBrand = useCurrentBrand();
  const brandId = currentBrand?.id ?? null;
  const brandName = currentBrand?.displayName ?? null;
  const brandAddress = currentBrand?.address ?? null;

  const resolvedAudience = useResolveAudience(audienceParam);

  // Composer state
  const [channel, setChannel] = useState<MarketingChannelKind>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodySelectionStart, setBodySelectionStart] = useState(0);
  const [bodySelectionEnd, setBodySelectionEnd] = useState(0);
  const [audienceId, setAudienceId] = useState<string | null>(null);
  const [audienceName, setAudienceName] = useState<string | null>(null);
  const [embeddedEvents, setEmbeddedEvents] = useState<string[]>([]);
  // Display-only metadata for the EmbeddedEventChips row. Mirrors
  // `embeddedEvents` (the persisted IDs array) with the event title +
  // date_label so the chip can show human-readable info. Hydrated on
  // draft restore via a one-shot supabase query, and on first insert
  // from the EventCardOption returned by the picker.
  const [embeddedEventDetails, setEmbeddedEventDetails] = useState<
    Array<{ id: string; title: string; date_label: string | null }>
  >([]);
  const [sendMode, setSendMode] = useState<SendMode>("now");
  const [scheduledForIso, setScheduledForIso] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const [showEventInserter, setShowEventInserter] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showSentConfirmation, setShowSentConfirmation] = useState(false);
  const [isSendNowConfirmation, setIsSendNowConfirmation] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Sanctioned-exit disarm flag for back-listener.
  const sanctionedExitRef = useRef(false);

  // Hydrate audience from query param (lazy: ensures system audience row exists).
  useEffect(() => {
    if (audienceParam === null || accountId === null || brandId === null) return;
    if (audienceId !== null) return;
    let cancelled = false;
    (async () => {
      try {
        if (audienceParam.kind === "brand") {
          const id = await ensureBrandBuyersAudience({
            account_id: accountId,
            brand_id: audienceParam.id,
          });
          if (cancelled) return;
          setAudienceId(id);
          setAudienceName("All brand buyers");
        } else {
          const id = await ensureEventBuyersAudience({
            account_id: accountId,
            brand_id: brandId,
            event_id: audienceParam.id,
          });
          if (cancelled) return;
          setAudienceId(id);
          setAudienceName("Event buyers");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error ? err.message : "Couldn't load audience — pick one below.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audienceParam, accountId, brandId, audienceId]);

  // Hydrate draft from ?draft=[id].
  useEffect(() => {
    if (draftId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await getCampaign(draftId);
        if (cancelled || row === null) return;
        setCampaignId(row.id);
        setChannel(row.channel as MarketingChannelKind);
        setAudienceId(row.audience_id);
        if (row.channel_payload.kind === "email") {
          setSubject(row.channel_payload.subject);
          setBody(row.channel_payload.body_html);
          setEmbeddedEvents(row.channel_payload.embedded_events ?? []);
        }
        if (row.scheduled_for !== null) {
          setScheduledForIso(row.scheduled_for);
          setSendMode("schedule");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error
              ? err.message
              : "Couldn't load draft — start fresh below.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  // Reconcile embeddedEventDetails with embeddedEvents — fetches titles for
  // any IDs that don't yet have hydrated details. Triggered when draft restore
  // populates `embeddedEvents` from the persisted channel_payload, AND
  // defensively when anything else mutates the ids list.
  useEffect(() => {
    if (embeddedEvents.length === 0) {
      if (embeddedEventDetails.length !== 0) setEmbeddedEventDetails([]);
      return;
    }
    const knownIds = new Set(embeddedEventDetails.map((e) => e.id));
    const missing = embeddedEvents.filter((id) => !knownIds.has(id));
    if (missing.length === 0) {
      // Filter out details whose id has been removed from embeddedEvents.
      const persistedIds = new Set(embeddedEvents);
      if (embeddedEventDetails.some((e) => !persistedIds.has(e.id))) {
        setEmbeddedEventDetails((prev) =>
          prev.filter((e) => persistedIds.has(e.id)),
        );
      }
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("events_with_master_date_view")
        .select("id, title, master_start_at")
        .in("id", missing);
      if (cancelled || error || data === null) return;
      const fetched = (data as Array<{
        id: string;
        title: string | null;
        master_start_at: string | null;
      }>).map((r) => ({
        id: r.id,
        title: r.title ?? "Untitled event",
        date_label: r.master_start_at !== null
          ? new Date(r.master_start_at).toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          : null,
      }));
      setEmbeddedEventDetails((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const newOnes = fetched.filter((e) => !existingIds.has(e.id));
        return [...prev, ...newOnes];
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [embeddedEvents, embeddedEventDetails]);

  // Auto-save draft (debounced).
  const flushDraft = useCallback(
    async () => {
      if (accountId === null || brandId === null || audienceId === null) return;
      const payload = {
        kind: "email" as const,
        subject,
        body_html: body,
        body_text: stripHtml(body),
        embedded_events: embeddedEvents,
      };
      try {
        if (campaignId === null) {
          const row = await createDraft({
            account_id: accountId,
            brand_id: brandId,
            audience_id: audienceId,
            name: subject.length > 0 ? subject : "Untitled campaign",
            channel_payload: payload,
          });
          setCampaignId(row.id);
        } else {
          await updateDraft({
            campaign_id: campaignId,
            name: subject.length > 0 ? subject : "Untitled campaign",
            audience_id: audienceId,
            channel_payload: payload,
          });
        }
        setIsDirty(false);
      } catch (err) {
        setErrorBanner(
          err instanceof Error ? err.message : "Couldn't save draft. Tap Save draft to retry.",
        );
      }
    },
    [accountId, brandId, audienceId, subject, body, embeddedEvents, campaignId],
  );

  useComposerDraft({
    state: { subject, body, embeddedEvents, audienceId },
    isDirty,
    flush: async () => {
      await flushDraft();
    },
  });

  // Validation — Review CTA disabled until required fields are present.
  const validationIssues = useMemo<string[]>(() => {
    const issues: string[] = [];
    if (audienceId === null) issues.push("Pick an audience");
    if (subject.trim().length === 0) issues.push("Subject required");
    if (body.trim().length === 0) issues.push("Body required");
    if (sendMode === "schedule") {
      if (scheduledForIso.trim().length === 0) {
        issues.push("Pick a send time");
      } else {
        const d = new Date(scheduledForIso);
        if (Number.isNaN(d.getTime())) issues.push("Invalid date");
      }
    }
    return issues;
  }, [audienceId, subject, body, sendMode, scheduledForIso]);

  const scheduleMutation = useScheduleCampaign({
    onSuccess: () => {
      // Both "Schedule" and "Send now" rely on cron to deliver — Send now
      // simply schedules for `scheduled_for=now()` so the next cron tick
      // (within 60s) picks it up. The composer no longer invokes
      // marketing-send directly; that direct-invoke path collided with
      // `--no-verify-jwt` deploy semantics (the user JWT wasn't reaching
      // the function reliably, causing the RLS-gated ownership check to
      // 403 and surfacing a misleading "Send failed" banner even though
      // cron still delivered ~30s later).
      sanctionedExitRef.current = true;
      setShowReview(false);
      setIsSendNowConfirmation(sendMode === "now");
      setShowSentConfirmation(true);
    },
    onError: (err) => {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Couldn't schedule. Tap Schedule again to retry.",
      );
    },
  });

  const handleConfirmSchedule = useCallback(() => {
    if (campaignId === null) return;
    // Drop the keyboard before the confirmation overlay paints so the
    // overlay isn't sharing the screen with a half-collapsed keyboard.
    Keyboard.dismiss();
    const isoForServer = sendMode === "now"
      ? new Date().toISOString()
      : new Date(scheduledForIso).toISOString();
    scheduleMutation.mutate({
      campaign_id: campaignId,
      scheduled_for: isoForServer,
      name: subject.length > 0 ? subject : "Untitled campaign",
      channel_payload: {
        kind: "email",
        subject,
        body_html: body,
        body_text: stripHtml(body),
        embedded_events: embeddedEvents,
      },
    });
  }, [campaignId, sendMode, scheduledForIso, subject, body, embeddedEvents, scheduleMutation]);

  // Back-block — intercept exits if dirty.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (event: unknown) => {
      const ev = event as { preventDefault: () => void; data?: { action?: unknown } };
      if (sanctionedExitRef.current) return;
      // Only intercept on unsaved edits. A saved-clean state (campaignId set,
      // isDirty false) has nothing to prompt about — let the user navigate
      // freely (QA finding P2-3).
      if (!isDirty) return;
      ev.preventDefault?.();
      Alert.alert(
        "Save your draft?",
        "You've got unsaved edits. Save them so you can pick up later — or discard.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              sanctionedExitRef.current = true;
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/marketing/campaigns" as never);
            },
          },
          {
            text: "Save draft",
            onPress: async () => {
              await flushDraft();
              sanctionedExitRef.current = true;
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/marketing/campaigns" as never);
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, isDirty, campaignId, flushDraft, router]);

  // Audience preview variables for the EmailPreviewPane.
  const previewVariables = useMemo<PreviewVariables>(() => {
    const firstBuyerName = resolvedAudience.data?.rows[0]?.display_name ?? null;
    const firstName = firstBuyerName !== null
      ? firstBuyerName.split(/\s+/)[0]
      : null;
    return {
      first_name: firstName,
      brand_name: brandName,
      event_name: resolvedAudience.data?.rows[0]?.last_event_name ?? null,
      event_date: null,
      event_time: null,
      doors_open: null,
      event_url: null,
      spots_left: null,
      previous_event_name: null,
      next_event_name: null,
      event_id: null,
    };
  }, [resolvedAudience.data, brandName]);

  const reach = resolvedAudience.data?.reach ?? null;

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/campaigns" as never);
  }, [router]);

  const handleSaveDraft = useCallback(async (): Promise<void> => {
    await flushDraft();
  }, [flushDraft]);

  const handleInsertEventCard = useCallback((event: EventCardOption) => {
    const token = `{{event:${event.id}}}`;
    setBody((prev) => {
      // Guard against double-insert of the same event — the operator probably
      // didn't mean to embed the same card twice; the chip row reflects single
      // membership so the body should too.
      if (prev.includes(token)) return prev;
      const insertAt = Math.min(bodySelectionEnd, prev.length);
      const safeInsertAt = Math.max(0, Math.min(insertAt, prev.length));
      return prev.slice(0, safeInsertAt) + token + prev.slice(safeInsertAt);
    });
    setEmbeddedEvents((prev) => (prev.includes(event.id) ? prev : [...prev, event.id]));
    setEmbeddedEventDetails((prev) =>
      prev.some((e) => e.id === event.id)
        ? prev
        : [...prev, { id: event.id, title: event.title, date_label: event.date_label }],
    );
    setIsDirty(true);
  }, [bodySelectionEnd]);

  const handleRemoveEmbeddedEvent = useCallback((eventId: string) => {
    // Drop the matching `{{event:<uuid>}}` token from the body, then collapse
    // any orphan blank lines the removal left behind so the body stays clean.
    setBody((prev) => {
      // Escape the UUID for a safe RegExp — UUIDs don't contain special chars
      // but defensive escaping costs nothing.
      const escaped = eventId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tokenRe = new RegExp(`\\{\\{event:${escaped}\\}\\}\\n*`, "g");
      return prev.replace(tokenRe, "").replace(/\n{3,}/g, "\n\n");
    });
    setEmbeddedEvents((prev) => prev.filter((id) => id !== eventId));
    setEmbeddedEventDetails((prev) => prev.filter((e) => e.id !== eventId));
    setIsDirty(true);
  }, []);

  const handleInsertVariable = useCallback((token: PersonalizationToken) => {
    setBody((prev) => {
      const { body: next } = insertVariableAtCursor(
        prev,
        bodySelectionStart,
        bodySelectionEnd,
        token,
      );
      return next;
    });
    setIsDirty(true);
  }, [bodySelectionStart, bodySelectionEnd]);

  const handleSelectAudience = useCallback(async (option: AudienceOption) => {
    setAudienceName(option.name);
    setIsDirty(true);
    // Fast path: the marketing_audiences row already exists from a prior
    // navigation via the Brand/Event Blasts CTAs.
    if (option.existing_audience_id !== null) {
      setAudienceId(option.existing_audience_id);
      return;
    }
    // Slow path: this is the operator's first time picking this kind+target
    // from the picker. Lazy-seed the marketing_audiences row now so the
    // composer can save drafts + schedule sends against a real audience_id.
    if (accountId === null || brandId === null) return;
    try {
      const id = option.kind === "brand_buyers"
        ? await ensureBrandBuyersAudience({
            account_id: accountId,
            brand_id: option.target_id,
          })
        : await ensureEventBuyersAudience({
            account_id: accountId,
            brand_id: brandId,
            event_id: option.target_id,
          });
      setAudienceId(id);
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Couldn't load that audience. Pick another or retry.",
      );
    }
  }, [accountId, brandId]);

  const onSubjectChange = useCallback((value: string) => {
    setSubject(value);
    setIsDirty(true);
  }, []);

  const onBodyChange = useCallback((value: string) => {
    setBody(value);
    setIsDirty(true);
  }, []);

  const onSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      setBodySelectionStart(event.nativeEvent.selection.start);
      setBodySelectionEnd(event.nativeEvent.selection.end);
    },
    [],
  );

  const scheduledLabel = sendMode === "now"
    ? "Send immediately"
    : scheduledForIso.length > 0
      ? new Date(scheduledForIso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Pick a time";

  // Pre-fill loading skeleton
  if (audienceParam !== null && audienceId === null && errorBanner === null) {
    return (
      <View style={styles.host}>
        <ComposerHeader title="New campaign" onBack={handleBack} onSaveDraft={() => {}} saveDraftDisabled />
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  // Reference selection state so it's read (suppresses unused warning while
  // keeping it available for future cursor-aware token insertion).
  void bodySelectionStart;

  return (
    <View style={styles.host}>
      <ComposerHeader
        title="New campaign"
        onBack={handleBack}
        onSaveDraft={() => {
          void handleSaveDraft();
        }}
        saveDraftDisabled={!isDirty && campaignId !== null}
      />
      <Toast
        visible={errorBanner !== null}
        kind="error"
        message={errorBanner ?? ""}
        onDismiss={() => setErrorBanner(null)}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.kavHost}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <ComposerStepWho
            audienceName={audienceName}
            reachableEmail={reach?.reachable_email ?? null}
            totalAudience={reach?.total ?? null}
            onOpenPicker={() => setShowAudiencePicker(true)}
            disabled={brandId === null}
          />
          {isDirty && audienceId === null && brandId !== null ? (
            <View style={styles.draftCaption}>
              <Text style={styles.draftCaptionText}>
                Pick an audience above to save your draft.
              </Text>
            </View>
          ) : null}

          <ComposerStepWhat
            channel={channel}
            onChannelChange={(kind) => {
              setChannel(kind);
              setIsDirty(true);
            }}
            subject={subject}
            onSubjectChange={onSubjectChange}
            body={body}
            onBodyChange={onBodyChange}
            onSelectionChange={onSelectionChange}
            onInsertEventCard={() => setShowEventInserter(true)}
            onOpenPreview={() => setShowPreview(true)}
            onInsertVariable={handleInsertVariable}
          />

          <EmbeddedEventChips
            events={embeddedEventDetails}
            onRemove={handleRemoveEmbeddedEvent}
          />

          <ComposerStepWhen
            mode={sendMode}
            onModeChange={(mode) => {
              setSendMode(mode);
              setIsDirty(true);
            }}
            scheduledForIso={scheduledForIso}
            onScheduledForChange={(value) => {
              setScheduledForIso(value);
              setIsDirty(true);
            }}
          />

          {/* Compact compliance notice — replaces the verbose Step 4 card
              per operator feedback. The brand From line, reply-to,
              unsubscribe behaviour, and address are all auto-handled. */}
          <View style={styles.complianceNotice}>
            <Text style={styles.complianceText}>
              From <Text style={styles.complianceStrong}>{brandName ?? "your brand"}</Text>
              {" · "}Unsubscribe link auto-added{" · "}
              <Text style={styles.complianceMuted}>
                {brandAddress !== null ? brandAddress : "Set brand address in profile"}
              </Text>
            </Text>
          </View>
        </ScrollView>

        <ComposerFooter
          onSaveDraft={() => {
            void handleSaveDraft();
          }}
          saveDraftDisabled={!isDirty && campaignId !== null}
          saveDraftLabel="Save draft"
          onReview={() => setShowReview(true)}
          reviewDisabled={validationIssues.length > 0}
          submitting={scheduleMutation.isPending}
        />

        {/* Sub-sheets MUST render inside this parent KeyboardAvoidingView,
            which is itself inside the route. See
            feedback_rn_sub_sheet_must_render_inside_parent.md. */}
        <AudiencePickerSheet
          visible={showAudiencePicker}
          brandId={brandId}
          brandName={brandName}
          selectedAudienceId={audienceId}
          onClose={() => setShowAudiencePicker(false)}
          onSelect={handleSelectAudience}
        />
        <EventCardInserter
          visible={showEventInserter}
          brandId={brandId}
          onClose={() => setShowEventInserter(false)}
          onSelect={handleInsertEventCard}
        />
        <Sheet
          visible={showPreview}
          onClose={() => setShowPreview(false)}
          snapPoint="full"
        >
          <EmailPreviewPane
            subject={subject}
            bodyHtml={body}
            variables={previewVariables}
            brandName={brandName}
            brandHeaderImageUrl={
              currentBrand !== null &&
                currentBrand.coverMediaType !== "video"
                ? currentBrand.coverMediaUrl ?? null
                : null
            }
            embeddedEvents={embeddedEventDetails}
          />
        </Sheet>
        <ComposerReviewSheet
          visible={showReview}
          audienceName={audienceName}
          recipientCount={reach?.reachable_email ?? null}
          subject={subject}
          scheduledLabel={scheduledLabel}
          isSendNow={sendMode === "now"}
          submitting={scheduleMutation.isPending}
          onBack={() => setShowReview(false)}
          onClose={() => setShowReview(false)}
          onConfirm={handleConfirmSchedule}
        />
        <ComposerSentConfirmation
          visible={showSentConfirmation}
          isSendNow={isSendNowConfirmation}
          onDismiss={() => {
            setShowSentConfirmation(false);
            sanctionedExitRef.current = true;
            router.replace("/(tabs)/marketing/campaigns" as never);
          }}
          onViewInCampaigns={() => {
            setShowSentConfirmation(false);
            sanctionedExitRef.current = true;
            router.replace("/(tabs)/marketing/campaigns" as never);
          }}
        />
      </KeyboardAvoidingView>
    </View>
  );
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  kavHost: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 140,
    gap: spacing.lg,
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  complianceNotice: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  complianceText: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  complianceStrong: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  complianceMuted: {
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  draftCaption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderLeftWidth: 3,
    borderLeftColor: "#f59e0b",
  },
  draftCaptionText: {
    ...typography.bodySm,
    color: textTokens.primary,
  },
});
