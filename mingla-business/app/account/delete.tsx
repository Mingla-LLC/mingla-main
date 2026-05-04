/**
 * Delete account route — Cycle 14 J-A4 4-step internal state machine
 * (DEC-096 D-14-10..D-14-14).
 *
 * 4 steps in single route (NOT 4 separate routes — keeps stack clean for back nav):
 *   Step 1 — Warn — full-bleed warning + Apple privacy-relay note (if applicable)
 *   Step 2 — Cascade preview — itemized counts + active-events warn block
 *   Step 3 — Type-to-confirm — account email match
 *   Step 4 — Confirmation — success toast + signOut + navigate to BusinessWelcomeScreen
 *
 * D-14-12 (FORCED): UPDATE creator_accounts.deleted_at = now() via existing
 * self-write UPDATE RLS policy. NO insert into account_deletion_requests
 * (B-cycle service-role edge fn writes that audit row).
 *
 * D-14-14: warn-loudly-don't-block on active events.
 *
 * I-35 invariant: deleted_at is the soft-delete marker; recover-on-sign-in
 * auto-clears (per AuthContext bootstrap MOD).
 *
 * Selector pattern rule (Cycle 9c v2 + Cycle 12 lesson): all multi-record
 * reads use raw `entries` selector + useMemo for cascade preview aggregation.
 *
 * I-21: operator-side route. NEVER imported by anon-tolerant buyer routes.
 *
 * ORCH-0710: ALL hooks declared BEFORE any conditional early-return.
 *
 * Per Cycle 14 SPEC §4.7.4.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { useRequestAccountDeletion } from "../../src/hooks/useAccountDeletion";
import { useBrandTeamStore } from "../../src/store/brandTeamStore";
import { useBrandList } from "../../src/store/currentBrandStore";
import { useDoorSalesStore } from "../../src/store/doorSalesStore";
import { useGuestStore } from "../../src/store/guestStore";
import { useLiveEventStore } from "../../src/store/liveEventStore";
import { useOrderStore } from "../../src/store/orderStore";
import { useScanStore } from "../../src/store/scanStore";
import {
  computeAccountDeletionPreview,
  EMPTY_PREVIEW,
  type AccountDeletionPreview,
} from "../../src/utils/accountDeletionPreview";
import { formatGbp } from "../../src/utils/currency";

import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import type { IconName } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Toast } from "../../src/components/ui/Toast";

type DeleteStep = 1 | 2 | 3 | 4;

const SIGN_OUT_DELAY_MS = 1200;

export default function DeleteAccountRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = useAuth();

  // Raw entries + useMemo per Cycle 9c v2 selector pattern rule
  const allBrands = useBrandList();
  const allBrandTeam = useBrandTeamStore((s) => s.entries);
  const allLiveEvents = useLiveEventStore((s) => s.events);
  const allOrders = useOrderStore((s) => s.entries);
  const allDoorSales = useDoorSalesStore((s) => s.entries);
  const allComps = useGuestStore((s) => s.entries);
  const allScans = useScanStore((s) => s.entries);

  const { mutateAsync: requestDeletion, isPending: deleting } =
    useRequestAccountDeletion();

  const [step, setStep] = useState<DeleteStep>(1);
  const [confirmEmailInput, setConfirmEmailInput] = useState<string>("");
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Keyboard listener for memory rule feedback_keyboard_never_blocks_input
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const provider = useMemo<"google" | "apple" | "unknown">(() => {
    const p = user?.app_metadata?.provider;
    return p === "google" || p === "apple" ? p : "unknown";
  }, [user]);

  const preview = useMemo<AccountDeletionPreview>(() => {
    if (user === null) return EMPTY_PREVIEW;
    return computeAccountDeletionPreview({
      userId: user.id,
      brands: allBrands,
      brandTeamEntries: allBrandTeam,
      liveEvents: allLiveEvents,
      orderEntries: allOrders,
      doorSalesEntries: allDoorSales,
      compEntries: allComps,
      scanEntries: allScans,
    });
  }, [
    user,
    allBrands,
    allBrandTeam,
    allLiveEvents,
    allOrders,
    allDoorSales,
    allComps,
    allScans,
  ]);

  const emailMatches = useMemo<boolean>(() => {
    if (user?.email === null || user?.email === undefined) return false;
    return (
      confirmEmailInput.trim().toLowerCase() ===
      user.email.trim().toLowerCase()
    );
  }, [confirmEmailInput, user]);

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (step > 1 && step < 4 && !deleting) {
      setStep((s) => Math.max(1, s - 1) as DeleteStep);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [step, deleting, router]);

  const handleClose = useCallback((): void => {
    if (deleting) return;
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [deleting, router]);

  const handleConfirmDelete = useCallback(async (): Promise<void> => {
    if (!emailMatches || deleting) return;
    try {
      await requestDeletion();
      setStep(4);
      showToast(
        "Account scheduled for deletion. Recover within 30 days by signing in again.",
      );
      // 1.2s → signOut → navigate
      setTimeout((): void => {
        void signOut();
        router.replace("/" as never);
      }, SIGN_OUT_DELAY_MS);
    } catch (_err) {
      showToast("Couldn't delete. Tap to try again.");
      setStep(3);
      setConfirmEmailInput("");
    }
  }, [emailMatches, deleting, requestDeletion, signOut, router, showToast]);

  // ---- Render ----

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close"
          disabled={deleting}
        />
        <Text style={styles.chromeTitle}>Delete account</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              insets.bottom + (keyboardVisible ? spacing.xl * 4 : spacing.xl),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
      >
        {step === 1 ? (
          <Step1Warn
            provider={provider}
            onContinue={() => setStep(2)}
            onCancel={handleBack}
          />
        ) : null}
        {step === 2 ? (
          <Step2Preview
            preview={preview}
            onContinue={() => setStep(3)}
            onBack={handleBack}
          />
        ) : null}
        {step === 3 ? (
          <Step3Confirm
            email={user?.email ?? ""}
            input={confirmEmailInput}
            onChangeInput={setConfirmEmailInput}
            emailMatches={emailMatches}
            deleting={deleting}
            onConfirm={() => {
              void handleConfirmDelete();
            }}
            onBack={handleBack}
          />
        ) : null}
        {step === 4 ? <Step4Success /> : null}
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>
    </View>
  );
}

// ============================================================
// Step 1 — Warn
// ============================================================

interface Step1WarnProps {
  provider: "google" | "apple" | "unknown";
  onContinue: () => void;
  onCancel: () => void;
}

const Step1Warn: React.FC<Step1WarnProps> = ({
  provider,
  onContinue,
  onCancel,
}) => (
  <View style={styles.warnHost}>
    <View style={styles.warnIconWrap}>
      <Icon name="trash" size={48} color={accent.warm} />
    </View>
    <Text style={styles.warnTitle}>Delete your Mingla Business account?</Text>
    <Text style={styles.warnBody}>
      You'll lose access to all your brands, events, ticket data, team
      memberships, and history. You have 30 days to recover by signing in
      again — after that, everything is permanently erased.
    </Text>
    {provider === "apple" ? (
      <View style={styles.appleNote}>
        <Icon name="flag" size={14} color={accent.warm} />
        <Text style={styles.appleNoteText}>
          If you used Apple's "Hide My Email", you may also need to remove
          Mingla from appleid.apple.com after deletion.
        </Text>
      </View>
    ) : null}
    <View style={styles.ctaRow}>
      <Button
        label="Cancel"
        variant="ghost"
        size="md"
        fullWidth
        onPress={onCancel}
      />
    </View>
    <View style={styles.ctaRow}>
      <Button
        label="Continue"
        variant="secondary"
        size="md"
        fullWidth
        onPress={onContinue}
      />
    </View>
  </View>
);

// ============================================================
// Step 2 — Cascade preview
// ============================================================

interface Step2PreviewProps {
  preview: AccountDeletionPreview;
  onContinue: () => void;
  onBack: () => void;
}

const Step2Preview: React.FC<Step2PreviewProps> = ({
  preview,
  onContinue,
  onBack,
}) => (
  <View style={styles.previewHost}>
    <Text style={styles.previewTitle}>Here's what you'll lose</Text>
    <View style={styles.cascadeList}>
      {preview.brandsOwnedCount > 0 ? (
        <CascadeRow
          icon="user"
          label={`${preview.brandsOwnedCount} brand${preview.brandsOwnedCount === 1 ? "" : "s"} you own`}
        />
      ) : null}
      {preview.brandsTeamMemberCount > 0 ? (
        <CascadeRow
          icon="users"
          label={`${preview.brandsTeamMemberCount} brand${preview.brandsTeamMemberCount === 1 ? "" : "s"} you're a team member of`}
        />
      ) : null}
      {preview.liveEventsCount > 0 ? (
        <CascadeRow
          icon="calendar"
          label={`${preview.liveEventsCount} live or upcoming event${preview.liveEventsCount === 1 ? "" : "s"}`}
        />
      ) : null}
      {preview.pastEventsCount > 0 ? (
        <CascadeRow
          icon="clock"
          label={`${preview.pastEventsCount} past event${preview.pastEventsCount === 1 ? "" : "s"}`}
        />
      ) : null}
      {preview.soldOrdersCount > 0 ? (
        <CascadeRow
          icon="ticket"
          label={`${preview.soldOrdersCount} ticket sale${preview.soldOrdersCount === 1 ? "" : "s"} · ${formatGbp(preview.totalRevenueGbp)}`}
        />
      ) : null}
      {preview.doorSalesCount > 0 ? (
        <CascadeRow
          icon="cash"
          label={`${preview.doorSalesCount} door sale${preview.doorSalesCount === 1 ? "" : "s"}`}
        />
      ) : null}
      {preview.compsCount > 0 ? (
        <CascadeRow
          icon="user"
          label={`${preview.compsCount} comp guest${preview.compsCount === 1 ? "" : "s"}`}
        />
      ) : null}
      {preview.teamInvitationsCount > 0 ? (
        <CascadeRow
          icon="send"
          label={`${preview.teamInvitationsCount} team invitation${preview.teamInvitationsCount === 1 ? "" : "s"} sent`}
        />
      ) : null}
      {preview.brandsOwnedCount === 0 &&
      preview.brandsTeamMemberCount === 0 &&
      preview.liveEventsCount === 0 &&
      preview.pastEventsCount === 0 &&
      preview.soldOrdersCount === 0 &&
      preview.doorSalesCount === 0 &&
      preview.compsCount === 0 &&
      preview.teamInvitationsCount === 0 ? (
        <Text style={styles.cascadeEmpty}>
          No account-linked data. Your account row will be the only thing
          deleted.
        </Text>
      ) : null}
    </View>

    {/* D-14-14 active-events warn block */}
    {preview.hasActiveOrUpcomingEvents ? (
      <View style={styles.activeEventsWarn}>
        <Icon name="flag" size={16} color={accent.warm} />
        <Text style={styles.activeEventsWarnText}>
          You have live or upcoming events. Buyers will lose access to those
          events when your account is permanently deleted on day 31. Consider
          cancelling them first.
        </Text>
      </View>
    ) : null}

    <View style={styles.ctaRow}>
      <Button
        label="Back"
        variant="ghost"
        size="md"
        fullWidth
        onPress={onBack}
      />
    </View>
    <View style={styles.ctaRow}>
      <Button
        label="Continue"
        variant="secondary"
        size="md"
        fullWidth
        onPress={onContinue}
      />
    </View>
  </View>
);

