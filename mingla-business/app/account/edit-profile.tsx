/**
 * Edit profile route — Cycle 14 J-A1 (DEC-096 D-14-1 + D-14-2 + D-14-3).
 *
 * D-14-1: email read-only via OAuth (Mingla Business is Google + Apple only)
 * D-14-2: profile photo via NEW creator_avatars bucket per SPEC §1.5 SPEC-pivot
 * D-14-3: persistence via direct React Query mutation (useUpdateCreatorAccount)
 *
 * Selector pattern rule (Cycle 9c v2 + Cycle 12 lesson): React Query hooks
 * for server state; useState for form state; no Zustand.
 *
 * I-21: operator-side route. Uses useAuth via useCurrentBrandRole. NEVER
 * imported by anon-tolerant buyer routes.
 *
 * ORCH-0710: ALL hooks declared BEFORE any conditional early-return.
 *
 * Per Cycle 14 SPEC §4.7.2.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import {
  useCreatorAccount,
  useUpdateCreatorAccount,
} from "../../src/hooks/useCreatorAccount";
import { supabase } from "../../src/services/supabase";

import { Button } from "../../src/components/ui/Button";
import { ConfirmDialog } from "../../src/components/ui/ConfirmDialog";
import { EmptyState } from "../../src/components/ui/EmptyState";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Pill } from "../../src/components/ui/Pill";
import { Toast } from "../../src/components/ui/Toast";
import { usePermissionWithFallback } from "../../src/hooks/usePermissionWithFallback";

const NAME_MAX_LENGTH = 80;

export default function EditProfileRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { data: account, isLoading, isError, refetch } = useCreatorAccount();
  const { mutateAsync: updateAccount, isPending: updating } =
    useUpdateCreatorAccount();

  const [name, setName] = useState<string>("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState<boolean>(false);
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

  // Hydrate form once account row resolves
  useEffect(() => {
    if (account !== null) {
      setName(account.display_name ?? "");
      setPhotoUri(account.avatar_url ?? null);
    }
  }, [account]);

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

  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  // Cycle 16a J-X6 (DEC-098): consolidated permission UX — denied with
  // canAskAgain=false → ConfirmDialog with "Open Settings" CTA. Replaces
  // Cycle 14 toast-only fallback ("Photo permission required.") with a
  // settings-deeplink path so users can recover from earlier denial.
  const photoGate = usePermissionWithFallback({
    request: async () => {
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      return {
        granted: result.granted,
        canAskAgain: result.canAskAgain ?? true,
      };
    },
    permissionLabel: "Photo library",
    permissionRationale:
      "Mingla needs photo library access to upload your profile picture.",
  });

  const handlePickPhoto = useCallback(async (): Promise<void> => {
    if (user === null) return;
    const granted = await photoGate.requestWithFallback();
    if (!granted) {
      // Two paths handled here:
      //  - Denied with canAskAgain=true: hook returned false, no dialog;
      //    show toast so user knows why nothing happened.
      //  - Denied with canAskAgain=false: hook opened settings dialog;
      //    user sees the dialog (no toast needed; dialog tells them what to do).
      if (!photoGate.settingsDialogVisible) {
        showToast("Photo permission required.");
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      const ext = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
      const validExt = ["jpg", "jpeg", "png", "webp"].includes(ext)
        ? ext === "jpeg"
          ? "jpg"
          : ext
        : "jpg";
      const path = `${user.id}.${validExt}`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from("creator_avatars")
        .upload(path, blob, {
          upsert: true,
          contentType: blob.type !== "" ? blob.type : `image/${validExt}`,
        });
      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage
        .from("creator_avatars")
        .getPublicUrl(path);
      // Cache-bust so the new image renders even though the URL is unchanged
      setPhotoUri(`${publicUrlData.publicUrl}?t=${Date.now()}`);
    } catch (_err) {
      showToast("Couldn't upload photo. Tap to try again.");
    } finally {
      setUploadingPhoto(false);
    }
  }, [user, showToast]);

  const handleSave = useCallback(async (): Promise<void> => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      showToast("Name can't be empty.");
      return;
    }
    if (trimmedName.length > NAME_MAX_LENGTH) {
      showToast(`Name must be ${NAME_MAX_LENGTH} characters or less.`);
      return;
    }
    try {
      await updateAccount({
        display_name: trimmedName,
        avatar_url: photoUri,
      });
      showToast("Profile updated.");
      setTimeout(() => router.back(), 800);
    } catch (_err) {
      showToast("Couldn't save. Tap to try again.");
    }
  }, [name, photoUri, updateAccount, router, showToast]);

  // ---- Early returns (after all hooks per ORCH-0710) ----

  if (isLoading) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <ChromeRow title="Edit profile" onBack={handleBack} />
        <View style={styles.loadingHost}>
          <ActivityIndicator size="large" color={accent.warm} />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View
        style={[
          styles.host,
          { paddingTop: insets.top, backgroundColor: canvas.discover },
        ]}
      >
        <ChromeRow title="Edit profile" onBack={handleBack} />
        <View style={styles.emptyHost}>
          <EmptyState
            illustration="user"
            title="Couldn't load profile"
            description="Pull to retry, or tap below."
            cta={{
              label: "Retry",
              onPress: () => {
                void refetch();
              },
              variant: "primary",
            }}
          />
        </View>
      </View>
    );
  }

  const initials = (account?.display_name ?? user?.email ?? "U")
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      <ChromeRow title="Edit profile" onBack={handleBack} />
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
        {/* Avatar section */}
        <View style={styles.avatarSection}>
          <Pressable
            onPress={handlePickPhoto}
            disabled={uploadingPhoto || updating}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            style={({ pressed }) => [
              styles.avatarWrap,
              pressed && styles.avatarWrapPressed,
            ]}
          >
            {photoUri !== null && photoUri.length > 0 ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )}
            {uploadingPhoto ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator size="small" color="#ffffff" />
              </View>
            ) : (
              <View style={styles.avatarEditBadge}>
                <Text style={styles.avatarEditText}>Edit</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Name field */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            style={styles.textInput}
            placeholder="Your name"
            placeholderTextColor={textTokens.tertiary}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX_LENGTH + 10}
            editable={!updating}
            autoCapitalize="words"
          />
          <Text style={styles.fieldHint}>
            {name.trim().length} / {NAME_MAX_LENGTH}
          </Text>
        </View>

        {/* Email read-only */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Email</Text>
          <View style={styles.emailRow}>
            <Text style={styles.emailValue} numberOfLines={1}>
              {account?.email ?? user?.email ?? ""}
            </Text>
            <Pill variant="info">
              {provider === "google"
                ? "via Google"
                : provider === "apple"
                  ? "via Apple"
                  : "via OAuth"}
            </Pill>
          </View>
          <Text style={styles.fieldHint}>
            Email is managed by your sign-in provider.
          </Text>
        </View>

        {/* Save CTA */}
        <View style={styles.saveRow}>
          <Button
            label={updating ? "Saving..." : "Save"}
            onPress={handleSave}
            variant="primary"
            size="md"
            fullWidth
            disabled={updating || uploadingPhoto}
          />
        </View>
      </ScrollView>

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={() => setToast({ visible: false, message: "" })}
        />
      </View>

      {/* Cycle 16a J-X6 — permission settings dialog (DEC-098). Renders
          INSIDE consumer tree per feedback_rn_sub_sheet_must_render_inside_parent. */}
      <ConfirmDialog
        visible={photoGate.settingsDialogVisible}
        onClose={photoGate.dismissSettingsDialog}
        onConfirm={photoGate.openSettings}
        title={photoGate.dialogTitle}
        description={photoGate.dialogDescription}
        confirmLabel="Open Settings"
        cancelLabel="Not now"
      />
    </View>
  );
}

