# SPEC — ORCH-0435: Friends Page Reorganization

**Status:** Ready for Implementation
**Scope:** Pure UI reorganization — no backend, no new features, no flow changes
**Affected surfaces:** Mobile only (app-mobile)

---

## Summary

Consolidate the social experience onto one tab. Rename "Connections" → "Friends". Strip
pairing content from Discover (For You and Night Out tabs stay). Move the paired-person
view (birthday hero, holidays, cards) into individual friend profiles. Add inline pair
buttons (star icon) to friend and chat rows. Show paired friends as floating pills above
the chat search bar.

---

## Scope & Non-Goals

**In scope:**
- Tab rename (Connections → Friends) + icon change
- Discover tab: strip pairing content only (For You + Night Out tabs stay)
- PairedPeopleRow moves to Friends page with "+" button
- ViewFriendProfileScreen redesign (pill chips + conditional PersonHolidayView)
- Star pair button on ChatListItem and FriendsManagementList rows
- IncomingPairRequestCard relocation
- Notification deep-link target updates

**Non-goals:**
- No pairing logic changes (service, hooks, edge functions, DB unchanged)
- No chat/messaging logic changes
- No new Supabase migrations, RLS, or edge functions
- No changes to PersonHolidayView internal logic
- No changes to PairRequestModal internal logic
- No admin dashboard changes

---

## R1 — Tab Rename

### File: `app-mobile/app/index.tsx`

**Change 1 — Tab bar label (line ~2375):**
```
Before: {t('navigation:tabs.chats')}
After:  {t('navigation:tabs.friends')}
```

**Change 2 — Tab bar icon (line ~2349):**
```
Before: name="chatbubbles-outline"
After:  name="people-outline"
```

**Change 3 — Add i18n key:**
Add `friends` key to `navigation:tabs` in all locale files. Value: `"Friends"`.

**Change 4 — Notification navigation targets (lines 557-564):**
These page references use `"connections"` and `"discover"` strings that match `currentPage`.
The `currentPage` state value stays `"connections"` internally (renaming the state value
would cascade through hundreds of references). Only the DISPLAY label changes.

However, pair-related notifications currently navigate to `"discover"`:
```typescript
pair_request_received: "discover",    // → change to "connections"
pair_request_accepted: "discover",    // → change to "connections"
paired_user_saved_card: "discover",   // → change to "connections"
paired_user_visited: "discover",      // → change to "connections"
holiday_reminder: "discover",         // → change to "connections"
```
These must redirect to the Friends tab since paired content now lives there.

---

## R2 — Strip Pairing Content from Discover

### File: `app-mobile/src/components/DiscoverScreen.tsx`

**CORRECTED SCOPE:** For You tab and Night Out tab STAY. Only pairing-specific content
is removed. DiscoverScreen keeps all card generation, experience rendering, tabs, map,
and everything else that isn't about paired people.

**DiscoverScreenProps — changes:**
```typescript
// REMOVE these props (no longer needed without pairing on Discover):
// onAddFriend — was used by pair request flow
// onUpgradePress — was used by pairing paywall gate

// KEEP all other props unchanged:
// isTabVisible, onOpenChatWithUser, onViewFriendProfile,
// accountPreferences, preferencesRefreshKey, deepLinkParams, onDeepLinkHandled
```

**What gets REMOVED from DiscoverScreen:**

1. **Pairing imports:**
   - `usePairingPills`, `useIncomingPairRequests`, `useSendPairRequest`,
     `useCancelPairRequest`, `useCancelPairInvite`, `useUnpair`, `pairingKeys`
   - `PairingPill`, `PairRequest` types
   - `PairRequestModal`, `PairingInfoCard`, `IncomingPairRequestCard`
   - `PairedPeopleRow`
   - `useFeatureGate`, `CustomPaywallScreen` (pairing paywall gate)

2. **PersonHolidayView and custom holidays:**
   - `PersonHolidayView` import and all rendering
   - `CustomHolidayModal` import and all rendering
   - `getSharedCustomHolidaysByPairing`, `createCustomHolidayForPairing`,
     `deleteCustomHolidayFromDb` imports
   - `CUSTOM_HOLIDAYS_STORAGE_KEY`, `HOLIDAY_ARCHIVE_STORAGE_KEY` constants
   - All custom holiday state: `customHolidays`, `archivedHolidayKeysByPerson`,
     `expandedHolidayIds`, `isAddCustomDayModalVisible`
   - All custom holiday handlers: `saveCustomHolidaysToStorage`,
     `handleConfirmDeleteCustomHoliday`, etc.

