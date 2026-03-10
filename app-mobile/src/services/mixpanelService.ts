import { Mixpanel } from "mixpanel-react-native";

const MIXPANEL_TOKEN = process.env.EXPO_PUBLIC_MIXPANEL_TOKEN;

class MixpanelService {
  private static instance: MixpanelService;
  private mixpanel: Mixpanel | null = null;
  private initialized = false;
  private readonly enabled: boolean;

  private constructor() {
    this.enabled = typeof MIXPANEL_TOKEN === "string" && MIXPANEL_TOKEN.length > 0;
    if (this.enabled) {
      this.mixpanel = new Mixpanel(MIXPANEL_TOKEN!, true);
    } else {
      console.warn(
        "📊 Mixpanel disabled — EXPO_PUBLIC_MIXPANEL_TOKEN is not set. " +
        "All analytics calls will be silent no-ops."
      );
    }
  }

  static getInstance(): MixpanelService {
    if (!MixpanelService.instance) {
      MixpanelService.instance = new MixpanelService();
    }
    return MixpanelService.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !this.enabled || !this.mixpanel) return;
    try {
      await this.mixpanel.init();
      this.initialized = true;
      console.log("📊 Mixpanel initialized successfully");
    } catch (error) {
      console.error("📊 Mixpanel initialization failed:", error);
    }
  }

  /**
   * Identify a user after login so all subsequent events are tied to them.
   */
  identify(userId: string): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.identify(userId);
    console.log("📊 Mixpanel identified user:", userId);
  }

  /**
   * Set user profile properties (shown in Mixpanel People).
   */
  setUserProperties(properties: Record<string, any>): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.getPeople().set(properties);
  }

  /**
   * Track a generic event with optional properties.
   */
  track(eventName: string, properties?: Record<string, any>): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.track(eventName, properties);
  }

  /**
   * Reset Mixpanel state on logout (clears distinct_id / super properties).
   */
  reset(): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.reset();
  }

  // ─── Convenience helpers ────────────────────────────────────────────

  /**
   * Track a successful login event and identify the user.
   */
  trackLogin(user: { id: string; email?: string; provider?: string }): void {
    this.identify(user.id);
    this.setUserProperties({
      $email: user.email,
      login_provider: user.provider ?? "email",
      last_login: new Date().toISOString(),
    });
    this.track("Login", {
      method: user.provider ?? "email",
    });
  }

  /**
   * Track a failed login attempt.
   */
  trackLoginFailed(email: string, reason?: string): void {
    this.track("Login Failed", {
      email,
      reason: reason ?? "unknown",
    });
  }

  /**
   * Track logout.
   */
  trackLogout(): void {
    this.track("Logout");
    this.reset();
  }

  // ─── Onboarding helpers ───────────────────────────────────────────

  private static readonly STEP_NAMES: Record<number, string> = {
    0: "Welcome",
    1: "Account Setup",
    2: "Intent Selection",
    3: "Vibe Selection",
    4: "Location Setup",
    5: "Travel Mode",
    6: "Travel Constraint",
    7: "Budget Range",
    8: "Date & Time Preferences",
    9: "Invite Friends",
    10: "Review & Finish",
  };

  /**
   * Track when a user views an onboarding step.
   */
  trackOnboardingStepViewed(step: number): void {
    this.track("Onboarding Step Viewed", {
      step,
      step_name: MixpanelService.STEP_NAMES[step] ?? `Step ${step}`,
    });
  }

  /**
   * Track when a user completes an onboarding step and moves forward.
   */
  trackOnboardingStepCompleted(
    step: number,
    extras?: Record<string, any>
  ): void {
    this.track("Onboarding Step Completed", {
      step,
      step_name: MixpanelService.STEP_NAMES[step] ?? `Step ${step}`,
      ...extras,
    });
  }

  /**
   * Track when a user navigates back during onboarding.
   */
  trackOnboardingStepBack(fromStep: number): void {
    this.track("Onboarding Step Back", {
      from_step: fromStep,
      from_step_name:
        MixpanelService.STEP_NAMES[fromStep] ?? `Step ${fromStep}`,
    });
  }

  /**
   * Track when a user skips an optional onboarding step.
   */
  trackOnboardingStepSkipped(step: number): void {
    this.track("Onboarding Step Skipped", {
      step,
      step_name: MixpanelService.STEP_NAMES[step] ?? `Step ${step}`,
    });
  }

  /**
   * Track full onboarding completion.
   */
  trackOnboardingCompleted(extras?: Record<string, any>): void {
    this.track("Onboarding Completed", extras);
  }

  // ─── Preferences helpers ──────────────────────────────────────────

  /**
   * Track when a user saves/updates their preferences.
   */
  trackPreferencesUpdated(props: {
    isCollaborationMode: boolean;
    changesCount: number;
    intents?: string[];
    categories?: string[];
    budgetMin?: number;
    budgetMax?: number;
    travelMode?: string;
    constraintType?: string;
    constraintValue?: number;
    dateOption?: string | null;
    timeSlot?: string | null;
    location?: string;
  }): void {
    this.track("Preferences Updated", {
      is_collaboration_mode: props.isCollaborationMode,
      changes_count: props.changesCount,
      intents: props.intents,
      intents_count: props.intents?.length ?? 0,
      categories: props.categories,
      categories_count: props.categories?.length ?? 0,
      budget_min: props.budgetMin,
      budget_max: props.budgetMax,
      travel_mode: props.travelMode,
      constraint_type: props.constraintType,
      constraint_value: props.constraintValue,
      date_option: props.dateOption,
      time_slot: props.timeSlot,
      location: props.location,
    });
  }

  /**
   * Track when a user resets preferences to defaults.
   */
  trackPreferencesReset(isCollaborationMode: boolean): void {
    this.track("Preferences Reset", { is_collaboration_mode: isCollaborationMode });
  }

  // ─── Collaboration helpers ────────────────────────────────────────

  /**
   * Track when a new collaboration session is created.
   */
  trackCollaborationSessionCreated(props: {
    sessionName: string;
    invitedFriendsCount: number;
  }): void {
    this.track("Collaboration Session Created", {
      session_name: props.sessionName,
      invited_friends_count: props.invitedFriendsCount,
    });
  }

  /**
   * Track when invites are sent to a collaboration session.
   */
  trackCollaborationInvitesSent(props: {
    sessionId: string;
    sessionName: string;
    invitedCount: number;
    successCount: number;
  }): void {
    this.track("Collaboration Invites Sent", {
      session_id: props.sessionId,
      session_name: props.sessionName,
      invited_count: props.invitedCount,
      success_count: props.successCount,
    });
  }

  // ─── Screen view helpers ──────────────────────────────────────────

  private static readonly SCREEN_NAMES: Record<string, string> = {
    home: "Home",
    discover: "Discover",
    connections: "Connections",
    likes: "Likes",
    saved: "Saved",
    profile: "Profile",
    activity: "Activity",
    "board-view": "Board View",
  };

  /**
   * Track when a user views a main screen.
   */
  trackScreenViewed(screenKey: string): void {
    const screenName =
      MixpanelService.SCREEN_NAMES[screenKey] ?? screenKey;
    this.track("Screen Viewed", {
      screen: screenName,
      screen_key: screenKey,
    });
  }

  // ─── Discover helpers ─────────────────────────────────────────────

  /**
   * Track when a person is added in Discover.
   */
  trackDiscoverPersonAdded(props: {
    personName: string;
    hasBirthday: boolean;
    gender: string | null;
  }): void {
    this.track("Discover Person Added", {
      person_name: props.personName,
      has_birthday: props.hasBirthday,
      gender: props.gender,
    });
  }

  /**
   * Track when a custom holiday is added in Discover.
   */
  trackDiscoverCustomHolidayAdded(props: {
    holidayName: string;
    date: string;
    categories: string[];
    personId: string;
  }): void {
    this.track("Discover Custom Holiday Added", {
      holiday_name: props.holidayName,
      date: props.date,
      categories: props.categories,
      categories_count: props.categories.length,
      person_id: props.personId,
    });
  }

  // ─── Friends / connections helpers ─────────────────────────────────

  /**
   * Track when a friend request is sent.
   */
  trackFriendRequestSent(props: {
    recipientUsername: string;
  }): void {
    this.track("Friend Request Sent", {
      recipient_username: props.recipientUsername,
    });
  }

  /**
   * Track when an incoming friend request is accepted.
   */
  trackFriendRequestAccepted(props: {
    requestId: string;
    senderName: string;
    senderUsername: string;
  }): void {
    this.track("Friend Request Accepted", {
      request_id: props.requestId,
      sender_name: props.senderName,
      sender_username: props.senderUsername,
    });
  }

  /**
   * Track when an incoming friend request is declined.
   */
  trackFriendRequestDeclined(props: {
    requestId: string;
    senderName: string;
    senderUsername: string;
  }): void {
    this.track("Friend Request Declined", {
      request_id: props.requestId,
      sender_name: props.senderName,
      sender_username: props.senderUsername,
    });
  }

  /**
   * Track when a friend is removed.
   */
  trackFriendRemoved(props: {
    friendName: string;
    friendUsername?: string;
  }): void {
    this.track("Friend Removed", {
      friend_name: props.friendName,
      friend_username: props.friendUsername,
    });
  }

  /**
   * Track when a user is blocked.
   */
  trackFriendBlocked(props: {
    blockedUserName: string;
    blockedUserUsername?: string;
    reason?: string;
  }): void {
    this.track("Friend Blocked", {
      blocked_user_name: props.blockedUserName,
      blocked_user_username: props.blockedUserUsername,
      reason: props.reason,
    });
  }

  // ─── Experience scheduling helpers ────────────────────────────────

  /**
   * Track when an experience is scheduled from saved cards.
   */
  trackExperienceScheduled(props: {
    cardId: string;
    cardTitle: string;
    category: string;
    source: "solo" | "collaboration";
    scheduledDate: string;
  }): void {
    this.track("Experience Scheduled", {
      card_id: props.cardId,
      card_title: props.cardTitle,
      category: props.category,
      source: props.source,
      scheduled_date: props.scheduledDate,
    });
  }

  /**
   * Track when a calendar experience is rescheduled.
   */
  trackExperienceRescheduled(props: {
    entryId: string;
    entryTitle: string;
    category: string;
    newScheduledDate: string;
    dateOption: "now" | "today" | "weekend" | "custom";
  }): void {
    this.track("Experience Rescheduled", {
      entry_id: props.entryId,
      entry_title: props.entryTitle,
      category: props.category,
      new_scheduled_date: props.newScheduledDate,
      date_option: props.dateOption,
    });
  }

  // ─── Profile & settings helpers ───────────────────────────────────

  /**
   * Track when a user uploads or updates their profile picture.
   */
  trackProfilePictureUpdated(action: "uploaded" | "removed"): void {
    this.track("Profile Picture Updated", { action });
  }

  /**
   * Track when a user updates a profile setting (name, username, email).
   */
  trackProfileSettingUpdated(props: {
    field: string;
  }): void {
    this.track("Profile Setting Updated", {
      field: props.field,
    });
  }

  /**
   * Track when a user updates an account setting (currency, measurement).
   */
  trackAccountSettingUpdated(props: {
    setting: string;
    value: string;
  }): void {
    this.track("Account Setting Updated", {
      setting: props.setting,
      value: props.value,
    });
  }

  // ─── Card interaction helpers ─────────────────────────────────

  /**
   * Track when a card is expanded to view full details.
   */
  trackCardExpanded(props: {
    cardId: string;
    cardTitle: string;
    category: string;
    source: "home" | "saved" | "calendar";
  }): void {
    this.track("Card Expanded", {
      card_id: props.cardId,
      card_title: props.cardTitle,
      category: props.category,
      source: props.source,
    });
  }

  // ─── Tab view helpers ─────────────────────────────────────────────

  /**
   * Track when a user opens a tab within a screen.
   */
  trackTabViewed(props: {
    screen: string;
    tab: string;
  }): void {
    this.track("Tab Viewed", {
      screen: props.screen,
      tab: props.tab,
    });
  }

  // ─── Share helpers ────────────────────────────────────────────────

  /**
   * Track when a user shares an experience via social media, copy link, or copy message.
   */
  trackExperienceShared(props: {
    experienceTitle: string;
    method: string;
  }): void {
    this.track("Experience Shared", {
      experience_title: props.experienceTitle,
      method: props.method,
    });
  }

  // ─── Session switch helpers ───────────────────────────────────────

  /**
   * Track when a user switches between solo mode and collaboration sessions.
   */
  trackSessionSwitched(props: {
    mode: "solo" | "session";
    sessionName?: string;
  }): void {
    this.track("Session Switched", {
      mode: props.mode,
      session_name: props.sessionName,
    });
  }

}

export const mixpanelService = MixpanelService.getInstance();
