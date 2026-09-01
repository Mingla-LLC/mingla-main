/**
 * ORCH-0821 — ToolProposalCard
 *
 * The critical UX moment. Renders a proposed write (create_brand / update_brand /
 * delete_brand / create_event / update_event) as a confirmation card with
 * Cancel / Edit / Confirm actions.
 *
 * Edit mode expands in place (no modal) — ToolEditForm.
 *
 * ORCH-1103 — brand CRUD + in-chat media:
 *   - Cover band (Surface 1, 5 states) on create_brand / update_brand.
 *   - Q7 create-row-first/attach-second device+video upload at create.
 *   - Delete-variant card (Surface 2): live cascade preview + type-to-confirm +
 *     future-events refusal. Delete uses semantic.error (destructive), the one
 *     intentional departure from "all primary actions = userBubble".
 */

import React, { useState } from "react";
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
import { AlertTriangle, Pencil, Play, Plus, X } from "lucide-react-native";

import {
  ariPalette,
  ariThread,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";
import { isToolProposalEditable, ToolEditForm } from "./ToolEditForm";
import { GlassChrome } from "../ui/GlassChrome";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import type { CoverPatch } from "../ui/CoverPicker";
import type { CoverTarget } from "../ui/coverTarget";
import { useBrandCascadePreview } from "../../hooks/useBrands";
import { randomId } from "../../utils/randomId";
import type { ConfirmOutcome } from "./toolProposalTypes";

// Premium proposal-card metrics — tighter than the default kit values.
const CARD_PADDING = ariThread.cardPad; // 12
const IDENTITY_FONT = ariThread.cardTitleFont; // 15
const IDENTITY_LINE = ariThread.cardTitleLine; // 21
const FIELD_LABEL_FONT = 11;
const FIELD_VALUE_FONT = 13;
const VERB_FONT = 10;
const VERB_LETTER_SPACING = 1.1;
const BUTTON_HEIGHT = ariThread.btnHeight; // 34
const BUTTON_FONT = 13;

const EMPTY_COVER_PATCH: CoverPatch = {
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};

export interface ToolProposalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  isExecuting: boolean;
  /**
   * ORCH-1103 — returns the commit outcome so the create-time cover flow can
   * read back the newly-created brandId and re-target the picker (Q7
   * create-row-first / attach-second). Resolves `{ ok, brandId? }`.
   */
  onConfirm: (editedArgs?: Record<string, unknown>, keepPending?: boolean) => Promise<ConfirmOutcome>;
  onCancel: () => void;
  /**
   * Brand-name lookup for delete/update target display + type-to-confirm
   * matching + disambiguation. Keyed by brand id. Sourced from the
   * prompt-known brand list (AriChatScreen passes it down).
   */
  brandNamesById?: Record<string, string>;
  /** The signed-in account id — needed to construct the brand CoverTarget. */
  accountId?: string | null;
  /**
   * ORCH-1103 Q7 — called after the create-for-cover commit + cover attach
   * resolves, so the host clears the now-executed pending action and the
   * brand receipt renders in its place.
   *
   * ORCH-1103 REWORK 3 — the cover is attached AFTER the create commit (the
   * picker persists to brands.cover_media_url), so the executed tool_result row
   * written at create-time has a NULL cover. The card passes the final attached
   * cover up here so the host can overlay it onto the receipt — otherwise the
   * receipt shows only the slug (defect #3). `cover` is omitted/null when the
   * user finished without choosing a cover (coverless receipt, no error).
   */
  onAttachDone?: (cover?: { url: string | null; type: string | null }) => void;
}

interface Field {
  label: string;
  value: string;
}

function humanizeToolName(toolName: string): string {
  switch (toolName) {
    case "create_brand": return "Create brand";
    case "update_brand": return "Update brand";
    case "delete_brand": return "Delete brand";
    case "manage_brand_hours": return "Update venue hours";
    case "manage_brand_discovery_currency": return "Update discovery currency";
    case "create_event": return "Create event";
    case "update_event": return "Update event";
    case "cancel_event": return "Cancel event";
    case "discard_event_draft": return "Discard draft";
    case "send_campaign_now": return "Send campaign";
    case "refund_order": return "Refund order";
    case "request_account_deletion": return "Delete account";
    case "propose_site_content_update": return "Confirm Website draft";
    case "propose_site_settings_update": return "Confirm Website settings draft";
    case "attach_approved_site_media": return "Confirm Website image";
    case "create_site_preview": return "Create private preview";
    case "publish_site": return "Publish Website";
    case "rollback_site": return "Publish earlier Website version";
    default: return toolName.replace(/_/g, " ");
  }
}

/** Destructive / money tools that reuse the brand type-to-confirm gate. */
export const MONEY_CONFIRM_TOOLS: Record<string, string> = {
  cancel_event: "CANCEL",
  discard_event_draft: "DISCARD",
  refund_rsvp_contribution: "REFUND",
  send_campaign_now: "SEND",
  disconnect_partner: "DISCONNECT",
  refund_order: "REFUND",
  cancel_order: "CANCEL",
  cancel_trip_booking: "CANCEL",
  export_brand_people: "EXPORT",
  request_account_deletion: "DELETE",
};

const COVER_OFFERING_TOOLS = new Set([
  "create_event",
  "update_event",
  "set_event_cover",
  "create_experience",
  "update_experience",
  "create_trip",
  "update_trip",
]);