3. **Pairing pill selection state:**
   - `selectedPillId` state and all logic that switches between "for-you" view
     and person-specific view based on pill selection
   - The entire "person selected" branch in the render (the `else` branch that
     shows PersonHolidayView when a paired person pill is tapped)

4. **Pairing-related modals:**
   - `PairRequestModal` rendering and `showPairModal` state
   - `IncomingPairRequestCard` rendering and related state
   - `PairingInfoCard` rendering and related state

5. **Pairing coach marks:**
   - Coach mark step 7 (`useCoachMark(7, 0)`) — if it pointed to pairing pills

6. **Helper functions only used by pairing/holidays:**
   - `getNextOccurrence` (used by custom holidays)
   - `getDaysInMonth`, `MONTH_NAMES` (used by custom holiday picker)

**What STAYS (everything else):**
- `DiscoverTabs` component (For You / Night Out tabs)
- For You tab: featured card, hero cards, grid cards, all card generation
- Night Out tab: filter UI, venue cards
- `DiscoverMap` component and all map logic
- `ExpandedCardModal` and card expansion handlers
- All experience generation services and caching
- `DISCOVER_CACHE_KEY`, `NIGHT_OUT_CACHE_KEY` and all card cache logic
- `categoryIcons` mapping
- `CARD_WIDTH`, `GRID_CARD_WIDTH`, `HERO_CARD_WIDTH` constants
- All card rendering components
- Coach mark step 9 (map coach mark)
- `useSavedCards`, `useCalendarEntries`, `useRecommendations`
- `accountPreferences`, `preferencesRefreshKey`
- Deep link handling (for non-pairing deep links)

**Render structure change:**
The For You tab currently has two branches:
1. `selectedPillId === "for-you"` → shows cards (featured + hero + grid)
2. `selectedPillId !== "for-you"` → shows PersonHolidayView for selected person

After this change: **only branch 1 exists.** The pill selector is gone, so For You
content always renders. No conditional branching needed.

**Estimated line reduction:** ~800-1200 lines removed (pairing state, handlers, modals,
PersonHolidayView rendering, custom holidays). DiscoverScreen goes from ~5,925 to ~4,700-5,100.

---

## R3 — Paired Pills on Friends Page

### File: `app-mobile/src/components/ConnectionsPage.tsx`

**New imports to add:**
```typescript
import PairedPeopleRow from "./PairedPeopleRow";
import PairRequestModal from "./PairRequestModal";
import IncomingPairRequestCard from "./IncomingPairRequestCard";
import { usePairingPills, useIncomingPairRequests, useSendPairRequest } from "../hooks/usePairings";
import type { PairingPill, PairRequest } from "../services/pairingService";
import { useFeatureGate } from '../hooks/useFeatureGate';
```

**New hooks in component body:**
```typescript
const { data: pairingPills = [] } = usePairingPills(user?.id);
const { data: incomingPairRequests = [] } = useIncomingPairRequests(user?.id);

// Filter to only actively paired people (not pending)
const activePairedPeople = useMemo(() =>
  pairingPills.filter(p => p.pillState === 'active'),
  [pairingPills]
);
```

**New props for ConnectionsPage:**
```typescript
// Add to ConnectionsPageProps:
onViewFriendProfile?: (userId: string) => void;  // already exists as onNavigateToFriendProfile
```
No new props needed — `onNavigateToFriendProfile` already exists.

**Render structure change:**
Insert BEFORE the search bar and chat list, AFTER the top header:

```
{/* Paired friends pills — floating above search */}
{activePairedPeople.length > 0 && (
  <PairedPillsBar
    people={activePairedPeople}
    onSelectPerson={(person) => onNavigateToFriendProfile?.(person.pairedUserId)}
    onAddPress={() => setShowPairRequestModal(true)}
  />
)}

{/* Incoming pair request banner (R6 recommendation) */}
{incomingPairRequests.length > 0 && (
  <IncomingPairRequestBanner ... />
)}

{/* Search bar — existing */}
{/* Chat list — existing */}
```

### PairedPillsBar — New internal component (inside ConnectionsPage or extracted)

