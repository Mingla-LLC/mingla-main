/**
 * RsvpDetailsModal — ORCH-1163-R3 [rsvp-shared-body / floating-active] · §A.
 *
 * The shared, shell-agnostic "Add your details" modal for the floating decision
 * bar. The floating Going/Maybe/Can't bar has NO form host of its own (the contact
 * + per-guest +1 mini-forms live only in the inline §5 box). When a guest taps a
 * floating decision with no contact details, useRsvpOfferingState opens THIS modal,
 * which RE-HOSTS the SAME contactForm / guestForms nodes (they share the hook's
 * state, so values sync with the inline box), then dispatches the pinned decision on
 * Continue (Going → confirm dialog; Maybe/Can't → record). One decision owner, two
 * entry points (inline box + floating bar), identical flow.
 *
 * Extracted into its OWN file (mirroring RsvpGoingConfirmDialog) so the BODY file
 * (RsvpOfferingBody.tsx) hosts NO scroll root — the shell-agnostic invariant §A.2
 * (a scroll root in the body re-triggers the consumer gorhom freeze). This modal is
 * a portal <Modal> that mounts OUTSIDE the gorhom scroll tree, so its scrollable
 * content area is gorhom-safe.
 *
 * Package-isolated (I-MOR-0827-PACKAGE-ISOLATION): React-Native's native <Modal> +
 * <ScrollView> (work on react-native-web AND native RN), themed via ThemePalette
 * ONLY — NO designSystem import, NO app-src import. Android-opaque card fill per
 * ANDROID_GLASS_USES_OPAQUE_FALLBACK. testID: orch-1163-rsvp-details-modal.
 */

import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";

import { boldFontFamily, type ThemePalette } from "./themePalette";
import { type ResolvedTheme } from "./designTokens";

export interface RsvpDetailsModalProps {
  visible: boolean;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The contact mini-form node (shared with the inline §5 box). */
  contactForm: React.ReactNode;
  /** The per-guest +1 mini-forms node — null for Can't-go (no +1s). */
  guestForms: React.ReactNode;
  /** The validation/submit error node (shared). */
  errorNode: React.ReactNode;
  /** Primary-button label, decision-aware. */
  continueLabel: string;
  /** Enable the Continue button (mirrors the hook's contactReady). */
  continueEnabled: boolean;
  submitting: boolean;
  onContinue: () => void;
  onCancel: () => void;
}

export const RsvpDetailsModal: React.FC<RsvpDetailsModalProps> = ({
  visible,
  palette,
  theme,
  contactForm,
  guestForms,
  errorNode,
  continueLabel,
  continueEnabled,
  submitting,
  onContinue,
  onCancel,
}) => {
  const boldFamily = boldFontFamily(theme);
  const disabled = !continueEnabled || submitting;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.scrim}
        onPress={submitting ? undefined : onCancel}
        accessibilityLabel="Dismiss"
      >
        <Pressable
          style={[
            styles.card,
            {
              // ANDROID_GLASS_USES_OPAQUE_FALLBACK — opaque page fill on web AND Android
              // (neither has a native blur backdrop, so the translucent glass card bleeds
              // through); only iOS keeps the native glass card.
              backgroundColor: Platform.OS === "ios" ? palette.card : palette.page,
              borderColor: palette.panelBorder,
            },
          ]}
          onPress={() => undefined}
          testID="orch-1163-rsvp-details-modal"
        >
          <Text style={[styles.title, { color: palette.primaryText, fontFamily: boldFamily }]}>
            Add your details
          </Text>
          <Text style={[styles.sub, { color: palette.secondaryText }]}>
            We&rsquo;ll only use this to update you about this event.
          </Text>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {contactForm}
            {guestForms}
            {errorNode}
          </ScrollView>
          <Pressable
            onPress={disabled ? undefined : onContinue}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            accessibilityLabel={continueLabel}
            style={[
              styles.primaryBtn,
              { backgroundColor: palette.accent, opacity: disabled ? 0.5 : 1 },
            ]}
            testID="orch-1163-rsvp-details-continue"
          >
            <Text style={[styles.primaryBtnText, { color: palette.accentText, fontFamily: boldFamily }]}>
              {continueLabel}
            </Text>
          </Pressable>
          <Pressable
            onPress={submitting ? undefined : onCancel}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={styles.secondaryBtn}
            testID="orch-1163-rsvp-details-cancel"
          >
            <Text style={[styles.secondaryBtnText, { color: palette.secondaryText }]}>
              Cancel
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "86%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    overflow: "hidden",
  },
  title: { fontSize: 20, fontWeight: "900", letterSpacing: -0.3, marginBottom: 6 },
  sub: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  scrollArea: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: 4 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 14,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "900" },
  secondaryBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 12, marginTop: 4 },
  secondaryBtnText: { fontSize: 14, fontWeight: "700" },
});

export default RsvpDetailsModal;
