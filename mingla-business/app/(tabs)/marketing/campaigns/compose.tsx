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

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView routed through SmartScrollView wrapper (KAS
// on native, plain RN ScrollView on web). KeyboardAvoidingView removed —
// KAS scrolls the focused TextInput exactly above the keyboard. Per
// SPEC_ORCH-0892-B_v2 §7.F.
import { ScrollView } from "../../../../src/wrappers/SmartScrollView";
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
// ORCH-1281 — phone-text-bubble preview, branched in for channel === 'sms'.
import { SmsPreviewPane } from "../../../../src/components/marketing/SmsPreviewPane";
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
import { MarketingBookSendError } from "../../../../src/services/marketing/marketingCampaignService";
import { getTemplate } from "../../../../src/services/marketing/marketingTemplateService";
import { extractEmbeddedEventIds } from "../../../../src/services/marketing/tenTapTokenBridge";
import { useBrandEvents } from "../../../../src/services/marketing/brandEvents";
import { ChannelTabs } from "../../../../src/components/marketing/ChannelTabs";
import type { MarketingChannelKind } from "../../../../src/components/marketing/ChannelTabs";
import { SmsComposeCard } from "../../../../src/components/marketing/SmsComposeCard";
import type { PreviewVariables } from "../../../../src/services/marketing/marketingRenderingService";
import type {
  CampaignChannelPayload,
  MarketingBookQuote,
} from "../../../../src/types/marketing";
// ORCH-1282 — MMS photo attach: cross-platform pick (native picker / browser
// file input), upload to the public brand_covers bucket, verified public URL.
import { uploadMarketingMmsImage } from "../../../../src/services/marketingMmsImageService";
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from "../../../../src/utils/platformImagePicker";
import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
  type BrowserPickedFile,
} from "../../../../src/utils/browserFilePicker";
import { BrandCoverError } from "../../../../src/utils/brandCoverRules";
// ORCH-1281 — wire body (incl. STOP footer) for the review-sheet MESSAGE row.
import { bodyWithFooter } from "../../../../src/utils/smsCost";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useFeatureFlag } from "../../../../src/hooks/useFeatureFlag";
import {
  getBookBlastDisabledReason,
  isBookBlastFeatureReady,
  useBookBlastPreview,
  useConfirmBookBlast,
} from "../../../../src/hooks/marketing/useBookBlastPreview";
import { useAuth } from "../../../../src/context/AuthContext";
import { useResponsiveLayout } from "../../../../src/hooks/useResponsiveLayout";
import { useShareNetworkState } from "../../../../src/components/ui/useShareNetworkState";
// ORCH-0891 M3 D-3 — wire the M2-shipped composer keyboard shortcuts.
// On native this resolves to the no-op `.ts` sibling; web picks the
// .web.ts implementation that installs the global keydown listener.
import { useComposerKeyboardShortcuts } from "../../../../src/hooks/useComposerKeyboardShortcuts";
// ORCH-1270 F-1 — SMS timing helper: the soonest global send window, used to
// label + drive the "Schedule for …" secondary CTA in the review sheet's
// always-on "How SMS timing works" info note.
import { nextGlobalSendWindowOpen } from "../../../../src/utils/marketing/smsSendWindow";

// ORCH-1289 — Twilio MMS accepts up to 10 media items per message.
const MMS_MAX_MEDIA = 10;

// ORCH-1289 — one attached MMS photo. `remoteUrl` is the VERIFIED public URL
// (the only thing that ever rides the payload); `localUri` is an optimistic
// preview shown while uploading; `objectUrl` (web only) is revoked on removal so
// blob URLs don't leak. Display prefers `remoteUrl` (cross-platform-renderable
// and == what is sent) and falls back to `localUri` only pre-upload.
type MmsMediaItem = {
  key: string;
  localUri: string | null;
  objectUrl: string | null;
  remoteUrl: string | null;
  uploading: boolean;
};

let mmsKeySeq = 0;
function makeMediaKey(): string {
  mmsKeySeq += 1;
  return `mms-${Date.now().toString(36)}-${mmsKeySeq}`;
}

