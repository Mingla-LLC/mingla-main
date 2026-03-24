# Query Key Registry

> Canonical source for all React Query key shapes.
> Code lives in `app-mobile/src/hooks/queryKeys.ts` (consolidated) and
> original hook files (not yet consolidated).
> This document is the human-readable reference.
>
> Established: 2026-03-23 (Launch Hardening Program)

---

## Rules

1. **One factory per entity.** Never create inline query key arrays.
2. **All new factories go in `queryKeys.ts`.** Existing factories in original files are documented here with consolidation status.
3. **Mutations invalidate via `factory.all`** prefix to reach all sub-queries.
4. **New keys require a registry entry** before implementation.
5. **Old keys must be removed** — no "keep both for now."

---

## Consolidated Factories (in queryKeys.ts)

### savedCardKeys

| Sub-key | Shape | Used by |
|---------|-------|---------|
| `all` | `['savedCards']` | Invalidation target |
| `list(userId)` | `['savedCards', 'list', userId]` | useSavedCards |
| `saves(userId)` | `['savedCards', 'saves', userId]` | useSavesQuery |
| `paired(pairedUserId, cat?)` | `['savedCards', 'paired', pairedUserId, cat]` | usePairedSaves |
| `board(sessionId)` | `['savedCards', 'board', sessionId]` | Board saves |

**Invalidation rule:** All save/unsave/remove mutations → `savedCardKeys.all`
**Old keys removed:** `['pairedSaves', ...]`, `['saves', ...]`, inline `["savedCards", userId]`

### personCardKeys

| Sub-key | Shape | Used by |
|---------|-------|---------|
| `all` | `['personCards']` | Invalidation target |
| `hero(pairedUserId, holidayKey)` | `['personCards', 'hero', ...]` | usePersonHeroCards |
| `paired(pairedUserId, holidayKey, locKey)` | `['personCards', 'paired', ...]` | usePairedCards |

**Invalidation rule:** Shuffle → `setQueryData` on specific sub-key. No broad invalidation (Infinity staleTime).
**Old keys removed:** `['person-hero-cards', ...]`, `['paired-cards', ...]`

---

## Factories in Original Files (consolidation planned)

### friendsKeys (useFriendsQuery.ts)

| Sub-key | Shape |
|---------|-------|
| `all` | `['friends']` |
| `list(userId)` | `['friends', 'list', userId]` |
| `requests(userId)` | `['friends', 'requests', userId]` |
| `blocked(userId)` | `['friends', 'blocked', userId]` |
| `muted(userId)` | `['friends', 'muted', userId]` |

**Invalidation rule:** Accept/remove/block → `friendsKeys.all`. Decline → `friendsKeys.requests`. Unblock → `friendsKeys.blocked`.

### pairingKeys (usePairings.ts)

| Sub-key | Shape |
|---------|-------|
| `prefix` | `['pairings']` |
| `all(userId)` | `['pairings', userId]` |
| `pills(userId)` | `['pairings', 'pills', userId]` |
| `incomingRequests(userId)` | `['pairings', 'incoming', userId]` |

### notificationKeys (useNotifications.ts)

| Sub-key | Shape |
|---------|-------|
| `all(userId)` | `['notifications', userId]` |
| `unreadCount(userId)` | `['notifications', 'unread', userId]` |

### phoneLookupKeys (usePhoneLookup.ts)

| Sub-key | Shape |
|---------|-------|
| `all` | `['phone-lookup']` |
| `lookup(phone)` | `['phone-lookup', phone]` |

---

## Standalone Keys (no factory yet)

| Key | Used by | Consolidation plan |
|-----|---------|-------------------|
| `['conversations']` | ConnectionsPage chat list | Create factory when messaging domain is hardened |
| `['calendarEntries', userId]` | CalendarTab | Create factory when calendar domain is hardened |
| `['userPreferences', userId]` | useUserPreferences | Create factory when preference domain grows |
| `['deck-cards', ...]` | useDeckCards (14-part key) | Complex — document but don't consolidate yet |
| `['curated-experiences', ...]` | useCuratedExperiences | Create factory when curated domain is hardened |