// ============================================================
// Step 3 — Type-to-confirm
// ============================================================

interface Step3ConfirmProps {
  email: string;
  input: string;
  onChangeInput: (value: string) => void;
  emailMatches: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

const Step3Confirm: React.FC<Step3ConfirmProps> = ({
  email,
  input,
  onChangeInput,
  emailMatches,
  deleting,
  onConfirm,
  onBack,
}) => (
  <View style={styles.confirmHost}>
    <Text style={styles.confirmTitle}>Type your email to confirm</Text>
    <Text style={styles.confirmSubtitle}>
      Confirm that you really want to delete your account.
    </Text>
    <View style={styles.confirmEmailBox}>
      <Text style={styles.confirmEmailLabel}>YOUR EMAIL</Text>
      <Text style={styles.confirmEmail} numberOfLines={1}>
        {email}
      </Text>
    </View>
    <TextInput
      style={styles.confirmInput}
      placeholder="Type your email"
      placeholderTextColor={textTokens.tertiary}
      value={input}
      onChangeText={onChangeInput}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="email-address"
      editable={!deleting}
    />
    <View style={styles.ctaRow}>
      <Button
        label="Back"
        variant="ghost"
        size="md"
        fullWidth
        onPress={onBack}
        disabled={deleting}
      />
    </View>
    <View style={styles.ctaRow}>
      <Button
        label={deleting ? "Deleting..." : "Delete my account"}
        variant="secondary"
        size="md"
        fullWidth
        disabled={!emailMatches || deleting}
        onPress={onConfirm}
        accessibilityLabel="Delete my account"
      />
    </View>
  </View>
);

// ============================================================
// Step 4 — Success
// ============================================================

const Step4Success: React.FC = () => (
  <View style={styles.successHost}>
    <View style={styles.successIconWrap}>
      <Icon name="check" size={48} color="#34c759" />
    </View>
    <Text style={styles.successTitle}>Account scheduled for deletion</Text>
    <Text style={styles.successBody}>
      You can recover it by signing in again within 30 days. After that,
      everything will be permanently erased.
    </Text>
    <ActivityIndicator
      size="small"
      color={textTokens.tertiary}
      style={styles.successSpinner}
    />
  </View>
);

// ============================================================
// CascadeRow (composed inline)
// ============================================================

interface CascadeRowProps {
  icon: IconName;
  label: string;
}

const CascadeRow: React.FC<CascadeRowProps> = ({ icon, label }) => (
  <View style={styles.cascadeRow}>
    <View style={styles.cascadeIconBadge}>
      <Icon name={icon} size={16} color={textTokens.secondary} />
    </View>
    <Text style={styles.cascadeLabel} numberOfLines={2}>
      {label}
    </Text>
  </View>
);

// ============================================================
// Styles
// ============================================================
//
// All inline colors hex/rgb/rgba per memory rule feedback_rn_color_formats.
// No oklch/lab/lch/color-mix anywhere.

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },

  // Step 1 Warn ------------------------------------------------------
  warnHost: {
    alignItems: "center",
    gap: spacing.md,
  },
  warnIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  warnTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
    letterSpacing: -0.3,
    paddingHorizontal: spacing.sm,
  },
  warnBody: {
    fontSize: 14,
    lineHeight: 20,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  appleNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.20)",
    marginTop: spacing.sm,
  },
  appleNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },

  // Step 2 Preview ---------------------------------------------------
  previewHost: {
    gap: spacing.md,
  },
  previewTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginTop: spacing.md,
  },
  cascadeList: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  cascadeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cascadeIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  cascadeLabel: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
  },
  cascadeEmpty: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: spacing.sm,
  },
  activeEventsWarn: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.30)",
  },
  activeEventsWarnText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: textTokens.secondary,
  },

  // Step 3 Confirm ---------------------------------------------------
  confirmHost: {
    gap: spacing.md,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginTop: spacing.md,
  },
  confirmSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  confirmEmailBox: {
    padding: spacing.md - 2,
    borderRadius: radiusTokens.md,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    gap: 4,
  },
  confirmEmailLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
  confirmEmail: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  confirmInput: {
    fontSize: 15,
    color: textTokens.primary,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
  },

  // Step 4 Success ---------------------------------------------------
  successHost: {
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.xl,
  },
  successIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(52, 199, 89, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  successBody: {
    fontSize: 14,
    lineHeight: 20,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  successSpinner: {
    marginTop: spacing.lg,
  },

  // CTAs -------------------------------------------------------------
  ctaRow: {
    marginTop: spacing.sm,
  },

  // Toast ------------------------------------------------------------
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 12,
  },

  // Reserved for any error variant tints (semantic.error available if needed)
  // keep import alive without dead-import warning
  _reserved: {
    color: semantic.error,
  },
});
