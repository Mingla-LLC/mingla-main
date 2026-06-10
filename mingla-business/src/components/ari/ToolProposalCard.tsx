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
import { ToolEditForm } from "./ToolEditForm";
import { GlassChrome } from "../ui/GlassChrome";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import type { CoverPatch } from "../ui/CoverPicker";
import type { CoverTarget } from "../ui/coverTarget";
import { useBrandCascadePreview } from "../../hooks/useBrands";
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
    case "create_event": return "Create event";
    case "update_event": return "Update event";
    default: return toolName.replace(/_/g, " ");
  }
}

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
  return toolName;
}

function coverTypeLabel(type: unknown): string | null {
  if (type === "video") return "Video";
  if (type === "gif") return "GIF";
  if (type === "image") return "Image";
  return null;
}

function fieldsFor(toolName: string, args: Record<string, unknown>): Field[] {
  const out: Field[] = [];
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
  const isBrandWithCover = isBrandCreate || isBrandUpdate;

  // ----- delete-variant -----------------------------------------------------
  const deleteBrandId = isBrandDelete && typeof args.brand_id === "string" ? args.brand_id : null;
  const cascade = useBrandCascadePreview(isBrandDelete ? deleteBrandId : null);
  const deleteName = isBrandDelete ? identity : "";
  const canDelete =
    typedName.trim().toLowerCase() === deleteName.trim().toLowerCase() && deleteName.length > 0;

  // ----- cover threading -----------------------------------------------------
  const coverUrl = (liveArgs.cover_media_url as string | undefined) ?? null;
  const coverType = liveArgs.cover_media_type;

  const handleCoverChange = (patch: CoverPatch): void => {
    setEditedArgs((prev) => ({
      ...prev,
      cover_media_url: patch.coverMediaUrl ?? undefined,
      cover_media_type: patch.coverMediaType ?? undefined,
    }));
    if (patch.coverMediaUrl) setCoverUploadState("idle");
  };

  const handleRemoveCover = (): void => {
    setEditedArgs((prev) => {
      const next = { ...prev };
      delete next.cover_media_url;
      delete next.cover_media_type;
      return next;
    });
  };

  // The brand CoverTarget — requires a real brandId. On UPDATE the id comes
  // from args.brand_id. On CREATE the id only exists AFTER the brand is minted
  // (Q7), captured in `createdBrandId`. Either path yields a real, RLS-valid
  // brand target the reused CoverPicker can persist against.
  const updateBrandId = isBrandUpdate && typeof args.brand_id === "string" ? args.brand_id : null;
  const effectiveBrandId = createdBrandId ?? updateBrandId;
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
      const outcome = await onConfirm(editing ? editedArgs : undefined, true);
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
    ? { ...EMPTY_COVER_PATCH, coverMediaUrl: coverUrl, coverMediaType: (coverType as CoverPatch["coverMediaType"]) ?? null }
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

  return (
    <GlassChrome
      intensity="cardElevated"
      tintColor={glass.tint.profileElevated}
      borderColor={isBrandDelete ? "rgba(239,68,68,0.32)" : ariPalette.proposalBorder}
      radius="lg"
      style={styles.card}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <View style={styles.headerRow}>
          <AriOrb size="xs" decorative />
          {isBrandDelete ? <AlertTriangle size={12} color={semantic.error} /> : null}
          <Text
            style={[styles.verb, isBrandDelete && styles.verbDanger]}
            numberOfLines={1}
          >
            {verb.toUpperCase()}
          </Text>
        </View>

        <Text style={styles.identity} numberOfLines={2}>{identity}</Text>

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
        ) : null}

        {/* ORCH-1103 — cover band on create/update brand */}
        {isBrandWithCover ? (
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

        {editing && !isBrandDelete ? (
          <ToolEditForm
            toolName={toolName}
            args={editedArgs}
            onChange={setEditedArgs}
          />
        ) : (
          !isBrandDelete && fieldsFor(toolName, liveArgs).length > 0 && (
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
              onPress={() => onConfirm(editing ? editedArgs : undefined)}
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
          ) : (
            <>
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
              <Pressable
                onPress={() => onConfirm(editing ? editedArgs : undefined)}
                disabled={confirmDisabled}
                hitSlop={{ top: 5, bottom: 5 }}
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.confirmBtn,
                  pressed && styles.btnPressed,
                  confirmDisabled && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Confirm proposal"
                accessibilityState={{ disabled: confirmDisabled }}
              >
                <Text style={styles.confirmText}>{isExecuting ? "Working…" : "Confirm"}</Text>
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
