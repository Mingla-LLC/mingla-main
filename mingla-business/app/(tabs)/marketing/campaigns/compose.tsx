/**
 * Marketing → Campaigns → Composer (ORCH-0864 [Marketing Composer V2] Stage F).
 *
 * V2 route: TenTap-backed rich-text body + inline chips + floating
 * insertion bar + template preview drawer. Replaces V1 step-card layout
 * with a flex-column where the editor canvas takes the middle.
 *
 * Preserved from ORCH-0815-B Phase 2 (V1) verbatim:
 *   - ?audience= pre-fill + ensureBrand/EventBuyersAudience lazy seed
 *   - ?template= hydration (subject + body)
 *   - ?draft= rehydration from `campaigns.channel_payload`
 *   - useComposerDraft 800ms debounced auto-save (now derives
 *     embedded_events from body string via extractEmbeddedEventIds)
 *   - useScheduleCampaign (send-now = schedule for now() so cron picks up)
 *   - Dirty-state back-block per feedback_back_listener_disarm_pattern.md
 *   - Sub-sheets render INSIDE this component per
 *     feedback_rn_sub_sheet_must_render_inside_parent.md
 *   - KeyboardAvoidingView wrap per feedback_keyboard_never_blocks_input.md
 *
 * Removed (Stage F deletions):
 *   - <ComposerStepWhat> + <EmbeddedEventChips> + <EventCardInserter> +
 *     <EmailPreviewPane> + <Sheet> wrapper around preview
 *   - bodySelection cursor state (now lives inside useTenTapEditor)
 *   - embeddedEvents + embeddedEventDetails arrays (derived from body string)
 *   - showPreview overlay (preview now happens inline via chip render)
 *
 * Layout: flex column. KeyboardAvoidingView → Header (fixed) → Toast →
 * Who (fixed) → optional draft caption → ComposerV2Editor (flex:1,
 * contains body + InsertionBar + TemplatePreviewDrawer) → When (fixed) →
 * Compliance (fixed) → Footer (fixed).
 *
 * Cross-references:
 *   - SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0864_MARKETING_COMPOSER_V2.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import { Toast } from "../../../../src/components/ui/Toast";
import { ComposerHeader } from "../../../../src/components/marketing/ComposerHeader";
import { ComposerStepWho } from "../../../../src/components/marketing/ComposerStepWho";
// ComposerStepWhen removed from layout in F.9 (segmented control gone;
// Send-now lives in ComposerFooter left CTA). Keep SendMode type import.
import { type SendMode } from "../../../../src/components/marketing/ComposerStepWhen";
import { ComposerFooter } from "../../../../src/components/marketing/ComposerFooter";
import { ComposerCanvas } from "../../../../src/components/marketing/ComposerV2/ComposerCanvas";
import { EmailPreviewPane } from "../../../../src/components/marketing/EmailPreviewPane";
import { SchedulePickerSheet } from "../../../../src/components/marketing/ComposerV2/SchedulePickerSheet";
import {
  AudiencePickerSheet,
  type AudienceOption,
} from "../../../../src/components/marketing/AudiencePickerSheet";
import { ComposerReviewSheet } from "../../../../src/components/marketing/ComposerReviewSheet";
import { ComposerSentConfirmation } from "../../../../src/components/marketing/ComposerSentConfirmation";
import {
  ComposerV2Editor,
  type ComposerV2EditorHandle,
} from "../../../../src/components/marketing/ComposerV2/ComposerV2Editor";
// F.9: InsertionBar + TemplatePreviewDrawer are now mounted INSIDE
// ComposerV2Editor (merged toolbar position requires adjacency to
// subject + body). compose.tsx no longer imports them directly.
import {
  canvas,
  radius,
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
import { useStarterTemplates } from "../../../../src/hooks/marketing/useStarterTemplates";
import { useUserTemplates } from "../../../../src/hooks/marketing/useUserTemplates";
import {
  createDraft,
  ensureBrandBuyersAudience,
  ensureEventBuyersAudience,
  getCampaign,
  updateDraft,
} from "../../../../src/services/marketing/marketingCampaignService";
import { getTemplate } from "../../../../src/services/marketing/marketingTemplateService";
import { extractEmbeddedEventIds } from "../../../../src/services/marketing/tenTapTokenBridge";
import { useBrandEvents } from "../../../../src/services/marketing/brandEvents";
import type { MarketingChannelKind } from "../../../../src/components/marketing/ChannelTabs";
import type { PreviewVariables } from "../../../../src/services/marketing/marketingRenderingService";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useAuth } from "../../../../src/context/AuthContext";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";

export default function ComposeCampaignRoute(): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const { isWideDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{ audience?: string; draft?: string; template?: string }>();
  // Memoize so the pre-fill useEffect's dep array doesn't re-trigger on every
  // render — parseAudienceParam returns a new object literal each call.
  const audienceParam = useMemo(
    () =>
      parseAudienceParam(
        typeof params.audience === "string" ? params.audience : null,
      ),
    [params.audience],
  );
  const draftId = typeof params.draft === "string" ? params.draft : null;
  const templateId =
    typeof params.template === "string" && params.template.length > 0
      ? params.template
      : null;

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
  const [audienceId, setAudienceId] = useState<string | null>(null);
  const [audienceName, setAudienceName] = useState<string | null>(null);
  const [sendMode, setSendMode] = useState<SendMode>("now");
  const [scheduledForIso, setScheduledForIso] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const [showReview, setShowReview] = useState(false);
  // F.10b: preview modal + schedule-picker sheet — both live in compose.tsx
  // so the footer buttons can drive them directly.
  const [showPreview, setShowPreview] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showSentConfirmation, setShowSentConfirmation] = useState(false);
  const [isSendNowConfirmation, setIsSendNowConfirmation] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Sanctioned-exit disarm flag for back-listener.
  const sanctionedExitRef = useRef(false);

  // F.9: editor owns its own InsertionBar + TemplatePreviewDrawer state
  // internally. compose.tsx only keeps the imperative handle for
  // template-apply and (legacy) insert helpers — but the merged-toolbar
  // taps now route directly inside the editor too. Handle is retained as
  // an escape hatch for future programmatic actions.
  const editorHandleRef = useRef<ComposerV2EditorHandle>(null);

  // Brand events for the inline event scroller inside the V2 editor.
  const brandEventsQuery = useBrandEvents(brandId);
  const brandEvents = brandEventsQuery.data ?? [];

  // Templates for the V2 template preview drawer (starter + user merged).
  const starterTemplatesQuery = useStarterTemplates();
  const userTemplatesQuery = useUserTemplates(accountId);
  const templates = useMemo(() => {
    const starters = starterTemplatesQuery.data ?? [];
    const userOnes = userTemplatesQuery.data ?? [];
    return [...starters, ...userOnes];
  }, [starterTemplatesQuery.data, userTemplatesQuery.data]);

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

  // Hydrate from ?template=[id]. Draft restore wins when both present.
  useEffect(() => {
    if (templateId === null || draftId !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const tmpl = await getTemplate(templateId);
        if (cancelled || tmpl === null) return;
        setSubject(tmpl.subject_template ?? "");
        setBody(tmpl.body_template);
        setIsDirty(true);
      } catch (err) {
        if (!cancelled) {
          setErrorBanner(
            err instanceof Error
              ? err.message
              : "Couldn't load template — start fresh below.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, draftId]);

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

  // Auto-save draft (debounced via useComposerDraft). embedded_events is
  // derived from the body string via extractEmbeddedEventIds — Stage F
  // removed the parallel embeddedEvents state in favor of single-source body.
  const flushDraft = useCallback(
    async () => {
      if (accountId === null || brandId === null || audienceId === null) return;
      const embeddedEventIds = extractEmbeddedEventIds(body);
      const payload = {
        kind: "email" as const,
        subject,
        body_html: body,
        body_text: stripHtml(body),
        embedded_events: embeddedEventIds,
      };
      try {
        if (campaignId === null) {
          const row = await createDraft({
            account_id: accountId,
            brand_id: brandId,
            audience_id: audienceId,
            name: subject.length > 0 ? subject : "Untitled campaign",
            channel_payload: payload,
            ...(templateId !== null ? { template_id: templateId } : {}),
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
    [accountId, brandId, audienceId, subject, body, campaignId, templateId],
  );

  useComposerDraft({
    state: { subject, body, embeddedEvents: extractEmbeddedEventIds(body), audienceId },
    isDirty,
    flush: async () => {
      await flushDraft();
    },
  });

  // F.10b: core validation for footer buttons — audience + subject + body
  // are the minimum needed BEFORE the user opens Schedule (date-time picker)
  // or Send Now (review sheet). The schedule-time check is enforced inside
  // the picker + review sheet, not at the footer level.
  const coreFooterDisabled = useMemo<boolean>(() => {
    return (
      audienceId === null ||
      subject.trim().length === 0 ||
      body.trim().length === 0
    );
  }, [audienceId, subject, body]);

  // F.10c: human-readable "what's missing" message for the toast banner
  // that fires when an operator taps Send Now / Schedule before filling
  // the required fields. Returns null when everything is filled.
  const missingFieldsLabel = useCallback((): string | null => {
    const missing: string[] = [];
    if (audienceId === null) missing.push("an audience");
    if (subject.trim().length === 0) missing.push("a subject");
    if (body.trim().length === 0) missing.push("a message");
    if (missing.length === 0) return null;
    if (missing.length === 1) return `Pick ${missing[0]} before sending.`;
    if (missing.length === 2) return `Add ${missing[0]} and ${missing[1]} first.`;
    return `Add ${missing[0]}, ${missing[1]}, and ${missing[2]} first.`;
  }, [audienceId, subject, body]);

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
    Keyboard.dismiss();
    const isoForServer = sendMode === "now"
      ? new Date().toISOString()
      : new Date(scheduledForIso).toISOString();
    const embeddedEventIds = extractEmbeddedEventIds(body);
    scheduleMutation.mutate({
      campaign_id: campaignId,
      scheduled_for: isoForServer,
      name: subject.length > 0 ? subject : "Untitled campaign",
      channel_payload: {
        kind: "email",
        subject,
        body_html: body,
        body_text: stripHtml(body),
        embedded_events: embeddedEventIds,
      },
    });
  }, [campaignId, sendMode, scheduledForIso, subject, body, scheduleMutation]);

  // Back-block — intercept exits if dirty.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (event: unknown) => {
      const ev = event as { preventDefault: () => void; data?: { action?: unknown } };
      if (sanctionedExitRef.current) return;
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

  // Audience preview variables — fed to the V2 editor's template-drawer
  // live-preview pane via the editor's props.
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

  const handleSelectAudience = useCallback(async (option: AudienceOption) => {
    setAudienceName(option.name);
    setIsDirty(true);
    if (option.existing_audience_id !== null) {
      setAudienceId(option.existing_audience_id);
      return;
    }
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
      <View style={[styles.host, isWideDesktop ? styles.desktopHost : null]}>
        <ComposerHeader title="New campaign" onBack={handleBack} onSaveDraft={() => {}} saveDraftDisabled />
        <View style={styles.centerHost}>
          <ActivityIndicator size="small" color={textTokens.secondary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.host, isWideDesktop ? styles.desktopHost : null]}>
      <ComposerHeader
        title="New campaign"
        onBack={handleBack}
        onSaveDraft={() => {
          void handleSaveDraft();
        }}
        saveDraftDisabled={!isDirty}
      />
      <Toast
        visible={errorBanner !== null}
        kind="error"
        message={errorBanner ?? ""}
        onDismiss={() => setErrorBanner(null)}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={[styles.kavHost, isWideDesktop ? styles.desktopKavHost : null]}
      >
        {/* ORCH-0891 M2: ComposerCanvas wraps the editor column with a
            permanent right-hand EmailPreviewPane on wide-desktop. On
            narrow web + native, the Canvas is a Fragment passthrough —
            only the editor column renders, and the existing Modal-based
            preview (triggered by ComposerFooter's Preview button) shows
            on demand. Per SPEC §3.5.2 + DESIGN_SPEC §2. */}
        <ComposerCanvas
          editor={
            <>
              {/* Stage F.7: NO ScrollView around the editor — pell's WebView
                  inside a ScrollView blocks taps on iOS (RN WebView gesture
                  conflict). Flex column instead: Who fixed, Editor flex:1,
                  When+Compliance fixed below editor. */}
              <View style={[styles.whoRow, isWideDesktop ? styles.desktopWhoRow : null]}>
                <ComposerStepWho
                  audienceName={audienceName}
                  reachableEmail={reach?.reachable_email ?? null}
                  totalAudience={reach?.total ?? null}
                  onOpenPicker={() => setShowAudiencePicker(true)}
                  disabled={brandId === null}
                />
              </View>

              <ComposerV2Editor
                ref={editorHandleRef}
                initialBodyHtml={body}
                subject={subject}
                onSubjectChange={onSubjectChange}
                onBodyChange={onBodyChange}
                editable={!scheduleMutation.isPending}
                brandEvents={brandEvents}
                templates={templates}
                previewVariables={previewVariables}
                brandName={brandName}
                currentDraftIsDirty={isDirty}
                onErrorToast={(msg) => setErrorBanner(msg)}
              />

              {/* F.10b: 3-button footer (Preview / Send Now / Schedule).
                  ORCH-0891 M2 note: On wide-desktop the EmailPreviewPane
                  is permanently visible in the right pane, so tapping
                  the Preview button additionally opens the Modal on
                  top — redundant but not broken. M3 may hide the
                  Preview button on wide-desktop as a polish item. */}
              <ComposerFooter
                onPreview={() => setShowPreview(true)}
                onSendNow={() => {
            // F.10c hard-guard: refuse to open the review sheet if the
            // core fields aren't filled. Mirrors the disabled state on
            // the button but defends against any case where the disabled
            // visual slips (e.g. rapid taps mid-state-update).
            const missing = missingFieldsLabel();
            if (missing !== null) {
              setErrorBanner(missing);
              return;
            }
            setSendMode("now");
            setShowReview(true);
          }}
          sendNowDisabled={coreFooterDisabled}
          onSchedule={() => {
            const missing = missingFieldsLabel();
            if (missing !== null) {
              setErrorBanner(missing);
              return;
            }
            setShowSchedulePicker(true);
          }}
          scheduleDisabled={coreFooterDisabled}
          submitting={scheduleMutation.isPending}
        />
            </>
          }
          preview={
            isWideDesktop ? (
              <EmailPreviewPane
                subject={subject}
                bodyHtml={body}
                variables={previewVariables}
                brandName={brandName}
                brandHeaderImageUrl={
                  currentBrand?.coverMediaType !== "video"
                    ? (currentBrand?.coverMediaUrl ?? null)
                    : null
                }
                embeddedEvents={brandEvents.filter((e) =>
                  extractEmbeddedEventIds(body).includes(e.id),
                )}
              />
            ) : undefined
          }
        />

        {/* Sub-sheets MUST render inside this parent KeyboardAvoidingView per
            feedback_rn_sub_sheet_must_render_inside_parent.md. */}
        <AudiencePickerSheet
          visible={showAudiencePicker}
          brandId={brandId}
          brandName={brandName}
          selectedAudienceId={audienceId}
          onClose={() => setShowAudiencePicker(false)}
          onSelect={handleSelectAudience}
        />
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
        <SchedulePickerSheet
          visible={showSchedulePicker}
          initialIso={scheduledForIso}
          onClose={() => setShowSchedulePicker(false)}
          onContinue={(iso) => {
            // F.10b race fix: iOS won't present a second Modal while the
            // first one is mid-dismiss. Closing the picker and opening
            // the review sheet in the same state batch leaves the UI
            // frozen behind an invisible backdrop. Defer the review open
            // by ~350ms — past the Sheet primitive's dismiss animation.
            setSendMode("schedule");
            setScheduledForIso(iso);
            setShowSchedulePicker(false);
            setTimeout(() => {
              setShowReview(true);
            }, 350);
          }}
        />
        {/* F.10b: Inbox preview modal — renders the email exactly as the
            buyer will receive it (FROM/SUBJECT chrome, brand banner OR
            Mingla logo, variable-substituted body, inline event cards,
            unsubscribe footer). */}
        <Modal
          visible={showPreview}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowPreview(false)}
        >
          <View style={styles.previewModal}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Inbox preview</Text>
              <Pressable
                onPress={() => setShowPreview(false)}
                accessibilityRole="button"
                accessibilityLabel="Close preview"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.previewDone,
                  pressed ? styles.previewDonePressed : null,
                ]}
              >
                <Text style={styles.previewDoneLabel}>Done</Text>
              </Pressable>
            </View>
            <EmailPreviewPane
              subject={subject}
              bodyHtml={body}
              variables={previewVariables}
              brandName={brandName}
              brandHeaderImageUrl={
                currentBrand?.coverMediaType !== "video"
                  ? (currentBrand?.coverMediaUrl ?? null)
                  : null
              }
              embeddedEvents={brandEvents.filter((e) =>
                extractEmbeddedEventIds(body).includes(e.id),
              )}
            />
          </View>
        </Modal>
        {/* F.9: TemplatePreviewDrawer and InsertionBar moved back inside
            ComposerV2Editor (merged toolbar position requires them
            adjacent to subject + body). compose.tsx no longer mounts
            them directly. */}

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

// V1's body_text was derived via the same stripHtml regex. Stage F keeps it
// as a local helper so the token-string → plain-text fallback is identical to
// what marketing-send reads on the server side.
function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, "");
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  desktopHost: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.09)",
    backgroundColor: "rgba(255, 255, 255, 0.018)",
    overflow: "hidden",
  },
  kavHost: {
    flex: 1,
  },
  desktopKavHost: {
    backgroundColor: "transparent",
  },
  centerHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // F.9b: even-rhythm spacing — every section gets paddingV: spacing.xs.
  whoRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  desktopWhoRow: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  // F.10b: Preview modal chrome — light "inbox" canvas behind the sheet,
  // white header with title + orange Done button. EmailPreviewPane fills
  // the rest.
  previewModal: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECECEE",
  },
  previewTitle: {
    ...typography.bodyLg,
    color: "#0F1115",
    fontWeight: "700",
  },
  previewDone: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  previewDonePressed: {
    opacity: 0.6,
  },
  previewDoneLabel: {
    ...typography.body,
    color: "#F47C20",
    fontWeight: "700",
  },
});