This is a RESTYLED version of PairedPeopleRow optimized for the Friends page context.
Rather than modifying PairedPeopleRow.tsx (which has card-style rendering), create a
simpler inline component:

**Design:**
- Horizontal scroll of circular avatar pills (NO cards — just avatars)
- Each pill: `s(44)` avatar circle with `2px` green border (paired = green, not orange)
- Name below avatar: first name, `s(11)`, truncated
- Green star badge overlay on bottom-right of avatar
- "+" button at the END of the scroll: same `s(44)` circle, dashed border, `+` icon
- Background: subtle surface color or transparent
- Compact: max height ~`s(72)` including name

**"+" button behavior:**
- Opens `PairRequestModal` (existing component, no changes)
- PairRequestModal already accepts friends list and handles sending

**Pill tap behavior:**
- Calls `onNavigateToFriendProfile(person.pairedUserId)`
- This triggers the existing full-screen ViewFriendProfileScreen overlay in index.tsx

**Empty state (0 paired friends):**
- Hide the entire pills bar. Don't show empty row.
- The "+" for pairing is still accessible via the star buttons on friend/chat rows.

**State to add to ConnectionsPage:**
```typescript
const [showPairRequestModal, setShowPairRequestModal] = useState(false);
```

**PairRequestModal rendering (add at bottom of ConnectionsPage, with other modals):**
```
<PairRequestModal
  visible={showPairRequestModal}
  onClose={() => setShowPairRequestModal(false)}
  friends={friends}  // from useFriends()
  // ... other required props (check PairRequestModal's interface)
/>
```

---

## R4 — Enriched Friend Profile

### File: `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`

**New imports:**
```typescript
import PersonHolidayView from '../PersonHolidayView';
import ExpandedCardModal from '../ExpandedCardModal';
import { usePairingPills } from '../../hooks/usePairings';
import { useUserLocation } from '../../hooks/useUserLocation';
import { useAppStore } from '../../store/appStore';
import type { PairingPill } from '../../services/pairingService';
```

**New props:**
```typescript
interface ViewFriendProfileScreenProps {
  userId: string;
  onBack: () => void;
  onMessage?: (userId: string) => void;
  // No new props needed — pairing detection is internal via hooks
}
```

**Pairing detection (in component body):**
```typescript
const currentUserId = useAppStore((s) => s.user?.id);
const { data: pairingPills = [] } = usePairingPills(currentUserId);

// Find if this friend is paired with current user
const pairedPill = useMemo(() =>
  pairingPills.find(p => p.pairedUserId === userId && p.pillState === 'active'),
  [pairingPills, userId]
);
const isPaired = !!pairedPill;
```

This reuses the existing `usePairingPills` query (already cached, 2-min staleTime).
No new DB query needed.

**Profile info redesign — replace card/InfoRow with pill chips:**

Remove the current `<View style={styles.card}>` section (About card with InfoRow components).
Replace with a horizontal wrapping chip layout:

```
<View style={styles.chipContainer}>
  {/* City chip */}
  <View style={styles.chip}>
    <Icon name="location-outline" size={s(14)} color="#eb7825" />
    <Text style={styles.chipText}>{locationLine}</Text>
  </View>

  {/* Mingla Level chip */}
  <View style={styles.chip}>
    <Icon name="sparkles-outline" size={s(14)} color="#eb7825" />
    <Text style={styles.chipText}>{levelLine}</Text>
  </View>

  {/* Subscription chip */}
  <View style={[styles.chip, { backgroundColor: tierBadge.bg, borderColor: tierBadge.border }]}>
    <Icon name="diamond-outline" size={s(14)} color={tierBadge.text} />
    <Text style={[styles.chipText, { color: tierBadge.text }]}>{TIER_LABEL[profile.tier]}</Text>
  </View>

  {/* Interest chips */}
  {profile.categories.map(cat => (
    <View key={cat} style={styles.chip}>
      <Icon name={getCategoryChipIcon(cat)} size={s(14)} color="#eb7825" />
      <Text style={styles.chipText}>{cat}</Text>
    </View>
  ))}
</View>
```

**Chip styles:**
```typescript
chipContainer: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: s(8),
  paddingHorizontal: s(20),
  marginTop: vs(16),
},
chip: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: s(6),
  backgroundColor: '#f9fafb',
  borderRadius: s(999),
  paddingHorizontal: s(12),
  paddingVertical: vs(8),
  borderWidth: 1,
  borderColor: '#e5e7eb',
},
chipText: {
  fontSize: s(13),
  fontWeight: '600',
  color: '#374151',
},
```

