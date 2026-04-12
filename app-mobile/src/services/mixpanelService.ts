import { Mixpanel } from "mixpanel-react-native";
import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

  /**
   * Register super properties that attach to every subsequent event.
   * Call after login and when relevant state changes (tier, city, mode).
   */
  registerSuperProperties(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.registerSuperProperties(properties);
  }

  /**
   * Start a timer for an event. When track() is later called with
   * the same event name, a $duration property is automatically added.
   */
  timeEvent(eventName: string): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.timeEvent(eventName);
  }

  /**
   * Increment a numeric user profile property (e.g., total_saves += 1).
   */
  incrementUserProperty(property: string, by: number = 1): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.getPeople().increment(property, by);
  }

  /**
   * Set user profile properties only if they don't already exist.
   * Used for first-time milestone dates (first_save_at, first_friend_at, etc.).
   */
  setUserPropertyOnce(properties: Record<string, unknown>): void {
    if (!this.initialized || !this.mixpanel) return;
    this.mixpanel.getPeople().setOnce(properties);
  }

  /**
   * Fire a milestone event ONCE per user lifetime. Uses AsyncStorage to persist
   * the "already fired" flag across sessions. Fire-and-forget — never blocks UI.
   */
  private checkAndFireMilestone(key: string, eventName: string, property: string): void {
    AsyncStorage.getItem(`mp_milestone_${key}`)
      .then((fired) => {
        if (fired) return;
        this.track(eventName);
        this.setUserPropertyOnce({ [property]: new Date().toISOString() });
        AsyncStorage.setItem(`mp_milestone_${key}`, "1").catch(() => {});
      })
      .catch(() => {}); // Silently skip — milestone tracking is non-critical
  }

  // ─── Convenience helpers ────────────────────────────────────────────

  /**
   * Track a successful login event, identify the user, set profile properties,
   * and register super properties for all subsequent events.
   */
  trackLogin(user: {
    id: string;
    email?: string;
    provider?: string;
    displayName?: string;
    country?: string;
    city?: string;
    tier?: string;
    trialActive?: boolean;
    trialEndDate?: string | null;
    friendsCount?: number;
    isPaired?: boolean;
    onboardingCompleted?: boolean;
  }): void {
    this.identify(user.id);

    const platform = Platform.OS;
    const appVersion = Constants.expoConfig?.version ?? "unknown";

    // Identity properties
    this.setUserProperties({
      $email: user.email,
      $name: user.displayName,
      user_id: user.id,
      login_provider: user.provider ?? "email",
      platform,
      app_version: appVersion,
      last_login: new Date().toISOString(),
    });

    // Set $created only on first login (never overwritten)
    this.setUserPropertyOnce({
      $created: new Date().toISOString(),
    });

    // Lifecycle properties
    this.setUserProperties({
      subscription_tier: user.tier ?? "free",
      trial_active: user.trialActive ?? false,
      trial_end_date: user.trialEndDate ?? null,
      onboarding_completed: user.onboardingCompleted ?? false,
      country: user.country ?? "",
      city: user.city ?? "",
    });

    // Social properties
    this.setUserProperties({
      friends_count: user.friendsCount ?? 0,
      is_paired: user.isPaired ?? false,
    });

    // Super properties — attach to every future event
    this.registerSuperProperties({
      subscription_tier: user.tier ?? "free",
      city: user.city ?? "",
      platform,
      app_version: appVersion,
      session_mode: "solo",
      is_paired: user.isPaired ?? false,
      trial_active: user.trialActive ?? false,
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
    1: "Account Setup",        // language, welcome, phone, otp, gender, details
    2: "Intent Selection",     // value_prop, intents
    3: "Location",             // location
    4: "Preferences",          // celebration, categories, budget, transport, travel_time
    5: "Friends & Pairing",    // friends_and_pairing
    6: "Collaborations",       // collaborations
    7: "Consent & Finish",     // consent, getting_experiences
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
    this.incrementUserProperty("sessions_count");
    this.checkAndFireMilestone("first_session", "First Session Created", "first_session_at");
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
  }): void {
    this.track("Friend Request Accepted", {
      request_id: props.requestId,
      sender_name: props.senderName,
    });
    this.incrementUserProperty("friends_count");
    this.checkAndFireMilestone("first_friend", "First Friend Added", "first_friend_at");
  }

  /**
   * Track when an incoming friend request is declined.
   */
  trackFriendRequestDeclined(props: {
    requestId: string;
    senderName: string;
  }): void {
    this.track("Friend Request Declined", {
      request_id: props.requestId,
      sender_name: props.senderName,
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
    this.incrementUserProperty("total_scheduled");
    this.checkAndFireMilestone("first_schedule", "First Experience Scheduled", "first_schedule_at");
  }

  /**
   * Track when a user reviews a place after visiting.
   */
  trackPlaceReviewed(props: {
    card_id: string;
    place_name: string;
    category?: string;
    rating: number;
  }): void {
    this.track("Place Reviewed", props);
    this.incrementUserProperty("total_reviews");
    this.checkAndFireMilestone("first_review", "First Place Reviewed", "first_review_at");
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
    this.checkAndFireMilestone("first_expand", "First Card Expanded", "first_expand_at");
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
    this.checkAndFireMilestone("first_share", "First Share", "first_share_at");
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

  // ─── App lifecycle helpers ───────────────────────────────────────────

  trackAppOpened(props: { source: "cold" | "warm" | "push"; secondsSinceLastOpen?: number }): void {
    this.timeEvent("Session Ended");
    this.track("App Opened", props);
  }

  trackSessionEnded(): void {
    this.track("Session Ended");
  }

  trackSignupCompleted(props: { method: string; country?: string }): void {
    this.track("Signup Completed", props);
    this.timeEvent("Onboarding Completed");
  }

  // ─── Card lifecycle helpers ──────────────────────────────────────────

  trackCardViewed(props: {
    card_id: string;
    card_title: string;
    category: string;
    position_in_deck: number;
    is_curated: boolean;
  }): void {
    this.timeEvent("Card Saved");
    this.timeEvent("Card Dismissed");
    this.track("Card Viewed", props);
  }

  trackCardSaved(props: {
    card_id: string;
    card_title: string;
    category: string;
    is_curated: boolean;
    position_in_deck?: number;
    source?: string;
  }): void {
    this.track("Card Saved", props);
    this.incrementUserProperty("total_saves");
    this.timeEvent("Experience Scheduled");
    this.checkAndFireMilestone("first_save", "First Card Saved", "first_save_at");
  }

  trackCardDismissed(props: {
    card_id: string;
    card_title: string;
    category: string;
    is_curated: boolean;
    position_in_deck?: number;
  }): void {
    this.track("Card Dismissed", props);
  }

  trackDeckExhausted(props: {
    cards_seen: number;
    cards_saved: number;
    cards_dismissed: number;
    session_mode: string;
  }): void {
    this.track("Deck Exhausted", props);
  }

  // ─── Revenue helpers ─────────────────────────────────────────────────

  trackPaywallViewed(props: { trigger: string; gated_feature?: string }): void {
    this.timeEvent("Paywall Dismissed");
    this.track("Paywall Viewed", props);
  }

  trackPaywallDismissed(props: { trigger: string }): void {
    this.track("Paywall Dismissed", props);
  }

  trackFeatureGateHit(props: { feature: string; current_tier: string }): void {
    this.track("Feature Gate Hit", props);
  }

  trackTrialStarted(props: { trial_duration_days: number }): void {
    this.track("Trial Started", props);
  }

  trackTrialExpired(props: { trial_days: number }): void {
    this.track("Trial Expired", props);
  }

  trackSubscriptionPurchased(props: {
    plan: string;
    tier: string;
    revenue: number;
    currency: string;
    is_trial_conversion?: boolean;
  }): void {
    this.track("Subscription Purchased", props);
    this.setUserProperties({ subscription_tier: props.tier });
    this.registerSuperProperties({ subscription_tier: props.tier, trial_active: false });
  }

  // ─── Pairing helpers ─────────────────────────────────────────────────

  trackPairRequestSent(props: { target_name?: string }): void {
    this.track("Pair Request Sent", props);
  }

  trackPairRequestAccepted(props: { sender_name?: string }): void {
    this.track("Pair Request Accepted", props);
    this.checkAndFireMilestone("first_pair", "First Pair Formed", "first_pair_at");
  }

  // ─── Coach mark helpers ──────────────────────────────────────────────

  trackCoachMarkViewed(props: { step_id: string; step_title: string; tab: string; target_id?: string }): void {
    this.track("Coach Mark Viewed", props);
  }

  trackCoachMarkCompleted(props: { step_id: string; step_title: string; tab: string }): void {
    this.track("Coach Mark Completed", props);
  }

  trackCoachMarkSkipped(props: { last_step_seen: string; steps_completed: number; steps_remaining: number }): void {
    this.track("Coach Mark Skipped", props);
  }

  trackCoachTourCompleted(): void {
    this.track("Coach Tour Completed");
    this.setUserProperties({ coach_tour_completed: true, coach_tour_completed_at: new Date().toISOString() });
  }

  // ─── P1 social + engagement helpers ──────────────────────────────────

  trackCollaborationSessionJoined(props: { session_id: string; session_name: string; inviter_name?: string }): void {
    this.track("Collaboration Session Joined", props);
    this.incrementUserProperty("total_sessions_participated");
  }

  trackBoardCardVoted(props: { session_id: string; card_id: string; vote: "up" | "down" }): void {
    this.track("Board Card Voted", props);
  }

  trackPairRequestDeclined(props: { sender_name?: string }): void {
    this.track("Pair Request Declined", props);
  }

  trackReferralLinkShared(props: { method: string }): void {
    this.track("Referral Link Shared", props);
  }

  trackExperienceUnsaved(props: { card_id: string; card_title: string; category: string }): void {
    this.track("Experience Unsaved", props);
  }

  trackExperienceVisited(props: { card_id: string; card_title: string; category: string }): void {
    this.track("Experience Visited", props);
    this.checkAndFireMilestone("first_visit", "First Visit", "first_visit_at");
  }

}

export const mixpanelService = MixpanelService.getInstance();
