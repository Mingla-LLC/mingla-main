> Parity note: ported from `.claude/skills/mingla-orchestrator/references/user-journey-map.md` during META-ORCH-0755-B so Codex orchestrator can load Claude’s journey map reference when locating issues.

# User Journey Map — Mingla

Every issue is located against this journey. This ensures bugs are understood
in product terms, not just file terms.

---

## Journey Overview

```
INSTALL → AUTH → ONBOARD → EXPLORE → SAVE → SCHEDULE → INVITE → COLLAB → GO → REVIEW → RETURN
```

---

## Phase 1: Acquisition & Authentication

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 1.1 App Install | — | — | Yes |
| 1.2 Welcome Screen | WelcomeScreen.tsx | useAuthSimple.ts | Yes |
| 1.3 Google Sign-In | WelcomeScreen.tsx | Google OAuth flow | Yes |
| 1.4 Apple Sign-In | WelcomeScreen.tsx | Apple OAuth flow | Yes |
| 1.5 Session Created | — | Supabase Auth, profiles trigger | Yes |
| 1.6 Token Persistence | — | Zustand + AsyncStorage | Yes |
| 1.7 Token Refresh | — | useForegroundRefresh.ts | Yes |
| 1.8 Sign-Out | — | sign-out cleanup chain | Yes |

## Phase 2: Onboarding (7 steps, 15 substeps)

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 2.1 Name Entry | WelcomeStep.tsx | OnboardingFlow.tsx | Yes |
| 2.2 Phone Input | PhoneStep.tsx | send-otp edge function | Yes |
| 2.3 OTP Verify | OTPStep.tsx | verify-otp edge function | Yes |
| 2.4 Gender Select | GenderStep.tsx | OnboardingFlow.tsx | Yes |
| 2.5 Details (country/birthday/language) | DetailsStep.tsx | OnboardingFlow.tsx | Yes |
| 2.6 Value Prop | ValuePropStep.tsx | — | No (view only) |
| 2.7 Intent Selection | IntentSelectionStep.tsx | — | Yes |
| 2.8 Location Permission | LocationStep.tsx | GPS + reverse geocode | Yes |
| 2.9 Category Selection | PreferencesStep categories | max 3 | Yes |
| 2.10 Budget Selection | PreferencesStep budget | min 1 | Yes |
| 2.11 Transport Mode | TravelModeStep.tsx | — | Yes |
| 2.12 Travel Time | TravelTimeStep.tsx | — | Yes |
| 2.13 Friends & Pairing | OnboardingFriendsAndPairingStep.tsx | — | No (skippable) |
| 2.14 Consent | OnboardingConsentStep.tsx | — | Yes |
| 2.15 Deck Generation | — | has_completed_onboarding, trial start | Yes |

## Phase 3: Core Discovery Loop

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 3.1 Home Tab (Deck) | HomePage.tsx | SwipeableCards.tsx, useDeckCards.ts | Yes |
| 3.2 View Card | ExpandedCardModal.tsx | — | Yes |
| 3.3 Swipe Right (Save) | — | saveService.ts, saves table | Yes |
| 3.4 Swipe Left (Pass) | — | user_interactions table | Yes |
| 3.5 Batch Loading | — | deckService.ts, discover-cards | Yes |
| 3.6 Exhaustion State | — | "No more cards" + refresh | Yes |
| 3.7 Preference Change | PreferencesSheet.tsx | prefsHash, batchSeed | Yes |

## Phase 4: Map Discovery

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 4.1 Discover Tab | DiscoverScreen.tsx | DiscoverMap.tsx | Medium |
| 4.2 Place Pins | PlacePin.tsx | useMapCards.ts | Medium |
| 4.3 People Pins | PersonPin.tsx | useNearbyPeople.ts | Low |
| 4.4 Bottom Sheet Tap | MapBottomSheet.tsx | — | Medium |
| 4.5 Privacy / Go Dark | GoDarkFAB.tsx | MapPrivacySettings.tsx | Low |

## Phase 5: Save & Organize

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 5.1 Saved Tab | LikesPage.tsx | useSavedCards.ts | Yes |
| 5.2 Board Create | — | boardService.ts | Medium |
| 5.3 Board Share | — | boardInviteService.ts | Medium |
| 5.4 Board RSVP | — | — | Low |

## Phase 6: Schedule & Plan

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 6.1 Schedule from Card | CalendarButton.tsx | calendarService.ts | Yes |
| 6.2 Calendar Tab | CalendarTab.tsx | useCalendarEntries.ts | Yes |
| 6.3 Device Calendar Sync | — | deviceCalendarService.ts | Medium |
| 6.4 Date Proposal | ProposeDateTimeModal.tsx | — | Low |

## Phase 7: Social & Collaborate

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 7.1 Friend Request | AddFriendView.tsx | search-users edge function | Medium |
| 7.2 Accept Friend | — | friend_requests table | Medium |
| 7.3 Pair Request | PairRequestModal.tsx | send-pair-request | Medium |
| 7.4 DM Conversation | ChatScreen.tsx | messagingService.ts | Medium |
| 7.5 Create Session | — | collaboration service | Yes |
| 7.6 Session Voting | — | useSessionVoting.ts | Medium |
| 7.7 Session Results | — | — | Medium |

## Phase 8: Go & Experience

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 8.1 Calendar Reminder | — | calendar-reminder cron | Medium |
| 8.2 Navigate to Place | — | Maps deep link | Low |
| 8.3 Record Visit | — | record-visit edge function | Medium |

## Phase 9: Post-Experience

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 9.1 Post-Experience Modal | PostExperienceModal.tsx | usePostExperienceCheck.ts | Medium |
| 9.2 Voice Review | — | voiceReviewService.ts | Low |
| 9.3 Feedback | — | experienceFeedbackService.ts | Low |

## Phase 10: Retention & Growth

| Step | Screen | Key Files | Critical Flow? |
|------|--------|-----------|---------------|
| 10.1 Push Notification | — | OneSignal, notify-dispatch | Medium |
| 10.2 Holiday Reminder | — | holiday-reminder cron | Low |
| 10.3 Re-engagement | — | notify-lifecycle | Low |
| 10.4 Subscription Upgrade | PaywallScreen.tsx | RevenueCat | Yes |
| 10.5 Referral | — | process-referral | Low |

---

## How to Use This Map

When registering an issue, locate it on this journey:
- **Which phase?** (1-10)
- **Which step?** (e.g., 3.2)
- **Critical flow?** (Yes = auto-escalate severity)
- **What does the user experience at this point?** (context for plain-English explanation)
