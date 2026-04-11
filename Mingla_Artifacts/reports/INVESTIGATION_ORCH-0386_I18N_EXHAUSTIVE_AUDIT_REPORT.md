# ORCH-0386 — Exhaustive Screen-by-Screen i18n Audit

**Date:** 2026-04-11
**Confidence:** HIGH
**Method:** Read every .tsx file, traced every user-visible string

---

## Summary

**~155 remaining hardcoded English strings across 35+ files.** Previous audits missed these because they're in constant arrays (defined at module scope, can't call t()), Alert.alert calls in callbacks, toast notifications, fallback strings, and hardcoded "en-US" date formatting.

## Root Causes

1. **Constant arrays at module scope** — PreferencesSheet, CardFilterBar, ReportUserModal, ConfidenceScore, PopularityIndicators, CustomPaywallScreen, BillingSheet all define label arrays outside the component where `t()` isn't available
2. **Alert.alert in callbacks** — Board, Session, Scheduling flows have dozens of alerts in event handlers
3. **Toast notifications** — AppHandlers.tsx has ~15 toast messages with English titles/bodies
4. **Fallback strings** — "Experience", "Unknown", "Friend", "Untitled" scattered everywhere
5. **Hardcoded "en-US" locale** — 15+ date/time formatting calls across the app
6. **GettingExperiencesScreen** — Still has ~8 English strings (was Phase 2 scope but never fixed)

## Full File List (see detailed agent report above for exact strings per file)

| Priority | File | Strings | Impact |
|----------|------|---------|--------|
| 1 | PreferencesSheet.tsx | ~30 | Every user sees preferences |
| 2 | CardFilterBar.tsx | ~15 | Saved/Calendar tab filters |
| 3 | ProfileInterestsSection.tsx | ~5 | Profile interests display |
| 4 | BillingSheet.tsx | ~10 | Billing/plan display |
| 5 | CustomPaywallScreen.tsx | ~10 | Paywall features list |
| 6 | PersonHolidayView.tsx | ~12 | Paired person flow |
| 7 | SessionViewModal.tsx | ~18 | Board session view |
| 8 | ManageBoardModal.tsx | ~18 | Board management |
| 9 | BoardSettingsDropdown.tsx | ~15 | Board settings menu |
| 10 | BoardDiscussionTab.tsx | ~5 | Board discussion |
| 11 | CardDiscussionModal.tsx | ~12 | Card discussion |
| 12 | InviteParticipantsModal.tsx | ~8 | Invite flow |
| 13 | BoardDiscussion.tsx | ~10 | Legacy discussion |
| 14 | AppHandlers.tsx | ~15 | Toast notifications |
| 15 | SavedTab.tsx | ~12 | Scheduling alerts |
| 16 | CalendarTab.tsx | ~15 | Calendar details |
| 17 | ActionButtons.tsx | ~8 | Scheduling alerts |
| 18 | OnboardingFlow.tsx (GettingExperiences) | ~8 | Deck ready/error states |
| 19 | ConfidenceScore.tsx | ~6 | Match factors |
| 20 | PopularityIndicators.tsx | ~5 | Stats labels |
| 21 | ReportUserModal.tsx | ~8 | Report reasons |
| 22 | ShuffleButton.tsx | ~5 | Shuffle UI |
| 23 | ExperienceCard.tsx (root) | ~5 | Experience card |
| 24 | CalendarButton.tsx | ~10 | Calendar access |
| 25 | AppStateManager.tsx | ~5 | Profile toasts |
| 26 | PairedPeopleRow.tsx | ~2 | Month names |
| 27 | CollaborationSessions.tsx | ~1 | Placeholder |
| 28 | ShareModal.tsx | ~2 | Fallbacks |
| 29 | ErrorBoundary.tsx | ~3 | Error screen |
| 30 | SwipeableSessionCards.tsx | ~6 | Board cards |
| 31 | BoardMemberManagementModal.tsx | ~4 | Leave board |
| 32 | discussion/*.tsx | ~6 | Discussion UI |
| 33 | MessageInterface.tsx | ~1 | Time format |
| 34 | map/providers/*.tsx | ~3 | Map loading |
| 35 | ProposeDateTimeModal.tsx | ~3 | Time picker |
