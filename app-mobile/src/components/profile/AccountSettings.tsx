import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Text,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Pressable,
  Alert,
  Platform,
  AppState,
  LayoutAnimation,
  UIManager,
  useWindowDimensions,
} from "react-native";
import type { AppStateStatus } from "react-native";
import { Icon } from "../ui/Icon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../services/supabase";
import { extractFunctionError } from "../../utils/edgeFunctionError";
import { useAppState } from "../AppStateManager";
import { useAppStore } from "../../store/appStore";
import { authService } from "../../services/authService";
import { mixpanelService } from "../../services/mixpanelService";
import Toggle from "./Toggle";
import * as Haptics from "expo-haptics";
import type { NotificationPreferences } from "../../services/smartNotificationService";

// Enable LayoutAnimation on Android
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// --- Gender & Language options ---
const GENDER_OPTIONS = [
  "Woman",
  "Man",
  "Non-binary",
  "Prefer not to say",
] as const;

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "pt", name: "Portuguese" },
  { code: "de", name: "German" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Mandarin" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "hi", name: "Hindi" },
] as const;

const VISIBILITY_MODES = ["friends", "public", "private"] as const;
const VISIBILITY_LABELS: Record<string, string> = {
  friends: "Friends Only",
  public: "Everyone",
  private: "Nobody",
};
const VISIBILITY_DESCRIPTIONS: Record<string, string> = {
  friends: "Only people you've linked with can see your profile.",
  public: "Anyone on Mingla can find you and see your profile.",
  private: "You're invisible. No one can see your profile — full ghost mode.",
};

// --- Accordion section IDs ---
type SectionId = "basics" | "privacy" | "notifications" | "quietHours" | "appInfo";

