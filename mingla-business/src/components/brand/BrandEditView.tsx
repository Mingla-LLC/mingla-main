/**
 * BrandEditView — founder-facing brand edit form (J-A8).
 *
 * Renders two states:
 *   - `brand === null` → Not Found GlassCard with back CTA
 *   - `brand !== null` → 5 sections (Photo · About · Contact · Social · Display)
 *                        + ConfirmDialog "Discard changes?" + Save button in TopBar
 *
 * Form state machine:
 *   - Local `draft: Brand` initialized from incoming `brand` prop
 *   - `isDirty` derived via JSON.stringify equality on draft vs brand
 *   - Save: 300ms simulated-async delay → onSave(draft) → Toast "Saved" →
 *           onAfterSave() (parent navigates back)
 *   - Back/Cancel when dirty → ConfirmDialog (Discard destructive / Keep editing)
 *
 * Authoritative design: HANDOFF_BUSINESS_DESIGNER.md §5.3.5 (lines 1837-1842).
 *
 * Per spec §3.4. Photo upload deferred (TRANSITIONAL Toast on edit-pencil).
 * Custom links UI deferred (schema field stays in `links.custom`).
 * Slug rendered read-only below photo (slug edit is §5.3.6 settings).
 * "Allow DMs" + "List in Discover" toggles belong in §5.3.6 settings — not here.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { EventCover } from "../ui/EventCover";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Toast } from "../ui/Toast";
import { TopBar } from "../ui/TopBar";

interface ToastState {
  visible: boolean;
  message: string;
}

// [TRANSITIONAL] simulated async delay — replaced by real Supabase mutation
// in B1 backend cycle. The 300ms beat creates a perceptible "Saving…" state
// so the UI feels real even though the in-memory write is synchronous.
const SIMULATED_SAVE_DELAY_MS = 300;
// Brief delay after Toast appears before navigating back so the success
// feedback is visually registered.
const POST_SAVE_NAV_DELAY_MS = 300;

// Cycle 7 FX2 cover-hue tiles — MIRROR Cycle 3 CreatorStep4Cover.tsx
// hue array verbatim. If the event-cover palette ever expands, brand
// covers should follow (keep these arrays in sync).
const COVER_HUE_TILES: readonly number[] = [25, 100, 180, 220, 290, 320] as const;

interface InlineToggleProps {
  value: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * InlineToggle — composed inline (no kit extension per DEC-079 closure).
 * If 3+ Toggle uses appear in future cycles, candidate for a `Toggle`
 * primitive carve-out (DEC-079-style additive extension) — see D-INV-A8-3.
 */
const InlineToggle: React.FC<InlineToggleProps> = ({
  value,
  onPress,
  accessibilityLabel,
}) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="switch"
    accessibilityState={{ checked: value }}
    accessibilityLabel={accessibilityLabel}
    style={[
      toggleStyles.track,
      {
        backgroundColor: value ? accent.warm : glass.tint.profileBase,
        borderColor: value ? accent.border : glass.border.profileBase,
      },
    ]}
  >
    <View
      style={[
        toggleStyles.dot,
        {
          marginLeft: value ? 19 : 3,
        },
      ]}
    />
  </Pressable>
);