**Remove:** ProfileStatsRow and ProfileInterestsSection (interests are now chips; stats
row is replaced by the chips). The message button stays.

**Paired-only section (below chips, before message button):**

```typescript
{isPaired && pairedPill && (
  <View style={styles.pairedSection}>
    <PersonHolidayView
      pairedUserId={userId}
      pairingId={pairedPill.pairingId ?? pairedPill.id}
      displayName={name}
      birthday={pairedPill.birthday ?? null}
      gender={pairedPill.gender ?? null}
      location={userLocation ?? { latitude: 0, longitude: 0 }}
      userId={currentUserId!}
      customHolidays={customHolidays}
      onAddCustomDay={() => setShowCustomHolidayModal(true)}
      archivedHolidayIds={archivedHolidayIds}
      onArchiveHoliday={handleArchiveHoliday}
      onUnarchiveHoliday={handleUnarchiveHoliday}
      onCardPress={handleCardPress}
      onSaveCardPress={handleSaveCard}
    />
  </View>
)}
```

**PersonHolidayView props sourcing:**

| Prop | Source |
|------|--------|
| `pairedUserId` | `userId` (the friend being viewed) |
| `pairingId` | `pairedPill.pairingId` or `pairedPill.id` |
| `displayName` | Computed `name` from profile data |
| `birthday` | `pairedPill.birthday` (from PairingPill type) |
| `gender` | `pairedPill.gender` (from PairingPill type) |
| `location` | `useUserLocation()` — current user's GPS (for travel time calc) |
| `userId` | `currentUserId` — the logged-in user |
| `customHolidays` | New state: fetch via `getSharedCustomHolidaysByPairing(pairingId)` |
| `archivedHolidayIds` | New state: load from AsyncStorage per person |
| `onCardPress` | Open ExpandedCardModal (new state in this component) |

**New state in ViewFriendProfileScreen:**
```typescript
const [expandedCard, setExpandedCard] = useState<ExpandedCardData | null>(null);
const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
const [archivedHolidayIds, setArchivedHolidayIds] = useState<string[]>([]);
const [showCustomHolidayModal, setShowCustomHolidayModal] = useState(false);
```

**Custom holidays loading:**
Copy the pattern from DiscoverScreen — `useEffect` that calls
`getSharedCustomHolidaysByPairing(pairingId)` when `isPaired` is true.

**ExpandedCardModal:**
Render at the bottom of the component, same as DiscoverScreen did:
```
<ExpandedCardModal
  visible={!!expandedCard}
  card={expandedCard}
  onClose={() => setExpandedCard(null)}
  ...
/>
```

**PersonHolidayView sub-features that survive:**
- Birthday hero: YES
- Custom holidays: YES (add/delete)
- Standard holidays with cards: YES
- Shuffle button: YES
- Calendar button: YES
- Bilateral toggle: YES
- Saves list: YES
- Visits list: YES
- Archive/unarchive holidays: YES

All features survive. PersonHolidayView is self-contained — it manages its own internal
tabs (Picks/Saves/Visits) and card fetching. The parent just needs to provide the props.

**Scroll behavior:**
Single ScrollView wrapping everything:
1. Hero gradient + avatar + name + bio (existing)
2. Pill chips (city, level, tier, interests)
3. Message button
4. PersonHolidayView (if paired) — this has its own internal ScrollView/FlatList for cards.
   To avoid nested scroll issues, PersonHolidayView should NOT be wrapped in another
   ScrollView. Solution: use `nestedScrollEnabled` or flatten the hierarchy.

**IMPORTANT — Nested scroll warning:**
PersonHolidayView renders card rows in horizontal `FlatList`s and holiday sections in
a vertical layout. Embedding it inside the profile's `ScrollView` will cause:
- Vertical scroll conflict (PersonHolidayView sections inside parent ScrollView)
- Solution: Set the parent ScrollView to `nestedScrollEnabled={true}` and ensure
  PersonHolidayView doesn't use its own vertical ScrollView. PersonHolidayView
  currently renders in a flat View (not ScrollView), so this should work. Verify
  during implementation by reading PersonHolidayView's root render element.

---

## R5 — Star Pair Button

### File: `app-mobile/src/components/connections/FriendsManagementList.tsx`

