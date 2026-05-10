# Code Patterns — Mingla

Patterns to follow and anti-patterns to avoid, extracted from real Mingla bugs
and hardening passes. Read before every implementation.

---

## React Query Patterns

### ✅ DO: Use key factories

```typescript
// queryKeys.ts — one factory per entity
export const savedCardKeys = {
  all: ['saved-cards'] as const,
  list: (userId: string) => [...savedCardKeys.all, 'list', userId] as const,
  detail: (cardId: string) => [...savedCardKeys.all, 'detail', cardId] as const,
};
```

### ❌ DON'T: Hardcode key strings

```typescript
// NEVER do this — causes cache drift, stale data, impossible invalidation
useQuery({ queryKey: ['saved-cards', userId], ... });
```

### ✅ DO: Invalidate via factory after mutation

```typescript
const mutation = useMutation({
  mutationFn: saveCard,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
  },
  onError: (error) => {
    showErrorToast(error, 'Could not save this experience. Tap to try again.');
  },
});
```

### ❌ DON'T: invalidateQueries inside the same hook that triggers the mutation

```typescript
// RACE CONDITION — invalidation fires before mutation completes
const save = async () => {
  await saveCard(cardId);
  queryClient.invalidateQueries({ queryKey: savedCardKeys.all }); // BAD
};
```

### ✅ DO: Include ALL parameters that affect the result in the key

```typescript
// Every parameter that changes the query result MUST be in the key
queryKey: deckKeys.cards(userId, batchSeed, prefsHash, categories, exactTime)
```

### ❌ DON'T: Omit parameters (causes stale data across filter changes)

```typescript
// Missing prefsHash means old cards persist after preference change
queryKey: ['deck-cards', userId, batchSeed] // BAD — missing prefsHash
```

---

## Zustand Patterns

### ✅ DO: Client-only state

```typescript
// Zustand owns: page, UI flags, navigation, deck batches
interface AppState {
  currentPage: string;
  showPaywall: boolean;
  viewingFriendProfileId: string | null;
}
```

### ❌ DON'T: Server data in Zustand

```typescript
// NEVER — React Query owns server state
interface AppState {
  userProfile: Profile; // BAD — this should be in React Query
  savedCards: Card[];   // BAD — this should be in React Query
}
```

### ✅ DO: Persist with schema versioning

```typescript
persist(
  (set) => ({ ... }),
  {
    name: 'app-store',
    version: DECK_SCHEMA_VERSION, // bump on shape changes
    // migration function for old shapes
  }
)
```

---

## Error Handling Patterns

### ✅ DO: Services throw on error

```typescript
// Services THROW — callers handle
export async function saveExperience(cardId: string): Promise<SaveResult> {
  const { data, error } = await supabase.from('saves').insert({ card_id: cardId });
  if (error) throw new Error(`Save failed: ${error.message}`);
  return data;
}
```

### ❌ DON'T: Services swallow errors

```typescript
// SILENT FAILURE — caller thinks it worked
export async function saveExperience(cardId: string) {
  try {
    const { data, error } = await supabase.from('saves').insert({ card_id: cardId });
    if (error) return null; // BAD — error swallowed
    return data;
  } catch {
    return null; // WORSE — catch swallows everything
  }
}
```

### ✅ DO: Transitional containment (when full fix isn't in scope)

```typescript
// [TRANSITIONAL] returns fallback on error — needs ServiceResult<T> migration
// Owner: next hardening cycle. Exit condition: ServiceResult<T> return type.
export async function getPreferences(userId: string) {
  try {
    const { data, error } = await supabase.from('preferences').select('*').eq('user_id', userId).single();
    if (error) {
      console.error('[TRANSITIONAL] getPreferences failed, returning defaults:', error);
      return DEFAULT_PREFERENCES;
    }
    return data;
  } catch (e) {
    console.error('[TRANSITIONAL] getPreferences crashed:', e);
    return DEFAULT_PREFERENCES;
  }
}
```