export default function ComposeCampaignRoute(): React.ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const { isWideDesktop } = useResponsiveLayout();
  const params = useLocalSearchParams<{
    audience?: string;
    draft?: string;
    template?: string;
  }>();
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
  const importFlag = useFeatureFlag("contact_import_v1"),
    bookFlag = useFeatureFlag("brand_book_blast_v1");
  const bookBlastEnabled = isBookBlastFeatureReady(importFlag, bookFlag);

  const resolvedAudience = useResolveAudience(audienceParam);

  // Composer state
  const [channel, setChannel] = useState<MarketingChannelKind>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // META-ORCH-1161 Sub-B — SMS blast body (plain text, separate from the HTML
  // email `body`). Only used when channel === 'sms'.
  const [smsBody, setSmsBody] = useState("");
  // ORCH-1282 / ORCH-1289 — MMS photo attach (up to MMS_MAX_MEDIA). `mmsMedia`
  // holds each picked photo with its optimistic local preview + verified public
  // URL. `mmsMediaUrls` (derived) is the VERIFIED-URL-only array that rides the
  // payload — a local blob/file uri NEVER reaches it.
  const [mmsMedia, setMmsMedia] = useState<MmsMediaItem[]>([]);
  // Keep the latest media in a ref so the unmount cleanup can revoke web blob
  // URLs without re-registering the effect on every change.
  const mmsMediaRef = useRef<MmsMediaItem[]>([]);
  mmsMediaRef.current = mmsMedia;
  // Verified public URLs only — the array persisted into channel_payload.media_urls.
  const mmsMediaUrls = useMemo<string[]>(
    () =>
      mmsMedia.reduce<string[]>((acc, m) => {
        if (m.remoteUrl !== null) acc.push(m.remoteUrl);
        return acc;
      }, []),
    [mmsMedia],
  );
  // True while ANY attached photo is still uploading.
  const mmsUploading = useMemo(
    () => mmsMedia.some((m) => m.uploading),
    [mmsMedia],
  );
  // Display projections for the compose card (thumb row) + preview pane (tiles).
  const mmsComposeItems = useMemo(
    () =>
      mmsMedia.map((m) => ({
        key: m.key,
        uri: m.remoteUrl ?? m.localUri,
        uploading: m.uploading,
      })),
    [mmsMedia],
  );
  const mmsPreviewUris = useMemo<string[]>(
    () =>
      mmsMedia.reduce<string[]>((acc, m) => {
        const uri = m.remoteUrl ?? m.localUri;
        if (uri !== null) acc.push(uri);
        return acc;
      }, []),
    [mmsMedia],
  );
  const [audienceId, setAudienceId] = useState<string | null>(null);
  const [audienceName, setAudienceName] = useState<string | null>(null);
  const [isBookAudience, setIsBookAudience] = useState(false);
  const [bookQuote, setBookQuote] = useState<MarketingBookQuote | null>(null);
  const [bookRequestId, setBookRequestId] = useState<string | null>(null);
  const [bookStaleWarning, setBookStaleWarning] = useState(false);
  const [bookStaleDetail, setBookStaleDetail] = useState<string | undefined>();
  const [bookNow, setBookNow] = useState(() => Date.now());
  const [bookPreviewError, setBookPreviewError] = useState<string | null>(null);
  const bookPreviewMutation = useBookBlastPreview(),
    bookConfirmMutation = useConfirmBookBlast();
  const bookOnline = useShareNetworkState();
  const [sendMode, setSendMode] = useState<SendMode>("now");
  const [scheduledForIso, setScheduledForIso] = useState("");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showAudiencePicker, setShowAudiencePicker] = useState(false);
  const [showReview, setShowReview] = useState(false);
  // ORCH-1270 F-1 — soonest global send window, captured at the Send-now tap
  // (no live re-render needed) to label the "Schedule for …" CTA. Only
  // meaningful for channel === 'sms'.
  const [nextWindowIso, setNextWindowIso] = useState<string | null>(null);
  // F.10b: preview modal + schedule-picker sheet — both live in compose.tsx
  // so the footer buttons can drive them directly.
  const [showPreview, setShowPreview] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showSentConfirmation, setShowSentConfirmation] = useState(false);
  const [isSendNowConfirmation, setIsSendNowConfirmation] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  useEffect(() => {
    if (!showReview || !isBookAudience) return;
    const timer = setInterval(() => setBookNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [showReview, isBookAudience]);
  const bookDisabledReason = getBookBlastDisabledReason({
    featureReady: bookBlastEnabled,
    online: bookOnline,
    previewPending: bookPreviewMutation.isPending,
    previewError: bookPreviewError,
    quote: bookQuote,
    nowMs: bookNow,
  });

  const bookPreviewFailure = (error: unknown): string => {
    const code = error instanceof Error ? error.message : "BOOK_BLAST_FAILED";
    if (code.includes("COST"))
      return "Provider cost could not be verified. Refresh the preview before confirming.";
    if (code.includes("MMS"))
      return "MMS media could not be verified. Fix the media or refresh the preview.";
    if (code.includes("FORBIDDEN"))
      return "You no longer have permission to send this campaign.";
    if (code.includes("FLAG_DISABLED") || code.includes("AUDIENCE_NOT_FOUND"))
      return "Book blasts aren't available. Your access or this feature changed.";
    return "The server preview is unavailable. Refresh it before confirming.";
  };

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

  // ORCH-1289 — revoke any web object URLs on unmount so blob previews don't
  // leak (native items carry objectUrl === null; this is a no-op there).
  useEffect(() => {
    return () => {
      revokeBrowserPickedFiles(
        mmsMediaRef.current
          .filter((m) => m.objectUrl !== null)
          .map((m) => ({ objectUrl: m.objectUrl })),
      );
    };
  }, []);

  // Hydrate audience from query param (lazy: ensures system audience row exists).
  useEffect(() => {
    if (audienceParam === null || accountId === null || brandId === null)
      return;
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
            err instanceof Error
              ? err.message
              : "Couldn't load audience — pick one below.",
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
        } else if (row.channel_payload.kind === "sms") {
          setSmsBody(row.channel_payload.body);
          // ORCH-1282 / ORCH-1289 — restore a reopened MMS draft's attachments as
          // already-verified remote items (no local preview / objectUrl needed).
          setMmsMedia(
            (row.channel_payload.media_urls ?? []).map((url) => ({
              key: makeMediaKey(),
              localUri: null,
              objectUrl: null,
              remoteUrl: url,
              uploading: false,
            })),
          );
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
  // META-ORCH-1161 Sub-B — build the channel-correct payload. Email keeps its
  // HTML + embedded-events shape; SMS carries the plain body. The service derives
  // `channel` from `kind`, so the discriminated union drives everything.
  const buildPayload = useCallback((): CampaignChannelPayload => {
    if (channel === "sms") {
      // ORCH-1282 — only attach media_urls when a verified photo is present.
      return {
        kind: "sms",
        body: smsBody,
        ...(mmsMediaUrls.length > 0 ? { media_urls: mmsMediaUrls } : {}),
      };
    }
    return {
      kind: "email",
      subject,
      body_html: body,
      body_text: stripHtml(body),
      embedded_events: extractEmbeddedEventIds(body),
    };
  }, [channel, smsBody, mmsMediaUrls, subject, body]);

  // Campaign name — email uses the subject; SMS uses the first ~40 chars of the
  // body (SMS has no subject line).
  const campaignName = useMemo<string>(() => {
    if (channel === "sms") {
      const firstLine = smsBody.trim().split(/\r?\n/)[0]?.slice(0, 40) ?? "";
      return firstLine.length > 0 ? firstLine : "Untitled SMS blast";
    }
    return subject.length > 0 ? subject : "Untitled campaign";
  }, [channel, smsBody, subject]);

  const flushDraft = useCallback(async (): Promise<string | null> => {
    if (accountId === null || brandId === null || audienceId === null)
      return null;
    const payload = buildPayload();
    try {
      if (campaignId === null) {
        const row = await createDraft({
          account_id: accountId,
          brand_id: brandId,
          audience_id: audienceId,
          name: campaignName,
          channel_payload: payload,
          ...(templateId !== null ? { template_id: templateId } : {}),
        });
        setCampaignId(row.id);
        setIsDirty(false);
        return row.id;
      } else {
        await updateDraft({
          campaign_id: campaignId,
          name: campaignName,
          audience_id: audienceId,
          channel_payload: payload,
        });
      }
      setIsDirty(false);
      return campaignId;
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Couldn't save draft. Tap Save draft to retry.",
      );
    }
    return null;
  }, [
    accountId,
    brandId,
    audienceId,
    campaignName,
    buildPayload,
    campaignId,
    templateId,
  ]);

  useComposerDraft({
    // ORCH-1282 — include mmsMediaUrls so autosave re-fires when media changes.
    state: {
      channel,
      subject,
      body,
      smsBody,
      mmsMediaUrls,
      embeddedEvents: extractEmbeddedEventIds(body),
      audienceId,
    },
    isDirty,
    flush: async () => {
      await flushDraft();
    },
  });

  // F.10b: core validation for footer buttons — audience + subject + body
  // are the minimum needed BEFORE the user opens Schedule (date-time picker)
  // or Send Now (review sheet). The schedule-time check is enforced inside
  // the picker + review sheet, not at the footer level.
  // META-ORCH-1161 Sub-B — channel-aware content readiness. Email needs subject
  // + HTML body; SMS needs just the plain body (no subject line).
  const contentReady = useMemo<boolean>(() => {
    if (channel === "sms") return smsBody.trim().length > 0;
    return subject.trim().length > 0 && body.trim().length > 0;
  }, [channel, smsBody, subject, body]);

  const coreFooterDisabled = useMemo<boolean>(() => {
    return audienceId === null || !contentReady;
  }, [audienceId, contentReady]);

  // F.10c: human-readable "what's missing" message for the toast banner
  // that fires when an operator taps Send Now / Schedule before filling
  // the required fields. Returns null when everything is filled.
  const missingFieldsLabel = useCallback((): string | null => {
    // ORCH-1289 — never fire a send while a photo is mid-upload; only VERIFIED
    // public URLs ride the payload, so a partial send would silently drop media.
    if (channel === "sms" && mmsUploading) {
      return "Photos are still uploading — try again in a moment.";
    }
    const missing: string[] = [];
    if (audienceId === null) missing.push("an audience");
    if (channel === "sms") {
      if (smsBody.trim().length === 0) missing.push("a message");
    } else {
      if (subject.trim().length === 0) missing.push("a subject");
      if (body.trim().length === 0) missing.push("a message");
    }
    if (missing.length === 0) return null;
    if (missing.length === 1) return `Pick ${missing[0]} before sending.`;
    if (missing.length === 2)
      return `Add ${missing[0]} and ${missing[1]} first.`;
    return `Add ${missing[0]}, ${missing[1]}, and ${missing[2]} first.`;
  }, [audienceId, channel, smsBody, subject, body, mmsUploading]);

  // Validation — Review CTA disabled until required fields are present.
  const validationIssues = useMemo<string[]>(() => {
    const issues: string[] = [];
    if (audienceId === null) issues.push("Pick an audience");
    if (channel === "sms") {
      if (smsBody.trim().length === 0) issues.push("Message required");
    } else {
      if (subject.trim().length === 0) issues.push("Subject required");
      if (body.trim().length === 0) issues.push("Body required");
    }
    if (sendMode === "schedule") {
      if (scheduledForIso.trim().length === 0) {
        issues.push("Pick a send time");
      } else {
        const d = new Date(scheduledForIso);
        if (Number.isNaN(d.getTime())) issues.push("Invalid date");
      }
    }
    return issues;
  }, [audienceId, channel, smsBody, subject, body, sendMode, scheduledForIso]);

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
    if (isBookAudience) {
      if (bookQuote === null || bookRequestId === null) return;
      bookConfirmMutation.mutate(
        {
          campaign_id: campaignId,
          client_request_id: bookRequestId,
          quote: bookQuote,
          scheduled_for:
            sendMode === "now" ? null : new Date(scheduledForIso).toISOString(),
        },
        {
          onSuccess: () => {
            setShowReview(false);
            setShowSentConfirmation(true);
          },
          onError: (error) => {
            if (
              error instanceof MarketingBookSendError &&
              error.refreshedPreview !== null
            ) {
              const next = error.refreshedPreview;
              setBookStaleDetail(
                `Reach changed from ${bookQuote.reachableCount} to ${next.reachableCount}; cost changed from ${bookQuote.estimatedCostMinor ?? "not metered"} to ${next.estimatedCostMinor ?? "not metered"}.`,
              );
              setBookQuote(next);
              setBookRequestId(
                globalThis.crypto?.randomUUID?.() ??
                  `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
              );
              setBookStaleWarning(true);
              return;
            }
            setErrorBanner(
              "Confirmation failed. Refresh the preview and retry.",
            );
          },
        },
      );
      return;
    }
    Keyboard.dismiss();
    const isoForServer =
      sendMode === "now"
        ? new Date().toISOString()
        : new Date(scheduledForIso).toISOString();
    scheduleMutation.mutate({
      campaign_id: campaignId,
      scheduled_for: isoForServer,
      name: campaignName,
      // META-ORCH-1161 Sub-B — channel-correct payload (email HTML or SMS body).
      channel_payload: buildPayload(),
    });
  }, [
    campaignId,
    isBookAudience,
    bookQuote,
    bookRequestId,
    bookConfirmMutation,
    sendMode,
    scheduledForIso,
    campaignName,
    buildPayload,
    scheduleMutation,
  ]);

  // ORCH-1270 F-1 — capture the soonest global send window at the moment the
  // operator taps Send now (SMS only), to label the review sheet's "Schedule
  // for …" secondary CTA. The info note itself is always shown for an SMS
  // send-now — it's informational (off-hours recipients are held, not lost),
  // not a conditional warning.
  const captureSmsSendWindow = useCallback((): void => {
    if (channel !== "sms") {
      setNextWindowIso(null);
      return;
    }
    setNextWindowIso(nextGlobalSendWindowOpen(new Date()).toISOString());
  }, [channel]);

  // ORCH-1270 RC-3 — "Schedule for {next window}" secondary CTA. Schedules the
  // blast for the soonest sending window instead of firing into a currently
  // out-of-hours send. Uses the freshly-computed ISO directly (not the async
  // state) so there's no stale-closure race with handleConfirmSchedule.
  const handleScheduleForNextWindow = useCallback((): void => {
    if (campaignId === null) return;
    const iso = nextGlobalSendWindowOpen(new Date()).toISOString();
    setSendMode("schedule");
    setScheduledForIso(iso);
    setShowReview(false);
    Keyboard.dismiss();
    scheduleMutation.mutate({
      campaign_id: campaignId,
      scheduled_for: iso,
      name: campaignName,
      channel_payload: buildPayload(),
    });
  }, [campaignId, campaignName, buildPayload, scheduleMutation]);

  // Back-block — intercept exits if dirty.
  //
  // ORCH-1100 RC-3: `Alert.alert` is a NO-OP on react-native-web. On web the
  // old path would `preventDefault()` the navigation and then call
  // `Alert.alert(...)`, which never renders a dialog — so Back stayed cancelled
  // forever (the button looked dead). On web we instead rely on the existing
  // debounced autosave (`useComposerDraft` + `flushDraft`): fire a final flush
  // and let the navigation proceed, so the draft is preserved without a
  // no-op dialog. The native Alert.alert dirty-guard below is unchanged.
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      "beforeRemove" as never,
      (event: unknown) => {
        const ev = event as {
          preventDefault: () => void;
          data?: { action?: unknown };
        };
        if (sanctionedExitRef.current) return;
        if (!isDirty) return;
        if (Platform.OS === "web") {
          // Don't block the exit — autosave already persists edits. Fire one last
          // flush (fire-and-forget) in case the debounced save hasn't run yet.
          void flushDraft();
          return;
        }
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
      },
    );
    return unsubscribe;
  }, [navigation, isDirty, campaignId, flushDraft, router]);

  // Audience preview variables — fed to the V2 editor's template-drawer
  // live-preview pane via the editor's props.
  const previewVariables = useMemo<PreviewVariables>(() => {
    const firstBuyerName = resolvedAudience.data?.rows[0]?.display_name ?? null;
    const firstName =
      firstBuyerName !== null ? firstBuyerName.split(/\s+/)[0] : null;
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

  // META-ORCH-1161 Sub-B — channel switch (Email ↔ SMS). Marks dirty so the
  // channel choice persists to the draft.
  const handleChannelChange = useCallback(
    (next: MarketingChannelKind): void => {
      setChannel(next);
      setIsDirty(true);
      // ORCH-1282 / ORCH-1289 — attached photos are meaningless off the SMS
      // channel; clear them (and revoke any web blob URLs first).
      if (next !== "sms") {
        revokeBrowserPickedFiles(
          mmsMedia
            .filter((m) => m.objectUrl !== null)
            .map((m) => ({ objectUrl: m.objectUrl })),
        );
        setMmsMedia([]);
      }
    },
    [mmsMedia],
  );

  // ORCH-1282 / ORCH-1289 — pick + upload up to MMS_MAX_MEDIA photos. Mirrors
  // ExperienceStopPhotoSheet.pickFromLibrary cross-platform acquisition (native
  // picker / browser file input) so web parity follows the shipped pattern.
  // Each picked photo is added optimistically (uploading), then swapped to its
  // VERIFIED public URL as its upload resolves. The local blob is kept alive for
  // the optimistic preview and revoked on removal / channel-change / unmount —
  // NOT immediately after upload (the old finally-revoke killed the web preview).
  const handlePickMms = useCallback(async (): Promise<void> => {
    if (brandId === null) return;
    const remaining = MMS_MAX_MEDIA - mmsMedia.length;
    if (remaining <= 0) {
      setErrorBanner(
        `A picture message can carry up to ${MMS_MAX_MEDIA} photos.`,
      );
      return;
    }
    type PickedAsset = {
      uri: string;
      mimeType?: string | null;
      fileName?: string | null;
      fileSize?: number | null;
      objectUrl: string | null;
    };
    try {
      let assets: PickedAsset[] = [];
      if (Platform.OS === "web") {
        const result = await pickBrowserFiles({
          accept: "image/jpeg,image/png,image/gif",
          maxFiles: remaining,
          multiple: true,
          validate: false,
        });
        if (result.canceled || result.files.length === 0) return;
        assets = result.files.map((f: BrowserPickedFile) => ({
          uri: f.uri,
          mimeType: f.mimeType,
          fileName: f.name,
          fileSize: f.size,
          objectUrl: f.objectUrl,
        }));
      } else {
        const permission = await requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setErrorBanner("Photo library permission is needed to add a photo.");
          return;
        }
        const result = await launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
          allowsMultipleSelection: true,
          selectionLimit: remaining,
        });
        if (result.canceled || result.assets.length === 0) return;
        assets = result.assets.map((picked) => ({
          uri: picked.uri,
          mimeType: picked.mimeType,
          fileName: picked.fileName,
          fileSize: picked.fileSize,
          objectUrl: null,
        }));
      }

      // Clamp to the remaining slots (selectionLimit / maxFiles clamp already,
      // but defend + revoke any dropped web blobs so they don't leak).
      let overflow = false;
      if (assets.length > remaining) {
        const dropped = assets.slice(remaining);
        revokeBrowserPickedFiles(
          dropped
            .filter((a) => a.objectUrl !== null)
            .map((a) => ({ objectUrl: a.objectUrl })),
        );
        assets = assets.slice(0, remaining);
        overflow = true;
      }

      // Add all picked photos optimistically (uploading), then upload in parallel.
      const newItems: MmsMediaItem[] = assets.map((a) => ({
        key: makeMediaKey(),
        localUri: a.uri,
        objectUrl: a.objectUrl,
        remoteUrl: null,
        uploading: true,
      }));
      setMmsMedia((prev) => [...prev, ...newItems]);
      setIsDirty(true);
      if (overflow) {
        setErrorBanner(
          `Added the first ${remaining} — a picture message can carry up to ${MMS_MAX_MEDIA} photos.`,
        );
      }

      await Promise.all(
        newItems.map(async (item, i) => {
          const a = assets[i];
          try {
            const url = await uploadMarketingMmsImage(brandId, {
              uri: a.uri,
              mimeType: a.mimeType,
              fileName: a.fileName,
              fileSize: a.fileSize,
            });
            // Swap this item to its verified public URL — display now prefers it.
            setMmsMedia((prev) =>
              prev.map((m) =>
                m.key === item.key
                  ? { ...m, remoteUrl: url, uploading: false }
                  : m,
              ),
            );
            setIsDirty(true);
          } catch (err) {
            // Drop the failed item + revoke its blob; surface the reason.
            setMmsMedia((prev) => prev.filter((m) => m.key !== item.key));
            if (item.objectUrl !== null) {
              revokeBrowserPickedFiles([{ objectUrl: item.objectUrl }]);
            }
            setErrorBanner(
              err instanceof BrandCoverError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Couldn't add that photo. Try another.",
            );
          }
        }),
      );
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Couldn't add that photo. Try another.",
      );
    }
  }, [brandId, mmsMedia.length]);

  const handleRemoveMms = useCallback(
    (key: string): void => {
      const removed = mmsMedia.find((m) => m.key === key);
      if (removed?.objectUrl != null) {
        revokeBrowserPickedFiles([{ objectUrl: removed.objectUrl }]);
      }
      setMmsMedia((prev) => prev.filter((m) => m.key !== key));
      setIsDirty(true);
    },
    [mmsMedia],
  );

  // Reachability shown in the Who row + review sheet depends on the channel.
  const channelReachable =
    channel === "sms"
      ? (reach?.reachable_sms ?? null)
      : (reach?.reachable_email ?? null);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/marketing/campaigns" as never);
  }, [router]);

  const handleSaveDraft = useCallback(async (): Promise<void> => {
    await flushDraft();
  }, [flushDraft]);

  const handleSelectAudience = useCallback(
    async (option: AudienceOption) => {
      setAudienceName(option.name);
      setIsBookAudience(option.kind === "all_brand_people");
      setBookQuote(null);
      setIsDirty(true);
      if (option.existing_audience_id !== null) {
        setAudienceId(option.existing_audience_id);
        return;
      }
      if (accountId === null || brandId === null) return;
      if (option.kind === "all_brand_people") return;
      try {
        const id =
          option.kind === "brand_buyers"
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
    },
    [accountId, brandId],
  );

  const onSubjectChange = useCallback((value: string) => {
    setSubject(value);
    setIsDirty(true);
  }, []);

  const onBodyChange = useCallback((value: string) => {
    setBody(value);
    setIsDirty(true);
  }, []);

  const scheduledLabel =
    sendMode === "now"
      ? "Send immediately"
      : scheduledForIso.length > 0
        ? new Date(scheduledForIso).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
        : "Pick a time";

  // ORCH-1270 RC-3 — short human label for the "Schedule for …" affordance,
  // same locale format as scheduledLabel.
  const nextWindowLabel =
    nextWindowIso !== null
      ? new Date(nextWindowIso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "";

  // ORCH-0891 M3 D-3: install web composer keyboard shortcuts. Hook is
  // unconditional (Rules of Hooks) and a no-op on native. Handlers are
  // stable closures over the same setters used by the footer buttons.
  // ⌘P is intentionally no-op on wide-desktop (the preview pane is
  // permanent — no toggle target); narrow web opens the Modal.
  useComposerKeyboardShortcuts({
    onBold: (): void => {
      editorHandleRef.current?.toggleBold();
    },
    onItalic: (): void => {
      editorHandleRef.current?.toggleItalic();
    },
    onLink: (): void => {
      editorHandleRef.current?.toggleLink();
    },
    onSendNow: (): void => {
      const missing = missingFieldsLabel();
      if (missing !== null) {
        setErrorBanner(missing);
        return;
      }
      if (coreFooterDisabled) return;
      captureSmsSendWindow();
      setSendMode("now");
      if (isBookAudience) {
        void (async () => {
          const id = await flushDraft();
          if (id === null) {
            setErrorBanner("Save the draft, then preview again.");
            return;
          }
          setBookPreviewError(null);
          setBookQuote(null);
          setShowReview(true);
          try {
            const quote = await bookPreviewMutation.mutateAsync(id);
            setBookQuote(quote);
            setBookStaleWarning(false);
            setBookRequestId(
              globalThis.crypto?.randomUUID?.() ??
                `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
            );
          } catch (error) {
            setBookPreviewError(bookPreviewFailure(error));
          }
        })();
        return;
      }
      setShowReview(true);
    },
    onTogglePreview: (): void => {
      if (isWideDesktop) return;
      setShowPreview((prev) => !prev);
    },
    onToggleDrawer: (): void => {
      editorHandleRef.current?.toggleTemplateDrawer();
    },
    onCloseAny: (): void => {
      // Esc closes any open Modal/Sheet — in priority order so closing
      // the topmost surface first feels natural to a keyboard user.
      if (showSentConfirmation) {
        setShowSentConfirmation(false);
        return;
      }
      if (showReview) {
        setShowReview(false);
        return;
      }
      if (showSchedulePicker) {
        setShowSchedulePicker(false);
        return;
      }
      if (showAudiencePicker) {
        setShowAudiencePicker(false);
        return;
      }
      if (showPreview) {
        setShowPreview(false);
        return;
      }
    },
  });

  // Pre-fill loading skeleton
  if (audienceParam !== null && audienceId === null && errorBanner === null) {
    return (
      <View style={[styles.host, isWideDesktop ? styles.desktopHost : null]}>
        <ComposerHeader
          title="New campaign"
          onBack={handleBack}
          onSaveDraft={() => {}}
          saveDraftDisabled
        />
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
      <View
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
              <View
                style={[
                  styles.whoRow,
                  isWideDesktop ? styles.desktopWhoRow : null,
                ]}
              >
                <ComposerStepWho
                  audienceName={audienceName}
                  reachableEmail={channelReachable}
                  totalAudience={reach?.total ?? null}
                  onOpenPicker={() => setShowAudiencePicker(true)}
                  disabled={brandId === null}
                />
              </View>

              {/* META-ORCH-1161 Sub-B — channel selector (Email · SMS). */}
              <View style={styles.channelRow}>
                <ChannelTabs active={channel} onChange={handleChannelChange} />
              </View>

              {channel === "sms" ? (
                <SmsComposeCard
                  value={smsBody}
                  onChangeText={(text) => {
                    setSmsBody(text);
                    setIsDirty(true);
                  }}
                  reachableSms={reach?.reachable_sms ?? null}
                  currencyCode={currentBrand?.defaultCurrency ?? "USD"}
                  editable={!scheduleMutation.isPending}
                  brandId={brandId}
                  media={mmsComposeItems}
                  maxMedia={MMS_MAX_MEDIA}
                  uploading={mmsUploading}
                  onPickMedia={() => {
                    void handlePickMms();
                  }}
                  onRemoveMedia={handleRemoveMms}
                />
              ) : (
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
              )}

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
                  // ORCH-1270 RC-3 — snapshot the send window at tap time (SMS only).
                  captureSmsSendWindow();
                  setSendMode("now");
                  if (isBookAudience) {
                    void (async () => {
                      const id = await flushDraft();
                      if (id === null) {
                        setErrorBanner("Save the draft, then preview again.");
                        return;
                      }
                      setBookPreviewError(null);
                      setBookQuote(null);
                      setShowReview(true);
                      try {
                        const quote = await bookPreviewMutation.mutateAsync(id);
                        setBookQuote(quote);
                        setBookStaleWarning(false);
                        setBookRequestId(
                          globalThis.crypto?.randomUUID?.() ??
                            `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
                        );
                      } catch (error) {
                        setBookPreviewError(bookPreviewFailure(error));
                      }
                    })();
                  } else setShowReview(true);
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
              // ORCH-1281 — SMS channel shows the phone-bubble preview; email
              // keeps EmailPreviewPane (untouched).
              channel === "sms" ? (
                <SmsPreviewPane
                  body={smsBody}
                  brandName={brandName}
                  reachableSms={reach?.reachable_sms ?? null}
                  currencyCode={currentBrand?.defaultCurrency ?? "USD"}
                  hasMedia={mmsMedia.length > 0}
                  mediaUris={mmsPreviewUris}
                />
              ) : (
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
              )
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
          actorId={accountId}
          bookBlastEnabled={bookBlastEnabled}
        />
        <ComposerReviewSheet
          visible={showReview}
          audienceName={audienceName}
          recipientCount={
            isBookAudience
              ? (bookQuote?.reachableCount ?? null)
              : channelReachable
          }
          subject={subject}
          scheduledLabel={scheduledLabel}
          isSendNow={sendMode === "now"}
          submitting={
            scheduleMutation.isPending ||
            bookConfirmMutation.isPending ||
            bookPreviewMutation.isPending
          }
          onBack={() => setShowReview(false)}
          onClose={() => setShowReview(false)}
          onConfirm={handleConfirmSchedule}
          smsInfoNote={channel === "sms"}
          nextWindowLabel={nextWindowLabel}
          onScheduleForNextWindow={
            isBookAudience ? undefined : handleScheduleForNextWindow
          }
          // ORCH-1281 — SMS shows a MESSAGE row (wire body) instead of SUBJECT.
          channelKind={channel === "sms" ? "sms" : "email"}
          messagePreview={bodyWithFooter(smsBody).slice(0, 160)}
          hasMedia={mmsMedia.length > 0}
          estimatedCostLabel={
            isBookAudience && bookQuote !== null
              ? bookQuote.costKind === "not_metered"
                ? "Provider cost not metered"
                : `${bookQuote.currency ?? ""} ${((bookQuote.estimatedCostMinor ?? 0) / 100).toFixed(2)} estimated provider cost`
              : undefined
          }
          selectedCount={isBookAudience ? bookQuote?.selectedCount : undefined}
          suppressedCount={
            isBookAudience ? bookQuote?.suppressedCount : undefined
          }
          unavailableCount={
            isBookAudience ? bookQuote?.unavailableCount : undefined
          }
          quoteExpiresAt={isBookAudience ? bookQuote?.expiresAt : undefined}
          staleWarning={bookStaleWarning}
          disabledReason={isBookAudience ? bookDisabledReason : null}
          retryDisabled={isBookAudience && !bookOnline}
          staleDetail={bookStaleDetail}
          onRetryPreview={
            isBookAudience && campaignId !== null
              ? () => {
                  setBookPreviewError(null);
                  bookPreviewMutation.mutate(campaignId, {
                    onSuccess: (quote) => {
                      setBookQuote(quote);
                      setBookNow(Date.now());
                      setBookStaleWarning(false);
                    },
                    onError: (error) =>
                      setBookPreviewError(bookPreviewFailure(error)),
                  });
                }
              : undefined
          }
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
              if (!isBookAudience) {
                setShowReview(true);
                return;
              }
              void (async () => {
                const id = await flushDraft();
                if (id === null) return;
                setBookPreviewError(null);
                setBookQuote(null);
                setShowReview(true);
                try {
                  const quote = await bookPreviewMutation.mutateAsync(id);
                  setBookQuote(quote);
                  setBookStaleWarning(false);
                  setBookRequestId(
                    globalThis.crypto?.randomUUID?.() ??
                      `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
                  );
                } catch (error) {
                  setBookPreviewError(bookPreviewFailure(error));
                }
              })();
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
              {/* ORCH-1281 — title tracks the channel. */}
              <Text style={styles.previewTitle}>
                {channel === "sms" ? "Message preview" : "Inbox preview"}
              </Text>
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
            {/* ORCH-1281 — SMS gets the phone-bubble preview (brings its own
                dark canvas); email keeps EmailPreviewPane. */}
            {channel === "sms" ? (
              <SmsPreviewPane
                body={smsBody}
                brandName={brandName}
                reachableSms={reach?.reachable_sms ?? null}
                currencyCode={currentBrand?.defaultCurrency ?? "USD"}
                hasMedia={mmsMedia.length > 0}
                mediaUris={mmsPreviewUris}
              />
            ) : (
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
            )}
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
      </View>
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
  // META-ORCH-1161 Sub-B — channel selector row, same rhythm as whoRow.
  channelRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