**New props:**
```typescript
interface FriendsManagementListProps {
  // ... existing props ...
  pairedUserIds: Set<string>;       // Set of user IDs that are actively paired
  pendingPairUserIds: Set<string>;  // Set of user IDs with pending pair requests
  onPairFriend: (friendUserId: string) => void;  // Send pair request
  pairLoadingUserId: string | null; // Currently sending pair request to this user
}
```

**Data flow:** ConnectionsPage computes these from `usePairingPills`:
```typescript
const pairedUserIds = useMemo(() => new Set(
  pairingPills.filter(p => p.pillState === 'active').map(p => p.pairedUserId)
), [pairingPills]);

const pendingPairUserIds = useMemo(() => new Set(
  pairingPills.filter(p => p.pillState !== 'active').map(p => p.pairedUserId)
), [pairingPills]);
```

**Render change — add star button before the three-dot menu:**

For each friend row, between `{/* Name + muted badge */}` and `{/* Three-dot menu */}`:

```typescript
{/* Pair star button */}
{(() => {
  const friendId = getFriendUserId(friend, currentUserId);
  const isPaired = pairedUserIds.has(friendId);
  const isPending = pendingPairUserIds.has(friendId);
  const isLoading = pairLoadingUserId === friendId;

  if (isPaired) {
    // Green star indicator (not tappable)
    return (
      <View style={styles.starIndicator}>
        <Icon name="star" size={18} color="#10b981" />
      </View>
    );
  }

  if (isPending) {
    // Pending state (greyed, not tappable)
    return (
      <View style={styles.starIndicator}>
        <Icon name="star-outline" size={18} color="#d1d5db" />
      </View>
    );
  }

  // Unpaired friend — tappable star sends pair request
  return (
    <TouchableOpacity
      onPress={() => onPairFriend(friendId)}
      disabled={isLoading}
      style={styles.starButton}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color="#eb7825" />
      ) : (
        <Icon name="star-outline" size={18} color="#eb7825" />
      )}
    </TouchableOpacity>
  );
})()}
```

**Star button styles:**
```typescript
starButton: {
  width: 32,
  height: 32,
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 4,
},
starIndicator: {
  width: 32,
  height: 32,
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 4,
},
```

**Non-friend filtering:** The `FriendsManagementList` only renders actual friends
(from `useFriends()` which returns `status === 'accepted'`). However, if someone
unfriends but the cache hasn't refreshed, the person might briefly appear. The star
button naturally won't cause issues — `sendPairRequest` with a non-friend `friendUserId`
will return an error from the edge function, which the `onError` handler in
`useSendPairRequest` already handles.

### File: `app-mobile/src/components/connections/ChatListItem.tsx`

**New props:**
```typescript
interface ChatListItemProps {
  // ... existing props ...
  pairStatus?: 'paired' | 'pending' | 'unpaired' | 'not-friend';
  onPairPress?: (userId: string) => void;
  pairLoading?: boolean;
}
```

**Data flow:** ConnectionsPage computes pair status per conversation participant
and passes it down.

**Render change — add star to the right of the content area, before unread badge:**

In the `topRow`, after the name and before the meta row:

```typescript
{/* Pair star */}
{pairStatus === 'paired' && (
  <Icon name="star" size={16} color="#10b981" style={{ marginRight: 6 }} />
)}
{pairStatus === 'unpaired' && onPairPress && (
  <TouchableOpacity
    onPress={() => {
      if (otherParticipant?.id) onPairPress(otherParticipant.id);
    }}
    disabled={pairLoading}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    style={{ marginRight: 6 }}
  >
    {pairLoading ? (
      <ActivityIndicator size="small" color="#eb7825" />
    ) : (
      <Icon name="star-outline" size={16} color="#eb7825" />
    )}
  </TouchableOpacity>
)}
{pairStatus === 'pending' && (
  <Icon name="star-outline" size={16} color="#d1d5db" style={{ marginRight: 6 }} />
)}
{/* 'not-friend' → no star shown */}
```

**Position:** Star appears between the name and the timestamp/mute-icon area in
the top row. This keeps it visible but non-intrusive.

**Pair status computation in ConnectionsPage:**
```typescript
function getPairStatus(participantId: string): 'paired' | 'pending' | 'unpaired' | 'not-friend' {
  if (pairedUserIds.has(participantId)) return 'paired';
  if (pendingPairUserIds.has(participantId)) return 'pending';
  // Check if participant is a friend
  const isFriend = friends.some(f =>
    getFriendUserId(f, user!.id) === participantId
  );
  return isFriend ? 'unpaired' : 'not-friend';
}
```