const toggleStyles = StyleSheet.create({
  track: {
    width: 40,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
});

interface InlineTextAreaProps {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  minHeight?: number;
}

/**
 * InlineTextArea — multi-line text input matching the kit's Input visual
 * style. Composed inline (no kit extension per DEC-079) because the Input
 * primitive's container is hardcoded to 48px (single-line). Reusable
 * pattern for future multi-line fields (J-A9 invite note, J-A12 finance
 * description, etc.).
 */
const InlineTextArea: React.FC<InlineTextAreaProps> = ({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  minHeight = 120,
}) => {
  const [focused, setFocused] = useState<boolean>(false);
  return (
    <View
      style={[
        textAreaStyles.container,
        {
          minHeight,
          borderColor: focused
            ? accent.warm
            : "rgba(255, 255, 255, 0.12)",
          borderWidth: focused ? 1.5 : 1,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={textTokens.quaternary}
        accessibilityLabel={accessibilityLabel}
        multiline
        textAlignVertical="top"
        underlineColorAndroid="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          textAreaStyles.input,
          {
            color: textTokens.primary,
            fontSize: typography.body.fontSize,
            fontWeight: typography.body.fontWeight,
          },
        ]}
      />
    </View>
  );
};

const textAreaStyles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderRadius: radiusTokens.sm,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  input: {
    minHeight: 96,
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
});

export interface BrandEditViewProps {
  brand: Brand | null;
  /** Back-arrow / cancel handler. Parent decides where to navigate. */
  onCancel: () => void;
  /**
   * Commits the edited draft. Cycle 17e-A: parent's onSave wires
   * `useUpdateBrand().mutateAsync()` so persistence happens through React
   * Query (Const #5). Returns a Promise so this view can show submitting
   * state + handle errors via toast.
   */
  onSave: (next: Brand) => Promise<void>;
  /** Called after a successful save. Parent typically calls router.back(). */
  onAfterSave: () => void;
  /**
   * Cycle 17e-A — called when operator taps "Delete brand" in the danger
   * zone. Parent opens BrandDeleteSheet. Hidden when undefined.
   */
  onRequestDelete?: (brand: Brand) => void;
}

export const BrandEditView: React.FC<BrandEditViewProps> = ({
  brand,
  onCancel,
  onSave,
  onAfterSave,
  onRequestDelete,
}) => {
  const insets = useSafeAreaInsets();
  // Initialize draft from `brand`. Note: when brand !== null, draft is the
  // editable copy. When brand === null, draft is unused (we render not-found).
  const initialDraft = useMemo<Brand | null>(() => brand, [brand]);
  const [draft, setDraft] = useState<Brand | null>(initialDraft);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [discardDialogVisible, setDiscardDialogVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });

  // JSON.stringify dirty-check — correct for this Brand shape (primitive +
  // nested objects with insertion-order key preservation). DO NOT refactor
  // to field-by-field comparison — the shape has 4+ optional nested objects
  // and key-by-key tracking adds bookkeeping without value. For v1 form
  // fidelity this is fine; if profiling shows perf cost on large objects,
  // revisit. Per spec §3.4.2.
  const isDirty = useMemo<boolean>(() => {
    if (brand === null || draft === null) return false;
    return JSON.stringify(draft) !== JSON.stringify(brand);
  }, [draft, brand]);

  const fireToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleDismissToast = useCallback((): void => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!isDirty || submitting || draft === null) return;
    setSubmitting(true);
    // Cycle 17e-A: parent's onSave is now async and wires useUpdateBrand
    // mutation. Removed simulated 300ms delay — real network round-trip
    // provides the actual latency. Optimistic updates make UI feel instant
    // anyway (per Decision 10 hybrid pattern).
    try {
      await onSave(draft);
      fireToast("Saved");
      setTimeout(() => onAfterSave(), POST_SAVE_NAV_DELAY_MS);
    } catch (error) {
      fireToast(
        error instanceof Error
          ? `Couldn't save: ${error.message}`
          : "Couldn't save. Tap Save to try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [draft, isDirty, submitting, onSave, onAfterSave, fireToast]);

  const handleBackPress = useCallback((): void => {
    if (isDirty) {
      setDiscardDialogVisible(true);
    } else {
      onCancel();
    }
  }, [isDirty, onCancel]);

  const handleDiscardConfirm = useCallback((): void => {
    setDiscardDialogVisible(false);
    onCancel();
  }, [onCancel]);

  const handleDiscardCancel = useCallback((): void => {
    setDiscardDialogVisible(false);
  }, []);

  // [TRANSITIONAL] photo upload — exit when photo upload pipeline lands
  // (likely Cycle 14+ or sooner if Stripe/checkout requires brand photos).
  const handlePhotoEdit = useCallback((): void => {
    fireToast("Photo upload lands in a later cycle.");
  }, [fireToast]);

  // ----- Not-found state -----
  if (brand === null || draft === null) {
    return (
      <View style={styles.host}>
        <View style={styles.barWrap}>
          <TopBar leftKind="back" title="Edit brand" onBack={onCancel} rightSlot={<View />} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.notFoundTitle}>Brand not found</Text>
            <Text style={styles.notFoundBody}>
              The brand you tried to edit doesn{"’"}t exist or has been removed.
              Go back to your account to pick another.
            </Text>
            <View style={styles.notFoundBtnRow}>
              <Button
                label="Back to Account"
                onPress={onCancel}
                variant="secondary"
                size="md"
                leadingIcon="arrowL"
              />
            </View>
          </GlassCard>
        </ScrollView>
      </View>
    );
  }

  // ----- Populated state -----
  const toggleValue = draft.displayAttendeeCount ?? true;

  const saveButton = (
    <Button
      label={submitting ? "Saving…" : "Save"}
      onPress={handleSave}
      variant="primary"
      size="sm"
      disabled={!isDirty || submitting}
      loading={submitting}
      accessibilityLabel="Save brand changes"
    />
  );

  return (
    <View style={styles.host}>
      <View style={styles.barWrap}>
        <TopBar
          leftKind="back"
          title="Edit brand"
          onBack={handleBackPress}
          rightSlot={saveButton}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.kbWrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: spacing.xl + Math.max(insets.bottom, spacing.md) },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* SECTION A — Photo card (read-mostly with TRANSITIONAL upload).
              Avatar + pencil-button overlay are wrapped in a relative-
              positioned View so the absolute-positioned pencil anchors
              against the avatar's bounding box. The Avatar primitive
              itself stays atomic (no children prop) per kit discipline. */}
          <GlassCard variant="elevated" padding={spacing.lg}>
            <View style={styles.photoBlock}>
              <View style={styles.heroAvatarWrap}>
                <Avatar name={brand.displayName} size="hero" />
                <Pressable
                  onPress={handlePhotoEdit}
                  accessibilityRole="button"
                  accessibilityLabel="Edit brand photo"
                  style={styles.photoEditBtn}
                  hitSlop={6}
                >
                  <Icon name="edit" size={14} color="#ffffff" />
                </Pressable>
              </View>
              <View style={styles.slugRow}>
                <Text style={styles.slugText}>
                  <Text style={styles.slugPrefix}>mingla.com/</Text>
                  <Text style={styles.slugValue}>{brand.slug}</Text>
                </Text>
                <Icon name="shield" size={12} color={textTokens.tertiary} />
              </View>
              {/* Cycle 17e-A: slug locked per I-17 + trg_brands_immutable_slug */}
              <Text style={styles.slugLockedHelper}>
                URL is locked when the brand is created.
              </Text>
            </View>
          </GlassCard>

          {/* SECTION B — About */}
          <Text style={styles.sectionLabel}>ABOUT</Text>
          <View style={styles.fieldsCol}>
            <Input
              variant="text"
              value={draft.displayName}
              onChangeText={(v) => setDraft({ ...draft, displayName: v })}
              placeholder="Brand name"
              accessibilityLabel="Display name"
              clearable
            />
            <Input
              variant="text"
              value={draft.tagline ?? ""}
              onChangeText={(v) => setDraft({ ...draft, tagline: v })}
              placeholder="Short tagline"
              accessibilityLabel="Tagline"
              clearable
            />
            <InlineTextArea
              value={draft.bio ?? ""}
              onChangeText={(v) => setDraft({ ...draft, bio: v })}
              placeholder="Tell people about your brand"
              accessibilityLabel="Bio / description"
            />
          </View>

          {/* SECTION B-1.5 — Brand cover (Cycle 7 FX2 v11).
              Hue-only stub mirrors Cycle 3 CreatorStep4Cover pattern.
              Live preview reflects current hue selection; tap a swatch
              to update draft.coverHue. Image upload deferred to B-cycle. */}
          <Text style={styles.sectionLabel}>BRAND COVER</Text>
          <View style={styles.fieldsCol}>
            <View style={styles.coverPreviewWrap}>
              <EventCover
                hue={draft.coverHue}
                radius={radiusTokens.lg}
                label=""
                height={120}
              />
            </View>
            <Text style={styles.kindHint}>
              This shows up at the top of your public brand page.
            </Text>
            <View style={styles.coverHueRow}>
              {COVER_HUE_TILES.map((hue) => {
                const active = draft.coverHue === hue;
                return (
                  <Pressable
                    key={hue}
                    onPress={() => setDraft({ ...draft, coverHue: hue })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Cover hue ${hue}${active ? " (selected)" : ""}`}
                    style={[
                      styles.coverHueTile,
                      active && styles.coverHueTileActive,
                    ]}
                  >
                    <View style={styles.coverHueTileInner}>
                      <EventCover hue={hue} radius={radiusTokens.md} label="" />
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.coverComingSoonCaption}>
              Photo and video uploads coming soon.
            </Text>
          </View>

          {/* SECTION B-2 — Brand kind (Cycle 7 v10).
              Drives whether the public brand page shows a location after the
              handle. Pop-up = no location shown. Physical = address rendered. */}
          <Text style={styles.sectionLabel}>BRAND KIND</Text>
          <View style={styles.fieldsCol}>
            <View style={styles.kindRow}>
              <Pressable
                onPress={() => setDraft({ ...draft, kind: "physical" })}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.kind === "physical" }}
                accessibilityLabel="Physical space"
                style={[
                  styles.kindPill,
                  draft.kind === "physical" && styles.kindPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.kindPillLabel,
                    draft.kind === "physical" && styles.kindPillLabelActive,
                  ]}
                >
                  Physical space
                </Text>
                <Text
                  style={[
                    styles.kindPillSub,
                    draft.kind === "physical" && styles.kindPillSubActive,
                  ]}
                >
                  A venue you own or lease
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDraft({ ...draft, kind: "popup" })}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.kind === "popup" }}
                accessibilityLabel="Pop-up"
                style={[
                  styles.kindPill,
                  draft.kind === "popup" && styles.kindPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.kindPillLabel,
                    draft.kind === "popup" && styles.kindPillLabelActive,
                  ]}
                >
                  Pop-up
                </Text>
                <Text
                  style={[
                    styles.kindPillSub,
                    draft.kind === "popup" && styles.kindPillSubActive,
                  ]}
                >
                  Events at varying venues
                </Text>
              </Pressable>
            </View>
            {draft.kind === "physical" ? (
              <View>
                <Input
                  variant="text"
                  value={draft.address ?? ""}
                  onChangeText={(v) =>
                    setDraft({
                      ...draft,
                      address: v.length === 0 ? null : v,
                    })
                  }
                  placeholder="e.g. 12 Old Street, London EC1V 9HL"
                  leadingIcon="location"
                  accessibilityLabel="Brand address"
                  clearable
                />
                <Text style={styles.kindHint}>
                  Shown to buyers on your public brand page. Use neighborhood only if you'd rather not share the exact address.
                </Text>
              </View>
            ) : null}
          </View>

          {/* SECTION C — Contact */}
          <Text style={styles.sectionLabel}>CONTACT</Text>
          <View style={styles.fieldsCol}>
            <Input
              variant="email"
              value={draft.contact?.email ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, contact: { ...draft.contact, email: v } })
              }
              placeholder="hello@yourbrand.com"
              leadingIcon="mail"
              accessibilityLabel="Contact email"
              clearable
            />
            <Input
              variant="phone"
              value={draft.contact?.phone ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, contact: { ...draft.contact, phone: v } })
              }
              defaultCountryIso={draft.contact?.phoneCountryIso ?? "GB"}
              onCountryChange={(country) =>
                setDraft({
                  ...draft,
                  contact: { ...draft.contact, phoneCountryIso: country.iso },
                })
              }
              placeholder="7700 900 312"
              accessibilityLabel="Contact phone"
            />
          </View>

          {/* SECTION D — Social links */}
          <Text style={styles.sectionLabel}>SOCIAL LINKS</Text>
          <View style={styles.fieldsCol}>
            <Input
              variant="text"
              value={draft.links?.website ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, website: v } })
              }
              placeholder="Paste your website link here"
              leadingIcon="globe"
              accessibilityLabel="Website link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.instagram ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, instagram: v } })
              }
              placeholder="Paste your Instagram link here"
              leadingIcon="instagram"
              accessibilityLabel="Instagram link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.tiktok ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, tiktok: v } })
              }
              placeholder="Paste your TikTok link here"
              leadingIcon="tiktok"
              accessibilityLabel="TikTok link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.x ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, x: v } })
              }
              placeholder="Paste your X link here"
              leadingIcon="x"
              accessibilityLabel="X (Twitter) link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.facebook ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, facebook: v } })
              }
              placeholder="Paste your Facebook link here"
              leadingIcon="facebook"
              accessibilityLabel="Facebook link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.youtube ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, youtube: v } })
              }
              placeholder="Paste your YouTube link here"
              leadingIcon="youtube"
              accessibilityLabel="YouTube link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.linkedin ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, linkedin: v } })
              }
              placeholder="Paste your LinkedIn link here"
              leadingIcon="linkedin"
              accessibilityLabel="LinkedIn link"
              clearable
            />
            <Input
              variant="text"
              value={draft.links?.threads ?? ""}
              onChangeText={(v) =>
                setDraft({ ...draft, links: { ...draft.links, threads: v } })
              }
              placeholder="Paste your Threads link here"
              leadingIcon="threads"
              accessibilityLabel="Threads link"
              clearable
            />
          </View>

          {/* SECTION E — Display */}
          <Text style={styles.sectionLabel}>DISPLAY</Text>
          <GlassCard variant="base" padding={spacing.md}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleLabel}>Show attendee count</Text>
                <Text style={styles.toggleSub}>
                  Display live RSVP numbers on your public page.
                </Text>
              </View>
              <InlineToggle
                value={toggleValue}
                onPress={() =>
                  setDraft({ ...draft, displayAttendeeCount: !toggleValue })
                }
                accessibilityLabel="Show attendee count"
              />
            </View>
          </GlassCard>

          {/* Cycle 17e-A — Danger zone */}
          {onRequestDelete !== undefined ? (
            <View style={styles.dangerZone}>
              <Text style={styles.dangerLabel}>Danger zone</Text>
              <Text style={styles.dangerHelper}>
                Deleting hides this brand from your list. Recoverable for 30
                days via support.
              </Text>
              <View style={styles.dangerCta}>
                <Button
                  label="Delete brand"
                  variant="ghost"
                  size="md"
                  leadingIcon="trash"
                  onPress={() => onRequestDelete(brand)}
                  accessibilityLabel="Delete this brand"
                />
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={discardDialogVisible}
        onClose={handleDiscardCancel}
        onConfirm={handleDiscardConfirm}
        variant="simple"
        destructive
        title="Discard changes?"
        description="Your edits won't be saved if you leave now."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={handleDismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  barWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  kbWrap: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },

  // Not-found state ------------------------------------------------------
  notFoundTitle: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    letterSpacing: typography.h2.letterSpacing,
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  notFoundBody: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
    marginBottom: spacing.md,
  },
  notFoundBtnRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },

  // Photo card ----------------------------------------------------------
  photoBlock: {
    alignItems: "center",
  },
  // Wrapper around the Avatar primitive — relative-positioned so the
  // absolute pencil-edit button (sibling) anchors against the avatar's
  // bounding box. Replaces the prior `heroAvatar` inline composition.
  heroAvatarWrap: {
    position: "relative",
    marginBottom: spacing.sm,
  },
  photoEditBtn: {
    position: "absolute",
    bottom: -4,
    right: -4,
    width: 32,
    height: 32,
    borderRadius: 999,
    backgroundColor: accent.warm,
    borderWidth: 2,
    borderColor: "#14171c",
    alignItems: "center",
    justifyContent: "center",
  },
  slugText: {
    marginTop: spacing.xs,
  },
  slugPrefix: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  slugValue: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.primary,
    fontWeight: "600",
  },

  // Section labels + fields ---------------------------------------------
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm,
  },
  fieldsCol: {
    gap: spacing.sm,
  },

  // Brand kind pills (Cycle 7 v10) -----------------------------------
  kindRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  kindPill: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  kindPillActive: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
  },
  kindPillLabel: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 2,
  },
  kindPillLabelActive: {
    color: textTokens.primary,
  },
  kindPillSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  kindPillSubActive: {
    color: textTokens.secondary,
  },
  kindHint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },

  // Brand cover hue picker (Cycle 7 FX2 v11) -------------------------
  coverPreviewWrap: {
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    marginBottom: spacing.xs,
  },
  coverHueRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  coverHueTile: {
    width: "31%",
    aspectRatio: 1,
    padding: 2,
    borderRadius: radiusTokens.md + 2,
    borderWidth: 2,
    borderColor: "transparent",
  },
  coverHueTileActive: {
    borderColor: accent.warm,
  },
  coverHueTileInner: {
    flex: 1,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
  coverComingSoonCaption: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: spacing.sm,
  },

  // Display toggle row --------------------------------------------------
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  toggleTextCol: {
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  toggleSub: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Toast ---------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },

  // Cycle 17e-A — slug-locked hint
  slugRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
  },
  slugLockedHelper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },

  // Cycle 17e-A — danger zone for brand deletion (matches BrandProfileView pattern)
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
    gap: spacing.sm,
  },
  dangerLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: semantic.error,
  },
  dangerHelper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.tertiary,
  },
  dangerCta: {
    marginTop: spacing.xs,
  },
});

export default BrandEditView;
