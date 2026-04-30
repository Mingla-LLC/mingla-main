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
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { Brand } from "../../store/currentBrandStore";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
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
  /** Commits the edited draft to the store. Parent owns persistence. */
  onSave: (next: Brand) => void;
  /** Called after a successful save. Parent typically calls router.back(). */
  onAfterSave: () => void;
}

export const BrandEditView: React.FC<BrandEditViewProps> = ({
  brand,
  onCancel,
  onSave,
  onAfterSave,
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

  const handleSave = useCallback((): void => {
    if (!isDirty || submitting || draft === null) return;
    setSubmitting(true);
    // Capture draft at call-time; the setTimeout closure preserves it even
    // if state changes during the simulated-async window.
    const snapshot = draft;
    setTimeout(() => {
      onSave(snapshot);
      setSubmitting(false);
      fireToast("Saved");
      setTimeout(() => onAfterSave(), POST_SAVE_NAV_DELAY_MS);
    }, SIMULATED_SAVE_DELAY_MS);
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
              <Text style={styles.slugText}>
                <Text style={styles.slugPrefix}>mingla.com/</Text>
                <Text style={styles.slugValue}>{brand.slug}</Text>
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
});

export default BrandEditView;