**Success feedback:**
- Optimistic: After `sendPairRequest` call, the `useSendPairRequest` hook
  invalidates `pairingKeys.pills`, which causes `usePairingPills` to refetch.
  The star will transition from outline → greyed pending on next render cycle.
- Toast: Use existing `useToast()` to show "Pair request sent!" on success.
- Error: Use `showMutationError()` (already in ConnectionsPage imports) on failure.

---

## R6 — Incoming Pair Request Placement

**Recommendation: Option A — Show on Friends page, above the chat list, below paired pills.**

**Rationale:**
- Incoming pair requests are social actions — they belong on the social tab
- Showing them prominently on the Friends page ensures they're seen
- The existing `IncomingPairRequestCard` is a bottom-sheet modal — it can be triggered
  from a banner/indicator on the Friends page
- Putting it in the friend's profile (Option B) means the user must navigate to that
  specific friend to see it — poor discoverability
- Notification-only (Option C) loses the in-app prompt entirely

**Implementation:**

Add a compact banner between the paired pills and the search bar:

```
{incomingPairRequests.length > 0 && (
  <TouchableOpacity
    style={styles.incomingBanner}
    onPress={() => setShowIncomingRequest(incomingPairRequests[0])}
  >
    <Icon name="star" size={16} color="#eb7825" />
    <Text style={styles.incomingBannerText}>
      {incomingPairRequests[0].senderName} wants to pair with you
    </Text>
    <Icon name="chevron-forward" size={16} color="#9ca3af" />
  </TouchableOpacity>
)}
```

Tapping the banner opens the existing `IncomingPairRequestCard` modal with
accept/decline buttons. The modal component is unchanged.

**New state:**
```typescript
const [showIncomingRequest, setShowIncomingRequest] = useState<PairRequest | null>(null);
```

**Banner styles:**
```typescript
incomingBanner: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  marginHorizontal: 16,
  marginBottom: 8,
  paddingHorizontal: 14,
  paddingVertical: 12,
  backgroundColor: '#fff7ed',
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#fed7aa',
},
incomingBannerText: {
  flex: 1,
  fontSize: 14,
  fontWeight: '600',
  color: '#111827',
},
```

---

## Deep Link Updates

### File: `app-mobile/app/index.tsx`

**Lines 561-564, 597 — Change navigation targets:**
```typescript
pair_request_received: "connections",    // was "discover"
pair_request_accepted: "connections",    // was "discover"
paired_user_saved_card: "connections",   // was "discover"
paired_user_visited: "connections",      // was "discover"
holiday_reminder: "connections",         // was "discover"
```

**Deep link handler (line ~744):**
Check for any `mingla://discover?paired=true` deep link handling. This must be
redirected to `connections` instead. Search for `paired` in the deep link handler
and update the navigation target.

---

## Coach Mark Updates

DiscoverScreen currently uses:
- `useCoachMark(7, 0)` — coach mark for discover content
- `useCoachMark(9, 20)` — coach mark for map

**Action:**
- Step 7 coach mark: Remove (content it pointed to no longer exists on Discover)
- Step 9 coach mark: Keep (map still exists on Discover)
- If paired pill coaching existed, it should move to the Friends page. Check
  `useCoachMark` calls across the app to verify.

---

## Data Flow Diagram

