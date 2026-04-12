# ORCH-0384 Implementation Report: Dead Code Deletion

**Date:** 2026-04-11
**Status:** Implemented and verified
**Files deleted:** 78
**Lines removed:** ~24,079

---

## Summary

Deleted 78 forensically verified dead code files from `app-mobile/` — components, hooks,
services, utilities, types, and data files with zero importers. Fixed 2 cascading import
references that were missed by the investigation (useLifecycleLogger in app/index.tsx and
enhancedFavoritesService in smartNotificationService.ts).

---

## Files Deleted (78)

### Components (49)
board/BoardHeader.tsx, board/BoardSessionCard.tsx, board/BoardSessionList.tsx,
board/BoardSettingsModal.tsx, board/InviteAcceptScreen.tsx, board/ModeToggleButton.tsx,
BoardCollaboration.tsx, ConnectBottomSheet.tsx, onboarding/IntentSelectionStep.tsx,
onboarding/LocationSetupStep.tsx, onboarding/OnboardingFriendsStep.tsx,
onboarding/TravelModeStep.tsx, map/GoDarkFAB.tsx, map/LayerToggles.tsx,
map/MapFilterBar.tsx, connections/FriendsTab.tsx, connections/MessagesTab.tsx,
connections/PillFilters.tsx, connections/FriendCard.tsx, connections/ConversationCard.tsx,
BlockedUsersModal.tsx, EnhancedBoardModal.tsx, FriendsModal.tsx, UserInviteModal.tsx,
PullToRefresh.tsx, QuickActions.tsx, CreateSessionModal.tsx, CardStackPreview.tsx,
DetailedExperienceCard.tsx, GamifiedHistory.tsx, expandedCard/MatchScoreBox.tsx,
PurchaseQRCode.tsx, SessionChat.tsx, SessionSharing.tsx, SessionSwitcher.tsx,
SimpleAuthGuard.tsx, SuccessAnimation.tsx, ErrorState.tsx, NotificationBar.tsx,
NotificationSystem.tsx, profile/PrivacyControls.tsx, PreferencePresets.tsx,
HeaderControls.tsx, HolidayRow.tsx, LearningToast.tsx, OfflineIndicator.tsx,
SwipeableCardsData.tsx, TrackedPressable.tsx, ImageWithFallback.tsx (root duplicate)

### Hooks (14)
useAiSummary.ts, useBoardSavedCards.ts, useCuratedExperiences.ts,
useCustomDayAiSummary.ts, useDiscoverQuery.ts, useEnhancedProfile.ts,
useGenerateMoreCards.ts, useInAppNotifications.ts, useLifecycleLogger.ts,
useMessagingRealtime.ts, usePersonalizedCards.ts, useRecentActivity.ts,
useSessionStatus.ts, useUserProfile.ts

### Services (8)
abTestingService.ts, enhancedFavoritesService.ts, enhancedPersonalizationService.ts,
experienceFeedbackService.ts, experienceService.ts, realtimeRecommendationService.ts,
recommendationCacheService.ts, translationService.ts

### Other (7)
utils/countryCodes.ts, utils/customDayUtils.ts, utils/usernameUtils.ts,
data/mockConnections.ts, types/personAudio.ts, main.tsx, debug/profile-debug.ts

---

## Cascading Fixes (2 files modified)

### app/index.tsx
- Removed `import { useLifecycleLogger }` (line 81)
- Removed `useLifecycleLogger()` call in AppContent (line 128)
- Lifecycle logging was a no-op debug hook. No functionality lost.

### src/services/smartNotificationService.ts
- Removed `import { enhancedFavoritesService }` (line 9)
- Stubbed `generateFavoriteUpdateNotifications()` to return empty array
- This service is only kept alive by a type import from AccountSettings.tsx

---

## False Positive Preservation Check

All 7 critical live files confirmed present:
- `src/components/figma/ImageWithFallback.tsx` ✅
- `src/components/Toast.tsx` ✅
- `src/hooks/useOnboardingResume.ts` ✅
- `src/hooks/useFriendProfile.ts` ✅
- `src/hooks/useMapCards.ts` ✅
- `src/services/collaborationInviteService.ts` ✅
- `src/services/enhancedProfileService.ts` ✅

---

## Verification

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **0 errors** |
| `expo export --platform ios` | **Build success** |
| `src/components/ui/` count | 9 (unchanged) |
| `src/components/board/` count | 15 (6 deleted) |
| False-positive files | All 7 preserved |

---

## Discoveries for Orchestrator

1. **`useLifecycleLogger` was called in app/index.tsx** — The investigation missed this because it searched for `import` statements but the hook was imported AND called. The import was removed cleanly — lifecycle logging was a debug-only feature with no user impact.

2. **`smartNotificationService.ts` imported `enhancedFavoritesService`** — The investigation noted smartNotificationService was "kept alive by a type import" but didn't flag its dependency on the deleted enhancedFavoritesService. Fixed by stubbing the favorites method. Recommend this service be a future deletion candidate once the NotificationPreferences type is moved to src/types/.
