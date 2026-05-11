# React Query Key Discipline — Mingla

Rules for query keys, cache invalidation, and mutation patterns. Violations here
are the #1 source of stale data bugs in Mingla.

---

## The Factory Pattern

Every entity type has ONE key factory. All hooks use the factory. No exceptions.

```typescript
// queryKeys.ts — canonical location for all key factories

export const savedCardKeys = {
  all: ['saved-cards'] as const,
  list: (userId: string) => [...savedCardKeys.all, 'list', userId] as const,
  detail: (cardId: string) => [...savedCardKeys.all, 'detail', cardId] as const,
};

export const deckKeys = {
  all: ['deck'] as const,
  cards: (userId: string, batchSeed: number, prefsHash: string, categories: string[], exactTime: boolean) =>
    [...deckKeys.all, 'cards', userId, batchSeed, prefsHash, JSON.stringify(categories), exactTime] as const,
};

export const profileKeys = {
  all: ['profile'] as const,
  me: (userId: string) => [...profileKeys.all, 'me', userId] as const,
  friend: (friendId: string) => [...profileKeys.all, 'friend', friendId] as const,
};
```

---

## Key Rules

### Rule 1: Every parameter that affects results MUST be in the key

If changing a parameter changes the query result, it MUST be in the key.
Otherwise you get stale data when the parameter changes.

```typescript
// ✅ CORRECT — all result-affecting params in key
queryKey: deckKeys.cards(userId, batchSeed, prefsHash, categories, exactTime)

// ❌ WRONG — missing prefsHash means stale cards after preference change
queryKey: ['deck-cards', userId, batchSeed]
```

### Rule 2: Arrays and objects must be serialized deterministically

```typescript
// ✅ CORRECT — JSON.stringify produces stable string
queryKey: [...base, JSON.stringify(categories.sort())]

// ❌ WRONG — array reference identity changes every render = infinite refetch
queryKey: [...base, categories]
```

### Rule 3: No hardcoded string keys anywhere

```typescript
// ✅ CORRECT
useQuery({ queryKey: savedCardKeys.list(userId), ... })

// ❌ WRONG — hardcoded, will drift from factory, impossible to invalidate properly
useQuery({ queryKey: ['saved-cards', 'list', userId], ... })
```

Grep test: `grep -r "queryKey: \['" src/` should return ZERO results outside queryKeys.ts.

### Rule 4: GPS coordinates must be rounded

```typescript
// ✅ CORRECT — rounded to prevent key churn from GPS drift
const lat = Math.round(latitude * 1000) / 1000;  // ~111m precision
const lng = Math.round(longitude * 1000) / 1000;
queryKey: [...base, lat, lng]

// ❌ WRONG — raw GPS creates new key every second
queryKey: [...base, latitude, longitude]  // 37.7749123456789 → different key every time
```

---

## Invalidation Rules

### Rule 1: Invalidate via the `all` key for broad invalidation

```typescript
// Invalidates ALL saved card queries (list + detail + any future variants)
queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
```

### Rule 2: Invalidate specific keys for targeted refresh

```typescript
// Only refreshes the list, not individual details
queryClient.invalidateQueries({ queryKey: savedCardKeys.list(userId) });
```

### Rule 3: Invalidation goes in `onSuccess`, never inline

```typescript
// ✅ CORRECT — fires AFTER mutation succeeds
const mutation = useMutation({
  mutationFn: saveCard,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
  },
});

// ❌ WRONG — race condition: invalidation may fire before mutation completes
async function handleSave() {
  await saveCard(cardId);
  queryClient.invalidateQueries({ queryKey: savedCardKeys.all }); // RACE
}
```

### Rule 4: Cross-entity invalidation is explicit

If saving a card should also refresh the deck (to show "Saved" badge):
```typescript
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
  queryClient.invalidateQueries({ queryKey: deckKeys.all });  // explicit cross-entity
},
```

Document every cross-entity invalidation in the implementation report.

---

## staleTime Rules

| Data Type | staleTime | Reasoning |
|-----------|----------|-----------|
| User profile | 60s | Changes rarely, needs freshness on mount |
| Preferences | 60s | Changes trigger deck refresh anyway |
| Saved cards | 30s | Swipe actions are frequent |
| Deck cards | Infinity | Only refreshes via batchSeed change |
| Subscription tier | 60s | Transitional (was 5min, reduced for freshness) |
| Conversations | 30s | Realtime handles updates, stale for fallback |
| Calendar entries | 60s | Changes less frequently |
| Friend list | 60s | Accept/remove triggers manual invalidation |

---

## enabled Rules

Always gate queries on required dependencies:

```typescript
// ✅ CORRECT — doesn't fire until userId exists
useQuery({
  queryKey: savedCardKeys.list(userId),
  queryFn: () => getSavedCards(userId),
  enabled: !!userId,
});

// ❌ WRONG — fires immediately, fails with undefined userId
useQuery({
  queryKey: savedCardKeys.list(userId),
  queryFn: () => getSavedCards(userId),
  // no enabled gate = crash or bad data
});
```

---

## Existing Key Factories (as of last audit)

These factories exist in the codebase. Use them. Do NOT create duplicates.

| Factory | Entity | Location |
|---------|--------|----------|
| `savedCardKeys` | Saved experiences | queryKeys.ts |
| `deckKeys` | Deck/discovery cards | queryKeys.ts |
| `profileKeys` | User profiles | queryKeys.ts |
| `preferencesKeys` | User preferences | queryKeys.ts |
| `calendarKeys` | Calendar entries | queryKeys.ts |
| `conversationKeys` | Chat conversations | queryKeys.ts |
| `friendKeys` | Friend relationships | queryKeys.ts |
| `notificationKeys` | Notifications | queryKeys.ts |
| `subscriptionKeys` | Subscription state | queryKeys.ts |
| `blockedUserKeys` | Blocked users | queryKeys.ts |

If you need a new factory, create it in `queryKeys.ts` following the same pattern.
Document it in the implementation report.

---

## When Adding a New Query

Checklist:
- [ ] Key uses factory (not hardcoded)
- [ ] Key includes ALL result-affecting parameters
- [ ] Arrays/objects are serialized deterministically
- [ ] GPS coords are rounded
- [ ] `enabled` gates on required dependencies
- [ ] `staleTime` is intentional
- [ ] Corresponding mutation has `onError`
- [ ] Corresponding mutation invalidates via factory in `onSuccess`
- [ ] Cross-entity invalidation is documented