```
index.tsx (root)
├── DiscoverScreen (For You + Night Out + Map — pairing content removed)
│   ├── useUserLocation() → GPS coords
│   ├── useSavedCards() → saved IDs for pins
│   ├── useCalendarEntries() → scheduled IDs for pins
│   ├── useRecommendations() → card data for pins + For You tab
│   ├── ExperienceGenerationService → card generation (unchanged)
│   ├── NightOutExperiencesService → Night Out venues (unchanged)
│   ├── DiscoverTabs → For You | Night Out tab selector (unchanged)
│   ├── ExpandedCardModal → card detail modal (unchanged)
│   └── DiscoverMap → renders map + pins + bottom sheets (unchanged)
│
├── ConnectionsPage (renamed "Friends")
│   ├── useFriends() → friend list (existing)
│   ├── usePairingPills(userId) → paired/pending people (NEW)
│   ├── useIncomingPairRequests(userId) → incoming requests (NEW)
│   ├── useSendPairRequest() → mutation for inline star (NEW)
│   ├── PairedPillsBar → avatar pills for paired friends (NEW)
│   │   └── onSelectPerson → setViewingFriendProfileId (existing mechanism)
│   ├── IncomingPairRequestBanner → incoming request prompt (NEW)
│   │   └── onPress → opens IncomingPairRequestCard modal
│   ├── PairRequestModal → opened by "+" button (MOVED from Discover)
│   ├── IncomingPairRequestCard → accept/decline modal (MOVED from Discover)
│   ├── ChatListItem (+ star button) → chat rows (MODIFIED)
│   └── FriendsManagementList (+ star button) → friend rows (MODIFIED)
│
└── ViewFriendProfileScreen (full-screen overlay)
    ├── useFriendProfile(userId) → profile data (existing)
    ├── usePairingPills(currentUserId) → find if friend is paired (NEW)
    ├── useUserLocation() → GPS for PersonHolidayView travel calc (NEW, if paired)
    ├── Pill chips → city, level, tier, interests (REDESIGNED)
    ├── PersonHolidayView → birthday/holidays/cards (NEW, conditional on paired)
    └── ExpandedCardModal → card detail modal (NEW, for PersonHolidayView cards)
```

---

## Implementation Order

Execute in this sequence to minimize breakage:

### Phase 1 — Tab rename + deep link updates (LOW RISK)
1. Update tab label in index.tsx (line ~2375)
2. Update tab icon in index.tsx (line ~2349)
3. Add i18n key for "Friends"
4. Update NAV_TARGETS for pair-related notifications (lines 561-564, 597)
5. Update deep link handler for `paired=true`

### Phase 2 — Add pairing data to ConnectionsPage (ADDITIVE)
6. Add pairing hook imports to ConnectionsPage
7. Add `usePairingPills`, `useIncomingPairRequests`, `useSendPairRequest` calls
8. Compute `pairedUserIds`, `pendingPairUserIds` memoized sets
9. Add `PairedPillsBar` component (internal or extracted)
10. Add `PairRequestModal` rendering (with state)
11. Add `IncomingPairRequestCard` rendering with banner

### Phase 3 — Star buttons on list items (ADDITIVE)
12. Add star props + rendering to FriendsManagementList
13. Add star props + rendering to ChatListItem
14. Wire props from ConnectionsPage → both components
15. Wire `sendPairRequest` mutation to star button handlers

### Phase 4 — Enrich ViewFriendProfileScreen (ADDITIVE)
16. Add pairing detection via `usePairingPills`
17. Replace About card + InfoRows with pill chips
18. Remove ProfileStatsRow and ProfileInterestsSection imports
19. Add conditional PersonHolidayView rendering
20. Add ExpandedCardModal + custom holiday state
21. Add `useUserLocation` for PersonHolidayView travel time

### Phase 5 — Strip pairing content from DiscoverScreen (DELETION — moderate risk)
22. Remove all pairing imports (usePairingPills, PairRequestModal, PairedPeopleRow, etc.)
23. Remove PersonHolidayView, CustomHolidayModal, custom holiday state/handlers
24. Remove pairing pill selector and the "person selected" render branch
25. Remove pairing-related modals (PairRequestModal, IncomingPairRequestCard, PairingInfoCard)
26. Remove selectedPillId state — For You content always renders
27. Remove pairing coach mark (step 7, if pairing-related)
28. Update DiscoverScreen props in index.tsx (remove onAddFriend, onUpgradePress if unused)
29. Remove helper functions only used by holidays (getNextOccurrence, getDaysInMonth, MONTH_NAMES)