// Smooth spring-like animation config for accordions
const ACCORDION_ANIM = {
  duration: 250,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

interface AccountSettingsProps {
  visible: boolean;
  onClose: () => void;
  notificationsEnabled?: boolean;
  onNotificationsToggle?: (enabled: boolean) => void;
}

export default function AccountSettings({ visible, onClose, notificationsEnabled = true, onNotificationsToggle }: AccountSettingsProps) {
  const insets = useSafeAreaInsets();
  const { user, handleSignOut } = useAppState();
  const profile = useAppStore((s) => s.profile);

  // Field states
  const [birthday, setBirthday] = useState<string | null>(profile?.birthday || null);
  const [gender, setGender] = useState<string | null>(profile?.gender || null);
  const [preferredLanguage, setPreferredLanguage] = useState<string | null>(
    profile?.preferred_language || null
  );
  const currentVisibility = profile?.visibility_mode || "friends";
  const showActivity = profile?.show_activity !== false;

  // Picker modals
  const [showGenderPicker, setShowGenderPicker] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showBirthdayPicker, setShowBirthdayPicker] = useState(false);

  // Delete account state
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deleteStep, setDeleteStep] = useState<"confirm" | "deleting" | "success" | "error">("confirm");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInProgressRef = useRef(false);
  const deleteStartTimeRef = useRef<number | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Saving states for individual fields
  const [savingField, setSavingField] = useState<string | null>(null);

  // ── Accordion state — "basics" expanded by default ──
  const [expandedSections, setExpandedSections] = useState<Set<SectionId>>(new Set(["basics"]));

  const toggleSection = useCallback((id: SectionId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(ACCORDION_ANIM);
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Reset accordion state when sheet opens
  useEffect(() => {
    if (visible) {
      setExpandedSections(new Set(["basics"]));
    }
  }, [visible]);

  // ── Notification Preferences (V2) ──
  const [notifPrefs, setNotifPrefs] = useState<Partial<NotificationPreferences>>({
    push_enabled: true,
    friend_requests: true,
    link_requests: true,
    messages: true,
    collaboration_invites: true,
    marketing: true,
  });
  const [dmBypassQuietHours, setDmBypassQuietHours] = useState(false);
  const [isLoadingNotifPrefs, setIsLoadingNotifPrefs] = useState(false);

  // Fetch notification preferences on mount
  useEffect(() => {
    if (!visible || !user?.id) return;
    setIsLoadingNotifPrefs(true);
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (data && !error) {
          setNotifPrefs({
            push_enabled: data.push_enabled ?? true,
            friend_requests: data.friend_requests ?? true,
            link_requests: data.link_requests ?? true,
            messages: data.messages ?? true,
            collaboration_invites: data.collaboration_invites ?? true,
            marketing: data.marketing ?? true,
          });
          setDmBypassQuietHours((data as any).dm_bypass_quiet_hours ?? false);
        }
      })
      .finally(() => setIsLoadingNotifPrefs(false));
  }, [visible, user?.id]);

  const updateNotifPref = async (key: string, value: boolean) => {
    if (!user?.id) return;
    const prev = { ...notifPrefs };
    setNotifPrefs((p) => ({ ...p, [key]: value }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // UPSERT: creates the row if it doesn't exist (e.g., users who signed up
    // before the auto-create trigger was deployed). ON CONFLICT updates the field.
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: user.id, [key]: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) {
      setNotifPrefs(prev);
      Alert.alert("Error", "Failed to update notification setting.");
    }
  };

  const updateDmBypass = async (value: boolean) => {
    if (!user?.id) return;
    const prev = dmBypassQuietHours;
    setDmBypassQuietHours(value);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await supabase
      .from('notification_preferences')
      .upsert(
        { user_id: user.id, dm_bypass_quiet_hours: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) {
      setDmBypassQuietHours(prev);
      Alert.alert("Error", "Failed to update quiet hours setting.");
    }
  };

  // Sync local state from store when sheet opens or profile changes externally
  useEffect(() => {
    if (visible) {
      setBirthday(profile?.birthday || null);
      setGender(profile?.gender || null);
      setPreferredLanguage(profile?.preferred_language || null);
    }
  }, [visible, profile?.birthday, profile?.gender, profile?.preferred_language]);

  // --- Field update helpers ---
  const setProfile = useAppStore((s) => s.setProfile);

  const updateField = async (field: string, value: unknown) => {
    if (!user?.id) return;
    setSavingField(field);
    try {
      await authService.updateUserProfile(user.id, { [field]: value });
      if (profile) {
        setProfile({ ...profile, [field]: value } as typeof profile);
      }
      mixpanelService.trackProfileSettingUpdated({ field });
    } catch {
      Alert.alert("Error", "Failed to update. Please try again.");
    } finally {
      setSavingField(null);
    }
  };

  const handleCycleVisibility = async () => {
    if (!user?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const currentIndex = VISIBILITY_MODES.indexOf(currentVisibility as typeof VISIBILITY_MODES[number]);
    const nextMode = VISIBILITY_MODES[(currentIndex + 1) % VISIBILITY_MODES.length];
    await updateField("visibility_mode", nextMode);
  };

  const handleToggleShowActivity = async () => {
    await updateField("show_activity", !showActivity);
  };

  const handleSelectGender = async (value: string) => {
    setGender(value);
    setShowGenderPicker(false);
    await updateField("gender", value);
  };

  const handleSelectLanguage = async (code: string) => {
    setPreferredLanguage(code);
    setShowLanguagePicker(false);
    await updateField("preferred_language", code);
  };

  const handleSelectBirthday = async (dateStr: string) => {
    setBirthday(dateStr);
    setShowBirthdayPicker(false);
    await updateField("birthday", dateStr);
  };

  // --- Delete account ---
  const handleDeleteAccount = () => {
    setDeleteStep("confirm");
    setDeleteError(null);
    setShowDeleteConfirmModal(true);
  };

  const executeDeleteAccount = async () => {
    if (deleteInProgressRef.current) return;
    if (!user?.id) {
      setDeleteError("You must be signed in to delete your account.");
      setDeleteStep("error");
      return;
    }

    deleteInProgressRef.current = true;
    deleteStartTimeRef.current = Date.now();
    setDeleteStep("deleting");
    setIsDeleting(true);

    let timeoutIntervalId: ReturnType<typeof setInterval> | null = null;

    try {
      const WALL_CLOCK_TIMEOUT_MS = 45000;
      const invokePromise = supabase.functions.invoke("delete-user", {
        method: "POST",
        body: { userId: user.id },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutIntervalId = setInterval(() => {
          if (deleteStartTimeRef.current && Date.now() - deleteStartTimeRef.current > WALL_CLOCK_TIMEOUT_MS) {
            if (timeoutIntervalId) clearInterval(timeoutIntervalId);
            reject(new Error("TIMEOUT"));
          }
        }, 1000);
      });

      const result = await Promise.race([invokePromise, timeoutPromise]);
      const { data, error } = result as { data: { success?: boolean; error?: string } | null; error: Error | null };

      if (error) {
        const errorMessage = await extractFunctionError(error, "An error occurred while deleting your account.");
        throw new Error(errorMessage);
      }
      if (data?.error) throw new Error(data.error);

      await supabase.auth.signOut().catch(() => {});
      setDeleteStep("success");

      setTimeout(() => {
        setShowDeleteConfirmModal(false);
        onClose();
        handleSignOut().catch((err) => console.error("Sign-out after account deletion failed:", err));
      }, 2000);
    } catch (e: unknown) {
      console.error("Delete account error:", e);
      if (e instanceof Error && e.message === "TIMEOUT") {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            await supabase.auth.signOut().catch(() => {});
            setDeleteStep("success");
            setTimeout(() => {
              setShowDeleteConfirmModal(false);
              onClose();
              handleSignOut().catch(console.error);
            }, 2000);
            return;
          }
        } catch { /* fall through */ }
        setDeleteError("This is taking longer than expected. Your account may already be deleted — try closing and reopening the app.");
        setDeleteStep("error");
      } else {
        const errorMsg = e instanceof Error ? e.message : "Could not delete account. Please try again.";
        setDeleteError(errorMsg);
        setDeleteStep("error");
      }
    } finally {
      if (timeoutIntervalId) clearInterval(timeoutIntervalId);
      setIsDeleting(false);
      deleteInProgressRef.current = false;
      deleteStartTimeRef.current = null;
    }
  };

  // Detect app returning from background while delete is in-flight
  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (nextAppState: AppStateStatus) => {
      const wasBackground = appStateRef.current === "background" || appStateRef.current === "inactive";
      appStateRef.current = nextAppState;
      if (nextAppState === "active" && wasBackground && deleteInProgressRef.current) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            await supabase.auth.signOut().catch(() => {});
            setDeleteStep("success");
            setIsDeleting(false);
            deleteInProgressRef.current = false;
            deleteStartTimeRef.current = null;
            setTimeout(() => {
              setShowDeleteConfirmModal(false);
              onClose();
              handleSignOut().catch(console.error);
            }, 2000);
          }
        } catch { /* let timeout handle it */ }
      }
    });
    return () => subscription.remove();
  }, [handleSignOut, onClose]);

  const closeDeleteModal = () => {
    if (deleteStep === "deleting") {
      if (!deleteStartTimeRef.current || Date.now() - deleteStartTimeRef.current < 10000) return;
    }
    setShowDeleteConfirmModal(false);
    setDeleteStep("confirm");
    setDeleteError(null);
    if (deleteInProgressRef.current) {
      setIsDeleting(false);
      deleteInProgressRef.current = false;
      deleteStartTimeRef.current = null;
    }
  };

  // --- Format helpers ---
  const formatBirthday = (iso: string | null): string => {
    if (!iso) return "";
    try {
      const d = new Date(iso + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return iso;
    }
  };

  const getLanguageName = (code: string | null): string => {
    if (!code) return "";
    return LANGUAGE_OPTIONS.find((l) => l.code === code)?.name || code;
  };

  // --- Sheet sizing (matches BillingSheet pattern) ---
  const { height: windowHeight } = useWindowDimensions();
  const SHEET_TOP = Math.round(windowHeight * 0.08);

  // --- Render ---
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={{ height: SHEET_TOP }} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Settings</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Close account settings"
              accessibilityRole="button"
            >
              <Icon name="close" size={24} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollContent}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces
            overScrollMode="always"
          >
            {/* Section 1: The Basics (accordion) */}
            <AccordionCard
              icon="person-circle"
              title="The Basics"
              expanded={expandedSections.has("basics")}
              onToggle={() => toggleSection("basics")}
            >
              {/* Birthday */}
              <TouchableOpacity style={styles.row} onPress={() => setShowBirthdayPicker(true)} activeOpacity={0.7}>
                <Text style={styles.rowLabel}>Birthday</Text>
                <View style={styles.rowRight}>
                  {savingField === "birthday" ? (
                    <ActivityIndicator size="small" color="#eb7825" />
                  ) : (
                    <Text style={[styles.rowValue, !birthday && styles.rowPlaceholder]}>
                      {birthday ? formatBirthday(birthday) : "When's the party?"}
                    </Text>
                  )}
                  <Icon name="chevron-forward" size={16} color="#9ca3af" />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Gender */}
              <TouchableOpacity style={styles.row} onPress={() => setShowGenderPicker(true)} activeOpacity={0.7}>
                <Text style={styles.rowLabel}>Gender</Text>
                <View style={styles.rowRight}>
                  {savingField === "gender" ? (
                    <ActivityIndicator size="small" color="#eb7825" />
                  ) : (
                    <Text style={[styles.rowValue, !gender && styles.rowPlaceholder]}>
                      {gender || "How do you identify?"}
                    </Text>
                  )}
                  <Icon name="chevron-forward" size={16} color="#9ca3af" />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Preferred Language */}
              <TouchableOpacity style={styles.row} onPress={() => setShowLanguagePicker(true)} activeOpacity={0.7}>
                <Text style={styles.rowLabel}>Language</Text>
                <View style={styles.rowRight}>
                  {savingField === "preferred_language" ? (
                    <ActivityIndicator size="small" color="#eb7825" />
                  ) : (
                    <Text style={[styles.rowValue, !preferredLanguage && styles.rowPlaceholder]}>
                      {getLanguageName(preferredLanguage) || "Choose your language"}
                    </Text>
                  )}
                  <Icon name="chevron-forward" size={16} color="#9ca3af" />
                </View>
              </TouchableOpacity>
            </AccordionCard>

            {/* Section 2: Privacy (accordion) */}
            <AccordionCard
              icon="lock-closed"
              title="Privacy"
              expanded={expandedSections.has("privacy")}
              onToggle={() => toggleSection("privacy")}
            >
              {/* Profile Visibility */}
              <TouchableOpacity style={[styles.row, styles.rowMultiline]} onPress={handleCycleVisibility} activeOpacity={0.7}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Profile Visibility</Text>
                  <Text style={styles.rowHint}>
                    {VISIBILITY_DESCRIPTIONS[currentVisibility] || ""}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  {savingField === "visibility_mode" ? (
                    <ActivityIndicator size="small" color="#eb7825" />
                  ) : (
                    <Text style={styles.rowValueBold}>
                      {VISIBILITY_LABELS[currentVisibility] || "Friends Only"}
                    </Text>
                  )}
                  <Icon name="chevron-forward" size={16} color="#9ca3af" />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Show Activity */}
              <View style={[styles.row, styles.rowMultiline]}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Show Activity</Text>
                  <Text style={styles.rowHint}>
                    {showActivity
                      ? "Friends can see what you've been up to lately."
                      : "Your activity is hidden from everyone."}
                  </Text>
                </View>
                <Toggle value={showActivity} onToggle={handleToggleShowActivity} />
              </View>

              <View style={styles.rowDivider} />

              {/* Notifications - legacy toggle */}
              <View style={[styles.row, styles.rowMultiline]}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Notifications</Text>
                  <Text style={styles.rowHint}>Invites, boards, and messages</Text>
                </View>
                <Toggle
                  value={notificationsEnabled}
                  onToggle={() => onNotificationsToggle?.(!notificationsEnabled)}
                />
              </View>
            </AccordionCard>

            {/* Section 3: Notification Settings (accordion) */}
            <AccordionCard
              icon="notifications"
              title="Notification Settings"
              expanded={expandedSections.has("notifications")}
              onToggle={() => toggleSection("notifications")}
            >
              {/* Master toggle */}
              <View style={[styles.row, styles.rowMultiline]}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Push Notifications</Text>
                  <Text style={styles.rowHint}>Receive push notifications on your device</Text>
                </View>
                <Toggle
                  value={notifPrefs.push_enabled ?? true}
                  onToggle={() => updateNotifPref('push_enabled', !notifPrefs.push_enabled)}
                />
              </View>

              {/* Sub-toggles — only shown when master is enabled */}
              {notifPrefs.push_enabled && (
                <>
                  <View style={styles.rowDivider} />
                  <View style={[styles.row, styles.rowMultiline]}>
                    <View style={styles.rowLabelWrap}>
                      <Text style={styles.rowLabel}>Friends & Pairing</Text>
                      <Text style={styles.rowHint}>Friend requests, pair requests, and social updates</Text>
                    </View>
                    <Toggle
                      value={notifPrefs.friend_requests ?? true}
                      onToggle={() => updateNotifPref('friend_requests', !notifPrefs.friend_requests)}
                    />
                  </View>

                  <View style={styles.rowDivider} />
                  <View style={[styles.row, styles.rowMultiline]}>
                    <View style={styles.rowLabelWrap}>
                      <Text style={styles.rowLabel}>Link Requests</Text>
                      <Text style={styles.rowHint}>When someone wants to link profiles with you</Text>
                    </View>
                    <Toggle
                      value={notifPrefs.link_requests ?? true}
                      onToggle={() => updateNotifPref('link_requests', !notifPrefs.link_requests)}
                    />
                  </View>

                  <View style={styles.rowDivider} />
                  <View style={[styles.row, styles.rowMultiline]}>
                    <View style={styles.rowLabelWrap}>
                      <Text style={styles.rowLabel}>Messages</Text>
                      <Text style={styles.rowHint}>Direct messages and session chat</Text>
                    </View>
                    <Toggle
                      value={notifPrefs.messages ?? true}
                      onToggle={() => updateNotifPref('messages', !notifPrefs.messages)}
                    />
                  </View>

                  <View style={styles.rowDivider} />
                  <View style={[styles.row, styles.rowMultiline]}>
                    <View style={styles.rowLabelWrap}>
                      <Text style={styles.rowLabel}>Sessions</Text>
                      <Text style={styles.rowHint}>Invites, member updates, and board activity</Text>
                    </View>
                    <Toggle
                      value={notifPrefs.collaboration_invites ?? true}
                      onToggle={() => updateNotifPref('collaboration_invites', !notifPrefs.collaboration_invites)}
                    />
                  </View>

                  <View style={styles.rowDivider} />
                  <View style={[styles.row, styles.rowMultiline]}>
                    <View style={styles.rowLabelWrap}>
                      <Text style={styles.rowLabel}>Tips & Re-engagement</Text>
                      <Text style={styles.rowHint}>Occasional nudges, weekly digest, and recommendations</Text>
                    </View>
                    <Toggle
                      value={notifPrefs.marketing ?? true}
                      onToggle={() => updateNotifPref('marketing', !notifPrefs.marketing)}
                    />
                  </View>
                </>
              )}
            </AccordionCard>

            {/* Section 4: Quiet Hours (accordion) */}
            <AccordionCard
              icon="moon"
              title="Quiet Hours"
              expanded={expandedSections.has("quietHours")}
              onToggle={() => toggleSection("quietHours")}
            >
              <View style={[styles.row, styles.rowMultiline]}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Quiet Hours</Text>
                  <Text style={styles.rowHint}>10 PM - 8 AM</Text>
                </View>
                <Text style={styles.rowValueMuted}>Active</Text>
              </View>

              <View style={styles.rowDivider} />

              <View style={[styles.row, styles.rowMultiline]}>
                <View style={styles.rowLabelWrap}>
                  <Text style={styles.rowLabel}>Messages during quiet hours</Text>
                  <Text style={styles.rowHint}>Allow DMs between 10 PM - 8 AM</Text>
                </View>
                <Toggle
                  value={dmBypassQuietHours}
                  onToggle={() => updateDmBypass(!dmBypassQuietHours)}
                />
              </View>
            </AccordionCard>

            {/* Section 5: App Information (accordion) */}
            <AccordionCard
              icon="information-circle"
              title="App Information"
              expanded={expandedSections.has("appInfo")}
              onToggle={() => toggleSection("appInfo")}
            >
              <View style={styles.row}>
                <Text style={styles.rowLabel}>App Version</Text>
                <Text style={styles.rowValueMuted}>1.0.0</Text>
              </View>
            </AccordionCard>

            {/* Section 6: The Red Zone (NOT collapsible — always visible) */}
            <View style={[styles.card, styles.dangerCard]}>
              <View style={styles.cardHeaderStatic}>
                <Icon name="trash" size={20} color="#ef4444" />
                <Text style={[styles.cardTitle, styles.dangerTitle]}>The Red Zone</Text>
              </View>

              <TouchableOpacity
                onPress={handleDeleteAccount}
                style={[styles.deleteButton, isDeleting && styles.deleteButtonDisabled]}
                disabled={isDeleting}
                activeOpacity={0.7}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#dc2626" />
                ) : (
                  <Icon name="trash" size={16} color="#dc2626" />
                )}
                <Text style={styles.deleteButtonText}>
                  {isDeleting ? "Deleting\u2026" : "Delete My Account"}
                </Text>
              </TouchableOpacity>

              <Text style={styles.dangerWarning}>
                This permanently deletes your data, your boards, and your history. There's no undo.
              </Text>
            </View>

          </ScrollView>
        </View>
      </View>

      {/* --- Picker modals --- */}

      {/* Gender picker */}
      <Modal visible={showGenderPicker} transparent animationType="slide" onRequestClose={() => setShowGenderPicker(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setShowGenderPicker(false)}>
          <View style={styles.pickerSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Gender</Text>
            {GENDER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option}
                style={styles.pickerOption}
                onPress={() => handleSelectGender(option)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickerOptionText, gender === option && styles.pickerOptionSelected]}>
                  {option}
                </Text>
                {gender === option && <Icon name="checkmark" size={20} color="#eb7825" />}
              </TouchableOpacity>
            ))}
            <View style={{ height: Math.max(insets.bottom, 16) }} />
          </View>
        </Pressable>
      </Modal>

      {/* Language picker */}
      <Modal visible={showLanguagePicker} transparent animationType="slide" onRequestClose={() => setShowLanguagePicker(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setShowLanguagePicker(false)}>
          <View style={styles.pickerSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Language</Text>
            {LANGUAGE_OPTIONS.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={styles.pickerOption}
                onPress={() => handleSelectLanguage(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={[styles.pickerOptionText, preferredLanguage === lang.code && styles.pickerOptionSelected]}>
                  {lang.name}
                </Text>
                {preferredLanguage === lang.code && <Icon name="checkmark" size={20} color="#eb7825" />}
              </TouchableOpacity>
            ))}
            <View style={{ height: Math.max(insets.bottom, 16) }} />
          </View>
        </Pressable>
      </Modal>

      {/* Birthday picker */}
      <Modal visible={showBirthdayPicker} transparent animationType="slide" onRequestClose={() => setShowBirthdayPicker(false)}>
        <Pressable style={styles.pickerOverlay} onPress={() => setShowBirthdayPicker(false)}>
          <View style={styles.pickerSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Birthday</Text>
            <BirthdayPicker
              currentValue={birthday}
              onSelect={handleSelectBirthday}
              onCancel={() => setShowBirthdayPicker(false)}
            />
            <View style={{ height: Math.max(insets.bottom, 16) }} />
          </View>
        </Pressable>
      </Modal>

      {/* Delete Account Confirmation Modal */}
      <Modal visible={showDeleteConfirmModal} transparent animationType="fade" onRequestClose={closeDeleteModal}>
        <View style={styles.deleteOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeDeleteModal} />
          <View style={styles.deleteModalContainer}>
            {deleteStep === "confirm" && (
              <>
                <View style={styles.deleteIconCircle}>
                  <Icon name="warning" size={48} color="#ef4444" />
                </View>
                <Text style={styles.deleteModalTitle}>Are you sure?</Text>
                <Text style={styles.deleteModalBody}>
                  Deleting your account removes everything — your profile, boards, links, and activity. This can't be reversed.
                </Text>
                <View style={styles.deleteModalButtons}>
                  <TouchableOpacity style={styles.deleteModalCancel} onPress={closeDeleteModal}>
                    <Text style={styles.deleteModalCancelText}>Never mind</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteModalConfirm} onPress={executeDeleteAccount}>
                    <Text style={styles.deleteModalConfirmText}>Yes, Delete Everything</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
            {deleteStep === "deleting" && (
              <>
                <ActivityIndicator size="large" color="#ef4444" style={styles.deleteSpinner} />
                <Text style={styles.deleteModalTitle}>We're sad to see you go</Text>
                <Text style={styles.deleteModalBody}>Packing up your things and sweeping the floors.</Text>
                <Text style={styles.deleteModalSub}>This takes a moment. Hang tight.</Text>
              </>
            )}
            {deleteStep === "success" && (
              <>
                <View style={[styles.deleteIconCircle, styles.deleteIconSuccess]}>
                  <Icon name="checkmark-circle" size={48} color="#10b981" />
                </View>
                <Text style={styles.deleteModalTitle}>Account Deleted</Text>
                <Text style={styles.deleteModalBody}>You're always welcome back. We'll leave the light on.</Text>
                <Text style={styles.deleteModalSub}>Signing you out now. Until next time.</Text>
              </>
            )}
            {deleteStep === "error" && (
              <>
                <View style={styles.deleteIconCircle}>
                  <Icon name="close-circle" size={48} color="#ef4444" />
                </View>
                <Text style={styles.deleteModalTitle}>That Didn't Work</Text>
                <Text style={styles.deleteModalBody}>{deleteError || "Something went wrong. Please try again."}</Text>
                <View style={styles.deleteModalButtons}>
                  <TouchableOpacity style={styles.deleteModalCancel} onPress={closeDeleteModal}>
                    <Text style={styles.deleteModalCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.deleteModalConfirm, styles.deleteRetryButton]} onPress={() => { setDeleteStep("confirm"); setDeleteError(null); }}>
                    <Text style={styles.deleteModalConfirmText}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Accordion Card component ──────────────────────────────────────────

interface AccordionCardProps {
  icon: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  iconColor?: string;
}

function AccordionCard({ icon, title, expanded, onToggle, children, iconColor = "#eb7825" }: AccordionCardProps) {
  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${title} section, ${expanded ? "expanded" : "collapsed"}`}
      >
        <View style={styles.cardHeaderLeft}>
          <Icon name={icon} size={20} color={iconColor} />
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <Icon
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="#9ca3af"
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.cardBody}>
          {children}
        </View>
      )}
    </View>
  );
}

// ── Simple birthday picker component ──────────────────────────────────

interface BirthdayPickerProps {
  currentValue: string | null;
  onSelect: (dateStr: string) => void;
  onCancel: () => void;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function BirthdayPicker({ currentValue, onSelect, onCancel }: BirthdayPickerProps) {
  const now = new Date();
  const parsed = currentValue ? new Date(currentValue + "T00:00:00") : null;

  const [month, setMonth] = useState(parsed ? parsed.getMonth() : 0);
  const [day, setDay] = useState(parsed ? parsed.getDate() : 1);
  const [year, setYear] = useState(parsed ? parsed.getFullYear() : 2000);

  const years = Array.from({ length: now.getFullYear() - 1920 + 1 }, (_, i) => now.getFullYear() - i);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  useEffect(() => {
    if (day > daysInMonth) setDay(daysInMonth);
  }, [month, year, daysInMonth]);

  const handleConfirm = () => {
    const selected = new Date(year, month, day);
    if (selected > now) {
      Alert.alert("Invalid date", "Birthday can't be in the future.");
      return;
    }
    const m = String(month + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    onSelect(`${year}-${m}-${d}`);
  };

  return (
    <View style={bdStyles.container}>
      <View style={bdStyles.row}>
        <View style={bdStyles.column}>
          <Text style={bdStyles.colLabel}>Month</Text>
          <ScrollView style={bdStyles.scroll} showsVerticalScrollIndicator={false}>
            {MONTHS.map((m, i) => (
              <TouchableOpacity
                key={m}
                style={[bdStyles.option, month === i && bdStyles.optionSelected]}
                onPress={() => setMonth(i)}
              >
                <Text style={[bdStyles.optionText, month === i && bdStyles.optionTextSelected]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={bdStyles.column}>
          <Text style={bdStyles.colLabel}>Day</Text>
          <ScrollView style={bdStyles.scroll} showsVerticalScrollIndicator={false}>
            {days.map((d) => (
              <TouchableOpacity
                key={d}
                style={[bdStyles.option, day === d && bdStyles.optionSelected]}
                onPress={() => setDay(d)}
              >
                <Text style={[bdStyles.optionText, day === d && bdStyles.optionTextSelected]}>{d}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={bdStyles.column}>
          <Text style={bdStyles.colLabel}>Year</Text>
          <ScrollView style={bdStyles.scroll} showsVerticalScrollIndicator={false}>
            {years.map((y) => (
              <TouchableOpacity
                key={y}
                style={[bdStyles.option, year === y && bdStyles.optionSelected]}
                onPress={() => setYear(y)}
              >
                <Text style={[bdStyles.optionText, year === y && bdStyles.optionTextSelected]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
      <View style={bdStyles.buttons}>
        <TouchableOpacity style={bdStyles.cancelBtn} onPress={onCancel}>
          <Text style={bdStyles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={bdStyles.confirmBtn} onPress={handleConfirm}>
          <Text style={bdStyles.confirmText}>Set Birthday</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const bdStyles = StyleSheet.create({
  container: { paddingHorizontal: 16 },
  row: { flexDirection: "row", gap: 8, height: 200 },
  column: { flex: 1 },
  colLabel: { fontSize: 12, fontWeight: "600", color: "#9ca3af", textAlign: "center", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  scroll: { flex: 1 },
  option: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8, alignItems: "center" },
  optionSelected: { backgroundColor: "#fff7ed" },
  optionText: { fontSize: 15, color: "#374151" },
  optionTextSelected: { color: "#eb7825", fontWeight: "700" },
  buttons: { flexDirection: "row", gap: 12, marginTop: 16 },
  cancelBtn: { flex: 1, backgroundColor: "#f3f4f6", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  cancelText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  confirmBtn: { flex: 1, backgroundColor: "#eb7825", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  confirmText: { fontSize: 16, fontWeight: "600", color: "#ffffff" },
});

// --- Main styles ---

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: "hidden",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  scrollContent: { flex: 1, paddingHorizontal: 16 },
  // Cards
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  dangerCard: { borderColor: "#fecaca" },
  // Accordion card header (tappable)
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  // Static card header (non-tappable, e.g. Red Zone)
  cardHeaderStatic: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  dangerTitle: { color: "#ef4444" },
  // Accordion body
  cardBody: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  // Rows
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 48,
  },
  rowMultiline: {
    alignItems: "flex-start",
  },
  rowDivider: { height: 1, backgroundColor: "#f3f4f6", marginHorizontal: 16 },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#111827", flex: 1 },
  rowLabelWrap: { flex: 1, marginRight: 16 },
  rowHint: { fontSize: 12, color: "#6b7280", marginTop: 2, lineHeight: 16 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  rowValue: { fontSize: 14, fontWeight: "500", color: "#eb7825" },
  rowValueBold: { fontSize: 14, fontWeight: "700", color: "#eb7825" },
  rowValueMuted: { fontSize: 14, fontWeight: "500", color: "#6b7280" },
  rowPlaceholder: { color: "#9ca3af", fontStyle: "italic" },
  // Delete button
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  deleteButtonDisabled: { opacity: 0.6 },
  deleteButtonText: { fontSize: 15, fontWeight: "600", color: "#dc2626" },
  dangerWarning: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  // Picker modals
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: "#ffffff", borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#d1d5db",
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 24,
    minHeight: 56,
  },
  pickerOptionText: { fontSize: 16, fontWeight: "500", color: "#111827" },
  pickerOptionSelected: { color: "#eb7825", fontWeight: "600" },
  // Delete confirmation modal
  deleteOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  deleteModalContainer: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
  deleteIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fef2f2",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  deleteIconSuccess: { backgroundColor: "#d1fae5" },
  deleteSpinner: { marginBottom: 16 },
  deleteModalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#111827",
    marginBottom: 12,
    textAlign: "center",
  },
  deleteModalBody: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 22,
  },
  deleteModalSub: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  deleteModalButtons: { flexDirection: "row", gap: 12, width: "100%" },
  deleteModalCancel: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  deleteModalCancelText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  deleteModalConfirm: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  deleteRetryButton: { backgroundColor: "#eb7825" },
  deleteModalConfirmText: { fontSize: 16, fontWeight: "600", color: "white" },
});