// ============================================================
// Chrome (shared between loading/error/loaded)
// ============================================================

interface ChromeRowProps {
  title: string;
  onBack: () => void;
}

const ChromeRow: React.FC<ChromeRowProps> = ({ title, onBack }) => (
  <View style={styles.chromeRow}>
    <IconChrome
      icon="close"
      size={36}
      onPress={onBack}
      accessibilityLabel="Back"
    />
    <Text style={styles.chromeTitle}>{title}</Text>
    <View style={styles.chromeRightSlot} />
  </View>
);

// ============================================================
// Styles
// ============================================================

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
    gap: spacing.lg,
  },
  loadingHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyHost: {
    flex: 1,
    paddingTop: spacing.xl * 2,
  },

  // Avatar -----------------------------------------------------------
  avatarSection: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
  avatarWrap: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: accent.border,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  avatarWrapPressed: {
    opacity: 0.7,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  avatarInitials: {
    fontSize: 36,
    fontWeight: "700",
    color: accent.warm,
    letterSpacing: -0.5,
  },
  avatarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    paddingVertical: 6,
    alignItems: "center",
  },
  avatarEditText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: "#ffffff",
    textTransform: "uppercase",
  },

  // Field groups -----------------------------------------------------
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  textInput: {
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
  fieldHint: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
    minHeight: 44,
  },
  emailValue: {
    flex: 1,
    fontSize: 15,
    color: textTokens.secondary,
  },

  // Save -------------------------------------------------------------
  saveRow: {
    marginTop: spacing.lg,
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
});