function primaryIdentity(
  toolName: string,
  args: Record<string, unknown>,
  brandNamesById: Record<string, string>,
): string {
  if (toolName === "create_brand") return (args.name as string) || "New brand";
  if (toolName === "create_event") return (args.title as string) || "New event";
  if (toolName === "update_event") return "Event update";
  if (toolName === "update_brand" || toolName === "delete_brand") {
    const id = typeof args.brand_id === "string" ? args.brand_id : "";
    return brandNamesById[id] ?? (toolName === "update_brand" ? "Brand update" : "This brand");
  }
  if (typeof args.title === "string" && args.title) return args.title;
  if (typeof args.name === "string" && args.name) return args.name;
  if (typeof args.subject === "string" && args.subject) return args.subject;
  return toolName.replace(/_/g, " ");
}

function coverTypeLabel(type: unknown): string | null {
  if (type === "video") return "Video";
  if (type === "gif") return "GIF";
  if (type === "image") return "Image";
  return null;
}

function fieldsFor(toolName: string, args: Record<string, unknown>): Field[] {
  const out: Field[] = [];
  const isSiteTool = [
    "propose_site_content_update",
    "propose_site_settings_update",
    "attach_approved_site_media",
    "create_site_preview",
    "publish_site",
    "rollback_site",
  ].includes(toolName);
  if (isSiteTool) {
    const brandId = typeof args.brand_id === "string" ? args.brand_id : "";
    out.push({ label: "Brand", value: brandId ? `${brandId.slice(0, 8)}…` : "Selected brand" });
    if (typeof args.page_role === "string") {
      out.push({ label: "Page", value: args.page_role.replace(/_/g, " ") });
    }
    if (typeof args.change_summary === "string") {
      out.push({ label: "Exact change", value: args.change_summary });
    }
    if (typeof args.expected_revision === "string") {
      out.push({ label: "Expected revision", value: args.expected_revision });
    }
    out.push({
      label: "Effect",
      value: ["publish_site", "rollback_site"].includes(toolName)
        ? "Changes the verified public Website"
        : toolName === "create_site_preview"
        ? "Private preview — not live"
        : "Draft only — does not publish",
    });
    return out;
  }
  if (toolName === "manage_brand_hours" && Array.isArray(args.hours)) {
    const weekdayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const rows = args.hours
      .filter((raw): raw is Record<string, unknown> => typeof raw === "object" && raw !== null)
      .slice()
      .sort((a, b) => Number(a.weekday) - Number(b.weekday));
    for (const row of rows) {
      const weekday = Number(row.weekday);
      const label = weekdayLabels[weekday] ?? `Day ${weekday}`;
      const value = row.is_closed === true
        ? "Closed"
        : `${String(row.open_time ?? "—")}–${String(row.close_time ?? "—")}`;
      out.push({ label, value });
    }
    return out;
  }
  if (toolName === "manage_brand_discovery_currency") {
    if (typeof args.currency_code === "string") {
      out.push({ label: "Currency", value: args.currency_code.toUpperCase() });
    }
    if (typeof args.expected_state_version === "number") {
      out.push({ label: "State version", value: String(args.expected_state_version) });
    }
    if (typeof args.decision === "string") {
      out.push({ label: "Decision", value: args.decision.replace(/_/g, " ") });
    }
    return out;
  }
  const context = args.__proposal_context !== null && typeof args.__proposal_context === "object"
    ? args.__proposal_context as Record<string, unknown>
    : {};
  if (toolName === "upsert_ticket_tier") {
    out.push({ label: "Event state", value: String(context.lifecycle ?? "event") });
    out.push({ label: "Action", value: String(context.action ?? "update") });
    const tierName = typeof args.name === "string" ? args.name : context.tier_name;
    if (typeof tierName === "string") out.push({ label: "Tier", value: tierName });
    const currency = typeof context.effective_currency === "string" ? context.effective_currency : "currency pending";
    if (typeof context.current_price_cents === "number" || typeof context.proposed_price_cents === "number") {
      out.push({
        label: "Price",
        value: `${typeof context.current_price_cents === "number" ? `${(context.current_price_cents / 100).toFixed(2)} ${currency}` : "new"} → ${typeof context.proposed_price_cents === "number" ? `${(context.proposed_price_cents / 100).toFixed(2)} ${currency}` : "Free"}`,
      });
    }
    out.push({
      label: "Capacity",
      value: `${context.current_capacity ?? "new"} → ${context.proposed_capacity ?? "Unlimited"}`,
    });
    out.push({ label: "Payout check", value: context.payout_ready === true ? "Ready" : "Not needed" });
    out.push({ label: "Available", value: String(context.available_at ?? "both") });
  }
  if (toolName === "set_pricing_switches" || toolName === "set_brand_pricing_defaults") {
    if (args.tax !== undefined) out.push({ label: "Tax", value: `${String(context.current_tax ?? "inherit")} → ${String(args.tax)}` });
    if (args.mingla_fee !== undefined) out.push({ label: "Mingla fee", value: `${String(context.current_mingla_fee ?? "inherit")} → ${String(args.mingla_fee)}` });
    if (args.service_fee !== undefined) out.push({ label: "Service fee", value: `${String(context.current_service_fee ?? "inherit")} → ${String(args.service_fee)}` });
  }
  if (toolName === "create_event" || toolName === "update_event") {
    if (typeof args.start_at === "string") {
      const d = new Date(args.start_at);
      if (!Number.isNaN(d.getTime())) {
        const date = d.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        out.push({ label: "When", value: date });
      }
    }
    if (typeof args.location_text === "string" && args.location_text) {
      out.push({ label: "Where", value: args.location_text });
    }
    if (typeof args.brand_id === "string") {
      out.push({ label: "Brand", value: String(args.brand_id).slice(0, 8) + "…" });
    }
    if (typeof args.visibility === "string") {
      out.push({ label: "Visibility", value: args.visibility });
    }
  }
  if (toolName === "create_brand" || toolName === "update_brand") {
    if (typeof args.name === "string" && args.name) {
      out.push({ label: "Name", value: args.name });
    }
    if (typeof args.description === "string" && args.description) {
      out.push({ label: "Description", value: args.description });
    }
    if (typeof args.contact_email === "string" && args.contact_email) {
      out.push({ label: "Contact email", value: args.contact_email });
    }
    if (typeof args.default_currency === "string") {
      out.push({ label: "Currency", value: args.default_currency });
    }
    if (typeof args.slug === "string") {
      out.push({ label: "Slug", value: args.slug });
    }
    // ORCH-1103 — textual echo of the cover for screen-reader linearity.
    const ct = coverTypeLabel(args.cover_media_type);
    if (typeof args.cover_media_url === "string" && args.cover_media_url && ct) {
      out.push({ label: "Cover", value: ct });
    }
  }
  if (out.length === 0) {
    const skip = new Set([
      "brand_id",
      "event_id",
      "cover_media_url",
      "cover_media_poster_url",
      "cover_media_type",
      "confirm_phrase",
      "__proposal_context",
    ]);
    for (const [key, value] of Object.entries(args)) {
      if (skip.has(key) || value == null || value === "") continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out.push({ label: key.replace(/_/g, " "), value: String(value) });
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Cover band (Surface 1, ORCH-1103) — empty / selected-image / selected-video /
// uploading / error. Whole band pressable; "Add cover" pill the visible affordance.
// ----------------------------------------------------------------------------

type CoverUploadState = "idle" | "creating" | "uploading" | "processing" | "error";

interface CoverBandProps {
  url: string | null;
  type: unknown;
  uploadState: CoverUploadState;
  onOpen: () => void;
  onRemove: () => void;
  disabled: boolean;
}

const CoverBand: React.FC<CoverBandProps> = ({
  url,
  type,
  uploadState,
  onOpen,
  onRemove,
  disabled,
}) => {
  if (uploadState === "creating" || uploadState === "uploading" || uploadState === "processing") {
    const busyLabel =
      uploadState === "creating"
        ? "Creating brand…"
        : uploadState === "processing"
          ? "Processing video…"
          : "Uploading cover…";
    return (
      <View
        style={[styles.coverBand, styles.coverBandBusy]}
        accessibilityLabel={
          uploadState === "creating" ? "Creating your brand, please wait." : "Uploading cover, please wait."
        }
      >
        <ActivityIndicator size="large" color={textTokens.inverse} />
        <Text style={styles.coverBusyLabel}>{busyLabel}</Text>
      </View>
    );
  }

  const hasCover = typeof url === "string" && url.length > 0;
  if (hasCover) {
    const isVideo = type === "video";
    return (
      <View style={[styles.coverBand, styles.coverBandFilled]} accessibilityLabel="Cover selected. Double-tap to change.">
        {!isVideo ? (
          <Image source={{ uri: url as string }} style={styles.coverImage} accessibilityIgnoresInvertColors resizeMode="cover" />
        ) : (
          <View style={styles.coverVideoFallback}>
            <View style={styles.playDisc}>
              <Play size={20} color="#ffffff" />
            </View>
          </View>
        )}
        {/* type chip bottom-left */}
        <View style={styles.coverTypeChip}>
          <Text style={styles.coverTypeChipText}>{coverTypeLabel(type) ?? "Cover"}</Text>
        </View>
        {/* change / remove discs bottom-right */}
        <View style={styles.coverControls}>
          <Pressable
            onPress={onOpen}
            disabled={disabled}
            hitSlop={8}
            style={styles.coverDisc}
            accessibilityRole="button"
            accessibilityLabel="Change cover"
          >
            <Pencil size={14} color="#ffffff" />
          </Pressable>
          <Pressable
            onPress={onRemove}
            disabled={disabled}
            hitSlop={8}
            style={styles.coverDisc}
            accessibilityRole="button"
            accessibilityLabel="Remove cover"
          >
            <X size={14} color="#ffffff" />
          </Pressable>
        </View>
      </View>
    );
  }

  // EMPTY (or post-error retry)
  const isError = uploadState === "error";
  return (
    <Pressable
      onPress={onOpen}
      disabled={disabled}
      style={[styles.coverBand, styles.coverBandEmpty]}
      accessibilityRole="button"
      accessibilityLabel="Add a cover image or video for this brand"
      accessibilityHint="Opens the cover picker"
    >
      <View style={styles.coverPill}>
        <Plus size={16} color={textTokens.secondary} />
        <Text style={styles.coverPillLabel}>{isError ? "Try again" : "Add cover"}</Text>
      </View>
      {isError ? (
        <View style={styles.coverErrorRow}>
          <AlertTriangle size={14} color={semantic.error} />
          <Text style={styles.coverSubLabel}>Couldn&apos;t upload that cover. Tap to try again.</Text>
        </View>
      ) : (
        <Text style={styles.coverSubLabel}>Optional — image or video</Text>
      )}
    </Pressable>
  );
};

export const ToolProposalCard: React.FC<ToolProposalCardProps> = ({
  toolName,
  args,
  isExecuting,
  onConfirm,
  onCancel,
  brandNamesById = {},
  accountId = null,
  onAttachDone,
}) => {
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState<Record<string, unknown>>(args);
  const [coverSheetVisible, setCoverSheetVisible] = useState(false);
  const [coverUploadState, setCoverUploadState] = useState<CoverUploadState>("idle");
  const [typedName, setTypedName] = useState("");
  // ORCH-1103 Q7 — create-row-first / attach-second. On a create proposal the
  // reused CoverPicker persists EVERY brand media (device, video, Pexels, GIPHY)
  // live to a real brandId — so the brand row must exist before the picker can
  // open. When the user taps "Add cover" on a create proposal we surface an
  // inline "Create & attach" confirm; committing it mints the brand, captures
  // the new id here, then opens the full picker against the real brand.
  const [createAttachVisible, setCreateAttachVisible] = useState(false);
  const [createdBrandId, setCreatedBrandId] = useState<string | null>(null);
  const [createDescription, setCreateDescription] = useState<string | null>(null);
  const [creatingForCover, setCreatingForCover] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);

  const verb = humanizeToolName(toolName);
  // ORCH-1103 REWORK 3 — after a "Create & attach" commit the picker writes the
  // chosen cover into editedArgs, so the band must read editedArgs (not the
  // original proposal args) to reflect the freshly-attached cover.
  const committedForArgs = createdBrandId !== null;
  const liveArgs = editing || committedForArgs ? editedArgs : args;
  const identity = primaryIdentity(toolName, liveArgs, brandNamesById);
  const isBrandCreate = toolName === "create_brand";
  const isBrandUpdate = toolName === "update_brand";
  const isBrandDelete = toolName === "delete_brand";
  const moneyPhrase = MONEY_CONFIRM_TOOLS[toolName] ?? null;
  const isMoneyConfirm = moneyPhrase !== null;
  const isTypeConfirm = isBrandDelete || isMoneyConfirm;
  const isBrandWithCover = isBrandCreate || isBrandUpdate;
  const isOfferingCover =
    COVER_OFFERING_TOOLS.has(toolName) &&
    typeof liveArgs.event_id === "string" &&
    typeof liveArgs.brand_id === "string";
  const isCoverTool = isBrandWithCover || isOfferingCover;
  const isSiteDraftConfirm = [
    "propose_site_content_update",
    "propose_site_settings_update",
    "attach_approved_site_media",
  ].includes(toolName);
  const isSitePublishConfirm = toolName === "publish_site";
  const isSiteRollbackConfirm = toolName === "rollback_site";

  // ----- delete-variant -----------------------------------------------------
  const deleteBrandId = isBrandDelete && typeof args.brand_id === "string" ? args.brand_id : null;
  const cascade = useBrandCascadePreview(isBrandDelete ? deleteBrandId : null);
  const deleteName = isBrandDelete ? identity : "";
  const canDelete =
    typedName.trim().toLowerCase() === deleteName.trim().toLowerCase() && deleteName.length > 0;
  const canMoneyConfirm =
    !!moneyPhrase && typedName.trim().toUpperCase() === moneyPhrase;

  // ----- cover threading -----------------------------------------------------
  const coverUrl = (liveArgs.cover_media_url as string | undefined) ?? null;
  const coverPosterUrl = (liveArgs.cover_media_poster_url as string | undefined) ?? null;
  const coverType = liveArgs.cover_media_type;

  const handleCoverChange = async (patch: CoverPatch): Promise<void> => {
    const selectionRef = patch.coverMediaUrl ? randomId() : undefined;
    if (selectionRef && typeof liveArgs.event_id === "string") {
      try {
        const { registerEventCoverSelection } = await import(
          "../../services/eventCoverMediaService"
        );
        await registerEventCoverSelection(
          liveArgs.event_id,
          selectionRef,
          patch.coverMediaUrl,
          patch.coverMediaType,
          patch.coverMediaPosterUrl,
          {
            provider: patch.coverMediaProvider,
            sourceUrl: patch.coverMediaSourceUrl,
            credit: patch.coverMediaCredit,
            creditUrl: patch.coverMediaCreditUrl,
            alt: patch.coverMediaAlt,
          },
        );
      } catch {
        setCoverUploadState("error");
        return;
      }
    }
    setEditedArgs((prev) => ({
      ...prev,
      cover_media_url: patch.coverMediaUrl ?? undefined,
      cover_media_poster_url: patch.coverMediaPosterUrl ?? undefined,
      cover_media_type: patch.coverMediaType ?? undefined,
      cover_media_provider: patch.coverMediaProvider ?? undefined,
      cover_media_source_url: patch.coverMediaSourceUrl ?? undefined,
      cover_media_credit: patch.coverMediaCredit ?? undefined,
      cover_media_credit_url: patch.coverMediaCreditUrl ?? undefined,
      cover_media_alt: patch.coverMediaAlt ?? undefined,
      selection_ref: selectionRef,
      clear_cover: patch.coverMediaUrl ? false : undefined,
    }));
    if (patch.coverMediaUrl) setCoverUploadState("idle");
  };

  const handleRemoveCover = (): void => {
    setEditedArgs((prev) => {
      const next = { ...prev };
      delete next.cover_media_url;
      delete next.cover_media_poster_url;
      delete next.cover_media_type;
      delete next.cover_media_provider;
      delete next.cover_media_source_url;
      delete next.cover_media_credit;
      delete next.cover_media_credit_url;
      delete next.cover_media_alt;
      delete next.selection_ref;
      if (toolName === "set_event_cover") {
        next.clear_cover = true;
      }
      return next;
    });
  };

  // The brand CoverTarget — requires a real brandId. On UPDATE the id comes
  // from args.brand_id. On CREATE the id only exists AFTER the brand is minted
  // (Q7), captured in `createdBrandId`. Either path yields a real, RLS-valid
  // brand target the reused CoverPicker can persist against.
  const updateBrandId = isBrandUpdate && typeof args.brand_id === "string" ? args.brand_id : null;
  const effectiveBrandId = createdBrandId ?? updateBrandId;
  const offeringKind: "event" | "trip" | "experience" =
    toolName.includes("trip") ? "trip" : toolName.includes("experience") ? "experience" : "event";
  const coverTarget: CoverTarget | null =
    isBrandWithCover && effectiveBrandId && accountId
      ? {
          kind: "brand",
          brandId: effectiveBrandId,
          accountId,
          existingDescription:
            createdBrandId !== null
              ? createDescription
              : (args.description as string | null) ?? null,
        }
      : isOfferingCover && typeof liveArgs.brand_id === "string" && typeof liveArgs.event_id === "string"
        ? {
            kind: offeringKind,
            brandId: liveArgs.brand_id,
            eventRowId: liveArgs.event_id,
            coverMediaApplyMode: "draft_auto",
          }
        : null;

  // ORCH-1103 — what happens when the user taps "Add cover".
  //   - EDIT (real brand_id already): open the picker directly.
  //   - CREATE, brand already minted this session (createdBrandId set): open
  //     the picker directly against the minted brand.
  //   - CREATE, no brand yet: surface the inline "Create & attach" confirm
  //     INSTEAD of a dead tap. Committing it mints the brand, then opens the
  //     picker (handled in handleCreateAndAttach).
  const handleAddCoverPress = (): void => {
    if (coverTarget) {
      setCoverSheetVisible(true);
      return;
    }
    if (isBrandCreate) {
      setCreateAttachVisible(true);
      return;
    }
    // isBrandUpdate but no accountId / brand_id — nothing to attach to. Leave
    // the affordance inert rather than opening an empty sheet (defensive; the
    // host always passes accountId + brand_id for an update proposal).
  };

  const confirmProposal = async (
    nextArgs?: Record<string, unknown>,
    keepPending?: boolean,
  ): Promise<ConfirmOutcome> => {
    setProposalError(null);
    try {
      const outcome = await onConfirm(nextArgs, keepPending);
      if (!outcome.ok && outcome.error && outcome.terminal !== "expired") {
        setProposalError(outcome.error);
      }
      return outcome;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "Couldn't complete that action — try again.";
      setProposalError(message);
      return { ok: false, error: message };
    }
  };

  // ORCH-1103 Q7 — mint the brand, then open the full picker against it. The
  // picker can't have its target swapped while mounted, so we close it (it is
  // not yet open here), set the new brandId (which builds coverTarget), and
  // open it fresh against the real brand — the design-approved close+reopen
  // path. The "Creating brand…" band state covers the ~300–800ms commit.
  const handleCreateAndAttach = async (): Promise<void> => {
    setCreateAttachVisible(false);
    setCreatingForCover(true);
    try {
      // Persist the description we send so the post-create cover upload (which
      // round-trips brands.description via useBrandCoverUpload) keeps it.
      const desc =
        typeof editedArgs.description === "string"
          ? (editedArgs.description as string)
          : null;
      setCreateDescription(desc);
      // keepPending = true → the host does NOT clear the pending action, so this
      // card stays mounted to host the picker and run the attach. We clear it
      // ourselves (onAttachDone) once the cover sheet closes.
      setProposalError(null);
      const outcome = await onConfirm(editing ? editedArgs : undefined, true);
      if (!outcome.ok && outcome.error && outcome.terminal !== "expired") {
        setProposalError(outcome.error);
      }
      if (outcome.ok && outcome.brandId) {
        setCreatedBrandId(outcome.brandId);
        // Open the full picker against the freshly-minted brand. coverTarget is
        // rebuilt from createdBrandId on the next render before the sheet mounts.
        setCoverSheetVisible(true);
      } else if (outcome.ok) {
        // Commit succeeded but no brandId came back (e.g. edge fn not yet
        // deployed). The brand exists; resolve the proposal so the receipt
        // renders — the user can add a cover from the brand's edit path.
        onAttachDone?.();
      }
      // If the commit failed (outcome.ok false) the screen toast already shows;
      // the card stays put with the Add-cover affordance still live.
    } catch (error) {
      setProposalError(error instanceof Error
        ? error.message
        : "Couldn't complete that action — try again.");
    } finally {
      setCreatingForCover(false);
    }
  };

  // ORCH-1103 REWORK 3 — closing the picker no longer auto-resolves the card.
  // After a create-and-attach commit the card stays in its committed state
  // (cover band reflecting the chosen cover, "Done" the single live action) so
  // the user can review or change the cover before finishing. Tapping "Done"
  // (handleDone) is the one path that resolves the pending action and renders
  // the receipt — exactly once. (On UPDATE there is no committed state; the
  // picker close just dismisses the sheet, the proposal is still pending and is
  // confirmed via the normal Confirm button.)
  const handleCoverSheetClose = (): void => {
    setCoverSheetVisible(false);
  };

  const initialPatch: CoverPatch = coverUrl
    ? { ...EMPTY_COVER_PATCH, coverMediaUrl: coverUrl, coverMediaPosterUrl: coverPosterUrl ?? (coverType === "image" ? coverUrl : null), coverMediaType: (coverType as CoverPatch["coverMediaType"]) ?? null }
    : EMPTY_COVER_PATCH;

  // ORCH-1103 REWORK 3 — once the brand has been minted via "Create & attach"
  // (createdBrandId set), the underlying pending action is already EXECUTED.
  // The card stays mounted ONLY to host the cover picker (attach) and to let
  // the user finish. It MUST NOT expose any control that re-confirms the
  // executed action — re-confirming returns a 400 "Cannot confirm — current
  // status: executed". So after commit the primary Confirm + Edit + Cancel are
  // replaced by a single "Done" affordance; the only other live control is the
  // cover band (attach). This makes an already-executed re-confirm impossible
  // from the UI (P1 headline defect).
  const committed = createdBrandId !== null;

  // ORCH-1103 REWORK 3 — the final attached cover (or null) captured from the
  // picker's live writes into editedArgs, handed to the host so the receipt can
  // show the cover the executed tool_result row doesn't carry.
  const finishCover = (): { url: string | null; type: string | null } => ({
    url: (editedArgs.cover_media_url as string | undefined) ?? null,
    type: (editedArgs.cover_media_type as string | undefined) ?? null,
  });

  const handleDone = (): void => {
    // Finish the create-and-attach lifecycle. If the picker is open it is closed
    // first; resolving the pending action lets the host render the receipt with
    // whatever cover was attached (or none).
    setCoverSheetVisible(false);
    onAttachDone?.(finishCover());
  };

  const confirmDisabled = isExecuting || creatingForCover || coverUploadState !== "idle";
  const canEditProposal = isToolProposalEditable(toolName, liveArgs);

  return (
    <GlassChrome
      intensity="cardElevated"
      tintColor={glass.tint.profileElevated}
      borderColor={isTypeConfirm ? "rgba(239,68,68,0.32)" : ariPalette.proposalBorder}
      radius="lg"
      style={styles.card}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <View style={styles.headerRow}>
          <AriOrb size="xs" decorative />
          {isTypeConfirm ? <AlertTriangle size={12} color={semantic.error} /> : null}
          <Text
            style={[styles.verb, isTypeConfirm && styles.verbDanger]}
            numberOfLines={1}
          >
            {verb.toUpperCase()}
          </Text>
        </View>

        <Text style={styles.identity} numberOfLines={2}>{identity}</Text>

        {isSiteDraftConfirm || isSitePublishConfirm || isSiteRollbackConfirm ? (
          <View style={styles.assuranceRow}>
            <Text style={styles.assuranceText}>
              {isSiteDraftConfirm
                ? "This confirmation updates the saved draft only. It will not publish the Website."
                : isSiteRollbackConfirm
                ? "This is a separate rollback confirmation. The selected earlier revision will be validated and published as a new version."
                : "This is a separate publish confirmation. Mingla will validate and verify this exact revision before the public Website changes."}
            </Text>
          </View>
        ) : null}

        {/* ORCH-1103 — DELETE variant: assurance + cascade + type-to-confirm */}
        {isBrandDelete ? (
          <>
            <View style={styles.assuranceRow}>
              <Text style={styles.assuranceText}>
                Recoverable for 30 days. Your data stays — events, orders, refunds, audit logs are
                preserved. Recovery needs support after that.
              </Text>
            </View>
            {cascade.isLoading ? (
              <View style={styles.fields}>
                <View style={styles.skeletonRow} />
                <View style={[styles.skeletonRow, { width: "70%" }]} />
              </View>
            ) : cascade.data ? (
              <View style={styles.fields}>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Past events</Text>
                  <Text style={styles.fieldValue}>{cascade.data.pastEventCount}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Team members</Text>
                  <Text style={styles.fieldValue}>{cascade.data.teamMemberCount}</Text>
                </View>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Stripe Connect</Text>
                  <Text style={styles.fieldValue}>
                    {cascade.data.hasStripeConnect ? "Linked (will unlink)" : "Not linked"}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.coverSubLabel}>Couldn&apos;t load counts — you can still delete.</Text>
            )}
            <Text style={styles.confirmHelper}>
              Type <Text style={styles.confirmHelperName}>{deleteName}</Text> to confirm
            </Text>
            <TextInput
              value={typedName}
              onChangeText={setTypedName}
              placeholder={deleteName}
              placeholderTextColor={textTokens.quaternary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.confirmInput}
              accessibilityLabel="Type the brand name to confirm deletion"
              accessibilityHint="The delete button enables when the name matches"
            />
          </>
        ) : isMoneyConfirm && moneyPhrase ? (
          <>
            <View style={styles.assuranceRow}>
              <Text style={styles.assuranceText}>
                This cannot be undone from chat. Type {moneyPhrase} to confirm.
              </Text>
            </View>
            <Text style={styles.confirmHelper}>
              Type <Text style={styles.confirmHelperName}>{moneyPhrase}</Text> to confirm
            </Text>
            <TextInput
              value={typedName}
              onChangeText={setTypedName}
              placeholder={moneyPhrase}
              placeholderTextColor={textTokens.quaternary}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.confirmInput}
              accessibilityLabel={`Type ${moneyPhrase} to confirm`}
            />
          </>
        ) : null}

        {/* Cover band — brands plus events/trips/experiences that already have ids */}
        {isCoverTool ? (
          <View style={styles.coverWrap}>
            <CoverBand
              url={coverUrl}
              type={coverType}
              uploadState={creatingForCover ? "creating" : coverUploadState}
              onOpen={handleAddCoverPress}
              onRemove={handleRemoveCover}
              disabled={isExecuting || creatingForCover}
            />
            {/* Q7 — create-time inline "Create & attach" confirm. Shown only on a
                create proposal with no brand yet, when the user reaches for a
                cover. It explains the order of operations (we mint the brand so
                the cover — device, video, Pexels, or GIPHY — has a home) and is
                the ONLY moment create differs from edit. Never a dead tap. */}
            {createAttachVisible && isBrandCreate ? (
              <View style={styles.createAttachRow}>
                <Text style={styles.createAttachText}>
                  We&apos;ll create <Text style={styles.createAttachName}>{identity}</Text> so your
                  cover has a home.
                </Text>
                <View style={styles.createAttachActions}>
                  <Pressable
                    onPress={() => setCreateAttachVisible(false)}
                    hitSlop={{ top: 5, bottom: 5 }}
                    style={({ pressed }) => [styles.createAttachCancel, pressed && styles.btnPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Not now"
                  >
                    <Text style={styles.cancelText}>Not now</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleCreateAndAttach()}
                    hitSlop={{ top: 5, bottom: 5 }}
                    style={({ pressed }) => [styles.createAttachConfirm, pressed && styles.btnPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Create the brand and add a cover"
                  >
                    <Text style={styles.confirmText}>Create &amp; attach</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {editing && !isTypeConfirm ? (
          <ToolEditForm
            toolName={toolName}
            args={editedArgs}
            onChange={setEditedArgs}
          />
        ) : (
          !isTypeConfirm && fieldsFor(toolName, liveArgs).length > 0 && (
            <View style={styles.fields}>
              {fieldsFor(toolName, liveArgs).map((f, i) => (
                <View key={i} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <Text style={styles.fieldValue} numberOfLines={1}>{f.value}</Text>
                </View>
              ))}
            </View>
          )
        )}

        {proposalError ? (
          <Text style={styles.proposalError} accessibilityRole="alert">
            {proposalError} Confirm again to retry safely.
          </Text>
        ) : null}

        <View style={styles.actions}>
          {/* ORCH-1103 REWORK 3 — POST-COMMIT (create-and-attach minted the
              brand): the pending action is EXECUTED. The ONLY action is "Done"
              (finish + render the receipt). No Cancel / Edit / Confirm — every
              one of those would re-touch the executed action. The cover band
              above stays live so the user can still attach/change a cover. */}
          {committed ? (
            <Pressable
              onPress={handleDone}
              disabled={isExecuting || creatingForCover || coverUploadState !== "idle"}
              hitSlop={{ top: 5, bottom: 5 }}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.confirmBtn,
                pressed && styles.btnPressed,
                (isExecuting || creatingForCover || coverUploadState !== "idle") && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Done"
              accessibilityState={{ disabled: isExecuting || creatingForCover || coverUploadState !== "idle" }}
            >
              <Text style={styles.confirmText}>Done</Text>
            </Pressable>
          ) : (
          <>
          <Pressable
            onPress={onCancel}
            disabled={isExecuting}
            hitSlop={{ top: 5, bottom: 5 }}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.cancelBtn,
              pressed && styles.btnPressed,
              isExecuting && styles.btnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Cancel proposal"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>

          {/* Delete-variant has no Edit button; the typed-name field is the gate */}
          {isBrandDelete ? (
            <Pressable
              onPress={() =>
                void confirmProposal({
                  ...args,
                  confirm_phrase: typedName.trim(),
                })
              }
              disabled={isExecuting || !canDelete}
              hitSlop={{ top: 5, bottom: 5 }}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.deleteBtn,
                !canDelete && styles.deleteBtnDisabled,
                pressed && styles.btnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Delete brand"
              accessibilityState={{ disabled: isExecuting || !canDelete }}
            >
              <Text style={[styles.deleteText, !canDelete && styles.deleteTextDisabled]}>
                {isExecuting ? "Deleting…" : "Delete brand"}
              </Text>
            </Pressable>
          ) : isMoneyConfirm && moneyPhrase ? (
            <Pressable
              onPress={() =>
                void confirmProposal({
                  ...(editing ? editedArgs : args),
                  confirm_phrase: moneyPhrase,
                })
              }
              disabled={isExecuting || !canMoneyConfirm}
              hitSlop={{ top: 5, bottom: 5 }}
              style={({ pressed }) => [
                styles.actionBtn,
                styles.deleteBtn,
                !canMoneyConfirm && styles.deleteBtnDisabled,
                pressed && styles.btnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Confirm ${verb}`}
              accessibilityState={{ disabled: isExecuting || !canMoneyConfirm }}
            >
              <Text style={[styles.deleteText, !canMoneyConfirm && styles.deleteTextDisabled]}>
                {isExecuting ? "Working…" : "Confirm"}
              </Text>
            </Pressable>
          ) : (
            <>
              {canEditProposal ? (
                <Pressable
                  onPress={() => setEditing((e) => !e)}
                  disabled={isExecuting}
                  hitSlop={{ top: 5, bottom: 5 }}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    styles.editBtn,
                    pressed && styles.btnPressed,
                    isExecuting && styles.btnDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={editing ? "Stop editing" : "Edit proposal"}
                >
                  <Text style={styles.editText}>{editing ? "Done editing" : "Edit"}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void confirmProposal(editing ? editedArgs : undefined)}
                disabled={confirmDisabled}
                hitSlop={{ top: 5, bottom: 5 }}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.confirmBtn,
                  pressed && styles.btnPressed,
                  confirmDisabled && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  isSitePublishConfirm
                    ? "Publish Website"
                    : isSiteRollbackConfirm
                    ? "Publish earlier Website version"
                    : isSiteDraftConfirm
                    ? "Confirm draft update"
                    : "Confirm proposal"
                }
                accessibilityState={{ disabled: confirmDisabled }}
              >
                <Text style={styles.confirmText}>
                  {isExecuting
                    ? "Working…"
                    : isSitePublishConfirm
                    ? "Publish Website"
                    : isSiteRollbackConfirm
                    ? "Publish earlier version"
                    : isSiteDraftConfirm
                    ? "Confirm draft update"
                    : "Confirm"}
                </Text>
              </Pressable>
            </>
          )}
          </>
          )}
        </View>
      </View>

      {/* ORCH-1103 — cover picker, mounted as a JSX child of the host
          (I-SUB-SHEET-INSIDE-PARENT). The picker requires a real brandId for
          ALL brand media (device, video, Pexels, GIPHY) because it persists
          live to brands.cover_media_url. So it mounts whenever a real target
          exists:
            - UPDATE: target from args.brand_id (always present).
            - CREATE: target from createdBrandId AFTER the Q7 "Create & attach"
              commit mints the brand (create-row-first / attach-second). The
              picker can't swap targets while mounted, so we open it fresh
              against the new brand (close+reopen), covered by the "Creating
              brand…" band state. */}
      {isBrandWithCover && coverTarget ? (
        <CoverPickerSheet
          visible={coverSheetVisible}
          onClose={handleCoverSheetClose}
          target={coverTarget}
          initial={initialPatch}
          onCoverChange={handleCoverChange}
          onShowToast={() => undefined}
          onCoverVideoProcessingChange={(p) => setCoverUploadState(p ? "processing" : "idle")}
        />
      ) : null}
      {!isBrandWithCover && isOfferingCover && coverTarget ? (
        <CoverPickerSheet
          visible={coverSheetVisible}
          onClose={handleCoverSheetClose}
          target={coverTarget}
          initial={initialPatch}
          onCoverChange={handleCoverChange}
          onShowToast={() => undefined}
          onCoverVideoProcessingChange={(p) => setCoverUploadState(p ? "processing" : "idle")}
        />
      ) : null}
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: {
    marginVertical: 6,
  },
  inner: {
    padding: CARD_PADDING,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  verb: {
    fontSize: VERB_FONT,
    lineHeight: 12,
    fontWeight: "600",
    letterSpacing: VERB_LETTER_SPACING,
    color: textTokens.secondary,
  },
  verbDanger: {
    // Words stay legible-neutral (secondary); danger lives in the glyph.
    color: textTokens.secondary,
  },
  identity: {
    marginTop: 8,
    fontSize: IDENTITY_FONT,
    lineHeight: IDENTITY_LINE,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  fields: {
    marginTop: 8,
    gap: 4,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: FIELD_LABEL_FONT,
    lineHeight: 14,
    color: textTokens.tertiary,
    letterSpacing: 0.1,
  },
  fieldValue: {
    fontSize: FIELD_VALUE_FONT,
    lineHeight: 17,
    color: textTokens.primary,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  // ----- cover band --------------------------------------------------------
  coverWrap: {
    marginTop: 8,
    marginBottom: 10,
  },
  coverBand: {
    height: ariThread.coverBandH, // 132
    borderRadius: radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  coverBandEmpty: {
    backgroundColor: ariThread.ariBubbleAndroid, // opaque on every platform
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.profileBase,
    gap: 6,
  },
  coverBandFilled: {
    backgroundColor: ariThread.ariBubbleAndroid,
  },
  coverBandBusy: {
    backgroundColor: ariThread.ariBubbleAndroid,
    gap: 8,
  },
  coverImage: {
    ...StyleSheet.absoluteFillObject,
  },
  coverVideoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileElevated,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  coverPillLabel: {
    fontSize: ariThread.chipFont,
    lineHeight: ariThread.chipLine,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  coverSubLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.tertiary,
  },
  coverErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
  },
  coverBusyLabel: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.secondary,
  },
  coverTypeChip: {
    position: "absolute",
    left: 8,
    bottom: 8,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: radius.full,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  coverTypeChipText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: "#ffffff",
    fontWeight: "600",
  },
  coverControls: {
    position: "absolute",
    right: 8,
    bottom: 8,
    flexDirection: "row",
    gap: 6,
  },
  coverDisc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  // ----- Q7 create-time "Create & attach" inline confirm -------------------
  createAttachRow: {
    marginTop: 8,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 8,
  },
  createAttachText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.secondary,
  },
  createAttachName: {
    fontWeight: "600",
    color: textTokens.primary,
  },
  createAttachActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  createAttachCancel: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  createAttachConfirm: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ariPalette.userBubble,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: ariPalette.ember,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      default: {},
    }),
  },
  // ----- delete variant ----------------------------------------------------
  assuranceRow: {
    marginTop: 10,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  assuranceText: {
    fontSize: 13,
    lineHeight: 17,
    color: textTokens.secondary,
  },
  skeletonRow: {
    height: 14,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileElevated,
    width: "90%",
  },
  confirmHelper: {
    marginTop: 10,
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    color: textTokens.tertiary,
  },
  confirmHelperName: {
    fontWeight: "600",
    color: textTokens.secondary,
  },
  confirmInput: {
    marginTop: 4,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    paddingHorizontal: 12,
    fontSize: 13,
    color: textTokens.primary,
  },
  proposalError: {
    marginTop: spacing.sm,
    color: semantic.error,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  // ----- actions -----------------------------------------------------------
  actions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    height: BUTTON_HEIGHT,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  editBtn: {
    flex: 1,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  confirmBtn: {
    flex: 1.6,
    backgroundColor: ariPalette.userBubble,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: ariPalette.ember,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      default: {},
    }),
  },
  // ORCH-1103 — destructive action wears red, the one departure from userBubble.
  deleteBtn: {
    flex: 1.6,
    backgroundColor: semantic.error,
    overflow: "hidden",
  },
  deleteBtnDisabled: {
    backgroundColor: glass.tint.profileElevated,
    opacity: 0.4,
  },
  cancelText: {
    fontSize: BUTTON_FONT,
    fontWeight: "500",
    color: textTokens.secondary,
    letterSpacing: -0.1,
  },
  editText: {
    fontSize: BUTTON_FONT,
    fontWeight: "500",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  confirmText: {
    fontSize: BUTTON_FONT,
    fontWeight: "600",
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  deleteText: {
    fontSize: 14, // MUST stay >=14/600 to clear the 3:1 large-text bar (3.76:1)
    fontWeight: "600",
    color: "#ffffff",
    letterSpacing: -0.1,
  },
  deleteTextDisabled: {
    color: textTokens.tertiary,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});

export default ToolProposalCard;