### ✅ DO: Mutations with user-facing error feedback

```typescript
const mutation = useMutation({
  mutationFn: saveExperience,
  onError: (error) => {
    showMutationErrorToast(error, 'Couldn't save this experience');
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
});
```

---

## Component Patterns

### ✅ DO: Handle all async states

```typescript
if (isLoading) return <LoadingSkeleton />;
if (isError) return <ErrorState message="Couldn't load your saved cards" onRetry={refetch} />;
if (!data?.length) return <EmptyState message="Save experiences to see them here" />;
return <CardList data={data} />;
```

### ❌ DON'T: Only handle the happy path

```typescript
// BAD — blank screen on error, blank screen on empty, flash on loading
return <CardList data={data ?? []} />;
```

### ✅ DO: Non-blocking interactions

```typescript
// Modal closes instantly, background work with error toast on failure
const handleAccept = () => {
  closeModal(); // instant feedback
  acceptRequest(requestId).catch(() => {
    showErrorToast('Couldn't accept. Please try again.');
  });
};
```

### ❌ DON'T: Block UI on background operations

```typescript
// BAD — user stares at frozen modal for 2+ seconds
const handleAccept = async () => {
  await acceptRequest(requestId); // blocks UI
  closeModal(); // only after network round trip
};
```

---

## Edge Function Patterns

### ✅ DO: Structured error responses

```typescript
if (!userId) {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

### ✅ DO: Input validation at entry

```typescript
const { card_id, action } = await req.json();
if (!card_id || typeof card_id !== 'string') {
  return new Response(JSON.stringify({ error: 'card_id is required' }), { status: 400 });
}
```

### ✅ DO: Timeouts on external calls

```typescript
// withTimeout pattern — never let external APIs hang forever
const result = await withTimeout(fetchGooglePlaces(query), 8000);
```

---

## Database / Migration Patterns

### ✅ DO: RLS in same migration as table creation

```sql
CREATE TABLE saves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  card_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE saves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saves"
  ON saves FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saves"
  ON saves FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### ❌ DON'T: Create table without RLS

```sql
-- BAD — table is wide open until someone remembers to add RLS
CREATE TABLE saves ( ... );
-- no RLS policies = security hole
```

### ✅ DO: Defensive constraints

```sql
-- NOT NULL on required fields, CHECK constraints, UNIQUE where needed
card_id TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
UNIQUE(user_id, card_id)
```

---

## Navigation Patterns (Mingla-specific)

### ✅ DO: Use Mingla's custom navigation

```typescript
// Mingla uses currentPage state, NOT React Navigation
const { setCurrentPage } = useAppState();
setCurrentPage('discover');
```

### ❌ DON'T: Import React Navigation

```typescript
// Mingla does NOT use React Navigation — this will break
import { useNavigation } from '@react-navigation/native'; // NEVER
```

---

## Anti-Pattern Catalog

| Anti-Pattern | What Goes Wrong | Fix |
|-------------|----------------|-----|
| `catch () { return [] }` | Silent failure — UI shows empty instead of error | Throw in service, catch in hook with toast |
| `data ?? fallbackValue` for display data | Fabricated data shown to users | Show "Not available" or hide element |
| `rating ?? 4.0` | Fake rating displayed | Show nothing or "No rating yet" |
| Inline query key `['my-data', id]` | Cache drift, stale data | Use key factory |
| `invalidateQueries` in same async block as mutation | Race condition | Use `onSuccess` callback |
| Zustand storing API responses | Ownership conflict with React Query | Move to React Query |
| `.single()` on potentially empty result | Crash on no rows | Use `.maybeSingle()` |
| Missing `onError` on mutation | Silent mutation failure | Add onError with toast |
| No loading state on async screen | Flash of empty/broken UI | Add skeleton/spinner |
| Fixing solo mode but not collab mode | Parity drift | Always check both paths |