### Phase 6 — Verify and clean up
30. Remove unused imports from all modified files
31. Verify For You + Night Out tabs still work on Discover (no regressions)
32. Verify map pins still work on Discover
33. Verify chat list, messaging, friend management unaffected
34. Verify deep link navigation targets
35. Verify badge counts on Friends tab

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|------------------|
| 0 paired friends | Pills bar hidden. Star buttons still show on friend/chat rows. |
| 0 chats | Empty chat list (existing behavior). Pills bar still shows if paired. |
| 0 friends | Empty friend list (existing). Pills bar still shows if paired (edge: paired but not friends — shouldn't happen, but pills still render). |
| Unfriended but still in cache | Star button renders but `sendPairRequest` will fail server-side. Toast shows error. Acceptable degradation. |
| Pending pair request (outgoing) | Grey star on friend/chat row. Pill NOT shown in paired pills bar (only `active` state). |
| Pending pair request (incoming) | Banner on Friends page. Star button shows for that friend (they're not yet paired). |
| Friend removes pairing | `usePairingPills` invalidates. Green star → outline star. Pill disappears from bar. PersonHolidayView disappears from profile. |
| Open friend profile for non-paired friend | Only chips shown. No PersonHolidayView. No birthday/holidays. |
| Open friend profile for paired friend | Chips + PersonHolidayView. Birthday hero, holidays, cards, all sub-features. |
| Card tap inside PersonHolidayView in profile | Opens ExpandedCardModal overlaid on the profile screen. |
| Scroll performance with PersonHolidayView in profile | Single ScrollView with PersonHolidayView as child. Card rows are horizontal FlatLists (no vertical scroll conflict). Test on low-end device. |
| Multiple incoming pair requests | Banner shows first one. After accepting/declining, next one appears (array shifts). |
| Realtime pairing updates | `usePairingPills` has 5-min refetchInterval + Realtime subscription in `useSocialRealtime`. Both continue working since query keys unchanged. |

---

## Invariants Preserved

1. **No flow changes** — pairing accept/decline/send/cancel all use existing hooks unchanged
2. **No data changes** — same query keys, same cache, same invalidation patterns
3. **Existing chat functionality** — MessageInterface, ChatListItem rendering, conversations loading all unchanged
4. **Badge counts** — `totalUnreadMessages` still drives the tab badge (just the label changed)
5. **Realtime subscriptions** — pairing pill Realtime channel is userId-scoped, not page-scoped
6. **Deep links** — all pair-related deep links redirect to Friends tab instead of Discover
7. **ExpandedCardModal** — still works on Discover (for For You/Night Out cards) AND in profile (for PersonHolidayView cards)
8. **For You + Night Out** — card generation, caching, rendering all unchanged on Discover

---

## Test Cases

| # | Scenario | Action | Expected | Layer |
|---|----------|--------|----------|-------|
| T-01 | Tab displays "Friends" | Open app | Tab #3 shows "Friends" with people icon | Component |
| T-02 | Paired pills visible | Have 1+ paired friend | Avatar pills above search bar | Component |
| T-03 | Pill tap opens profile | Tap paired friend pill | ViewFriendProfileScreen opens for that user | Navigation |
| T-04 | "+" opens pair modal | Tap "+" on pills bar | PairRequestModal opens | Component |
| T-05 | Star sends pair request | Tap star on unpaired friend row | Request sent, star → pending grey | Mutation + Cache |
| T-06 | Green star on paired | View friend row for paired person | Green filled star, not tappable | Component |
| T-07 | No star for non-friend | Chat with non-friend | No star icon shown | Component |
| T-08 | Profile shows chips | Open friend profile | City, level, tier, interests as pill chips | Component |
| T-09 | Paired profile shows holidays | Open paired friend profile | PersonHolidayView visible below chips | Component + Query |
| T-10 | Non-paired profile no holidays | Open non-paired friend profile | No PersonHolidayView section | Component |
| T-11 | Discover keeps For You + Night Out | Navigate to Discover tab | For You cards, Night Out venues, map all work. No pairing pills/PersonHolidayView. | Component |
| T-12 | Map pins work | Tap pin on Discover map | Card bottom sheet opens | Component |
| T-13 | Incoming pair banner | Have incoming pair request | Banner shows on Friends page | Component |
| T-14 | Accept pair from banner | Tap banner → accept | Pairing created, pills update, banner gone | Full stack |
| T-15 | Pair notification navigates to Friends | Receive pair_request push, tap | Opens Friends tab | Navigation |
| T-16 | Card tap in profile | Tap card in PersonHolidayView inside profile | ExpandedCardModal opens | Component |
| T-17 | Chat still works | Open chat, send message | Message sent/received normally | Full stack |
| T-18 | Mute/block/report still work | Use three-dot menu on friend | Actions work as before | Full stack |
| T-19 | Unread badge on Friends tab | Have unread messages | Badge shows correct count | Component |
| T-20 | 0 paired friends | No pairings | Pills bar hidden, stars still show on rows | Component |
