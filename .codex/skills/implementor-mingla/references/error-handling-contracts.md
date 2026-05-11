> Parity note: ported from `.claude/skills/mingla-implementor/references/error-handling-contracts.md` during META-ORCH-0755-B so Codex implementor can load Claude’s granular layer-by-layer error contracts in addition to the consolidated Codex contract.

# Error Handling Contracts — By Layer

Exact rules for how errors must be handled at each layer of the Mingla stack.
No ambiguity. No "use your judgment." These are contracts.

---

## Layer 1: Database / RLS

**Contract:** The database enforces data integrity. Errors here mean constraint violations
or auth failures.

- NOT NULL violations → surface as validation error to user
- FK violations → surface as "referenced item no longer exists"
- UNIQUE violations → surface as "already exists" or handle idempotently
- RLS denials → surface as 403 from edge function, never silently return empty

**Never:** Catch a database error and return empty/null. If the DB says no, that's information.

---

## Layer 2: Edge Functions

**Contract:** Edge functions are the trust boundary. They validate, authorize, and return
structured responses.

```typescript
// SUCCESS
return new Response(JSON.stringify({ data: result }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

// CLIENT ERROR (validation, missing params, unauthorized)
return new Response(JSON.stringify({
  error: 'Human-readable message',
  code: 'MACHINE_READABLE_CODE',
  details: { field: 'reason' }  // optional
}), {
  status: 400 | 401 | 403 | 404 | 409,
  headers: { 'Content-Type': 'application/json' },
});

// SERVER ERROR (unexpected failure)
return new Response(JSON.stringify({
  error: 'Something went wrong. Please try again.',
  code: 'INTERNAL_ERROR',
}), {
  status: 500,
  headers: { 'Content-Type': 'application/json' },
});
```

**Auth check at entry (mandatory):**
```typescript
const authHeader = req.headers.get('Authorization');
if (!authHeader) {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }), { status: 401 });
}
const { data: { user }, error: authError } = await supabase.auth.getUser(/* token */);
if (authError || !user) {
  return new Response(JSON.stringify({ error: 'Invalid token', code: 'AUTH_INVALID' }), { status: 401 });
}
```

**External API calls:**
```typescript
// Always timeout, always catch, always structured error
try {
  const result = await withTimeout(externalApi.call(params), 8000);
  if (!result.ok) {
    console.error(`External API failed: ${result.status}`, await result.text());
    return new Response(JSON.stringify({ error: 'Service temporarily unavailable', code: 'UPSTREAM_ERROR' }), { status: 502 });
  }
  // process result
} catch (e) {
  if (e.message === 'Timeout') {
    return new Response(JSON.stringify({ error: 'Request timed out', code: 'TIMEOUT' }), { status: 504 });
  }
  console.error('Unexpected error:', e);
  return new Response(JSON.stringify({ error: 'Something went wrong', code: 'INTERNAL_ERROR' }), { status: 500 });
}
```

---

## Layer 3: Services (Mobile)

**Contract:** Services are the Supabase client wrapper. They throw on error.
Callers (hooks) are responsible for catching and presenting to users.

```typescript
// ✅ CORRECT — throw on error
export async function saveCard(cardId: string, userId: string): Promise<SaveResult> {
  const { data, error } = await supabase
    .from('saves')
    .insert({ card_id: cardId, user_id: userId })
    .select()
    .single();

  if (error) throw new Error(`Failed to save card: ${error.message}`);
  return data;
}
```

**Transitional pattern (when full migration isn't in scope):**
```typescript
// [TRANSITIONAL] returns fallback on error — needs ServiceResult<T> migration
// Owner: next hardening cycle. Exit condition: ServiceResult<T> across ~60 call sites.
export async function getPreferences(userId: string): Promise<Preferences> {
  try {
    const { data, error } = await supabase
      .from('preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[TRANSITIONAL] getPreferences error:', error.message);
      return DEFAULT_PREFERENCES;
    }
    return data ?? DEFAULT_PREFERENCES;
  } catch (e) {
    console.error('[TRANSITIONAL] getPreferences crash:', e);
    return DEFAULT_PREFERENCES;
  }
}
```

**Rules:**
- `.single()` only when row is guaranteed to exist. Otherwise `.maybeSingle()`.
- Always `select()` what you need. Never `select('*')` unless you truly need everything.
- Never `return null` or `return []` on error without `[TRANSITIONAL]` label.

---

## Layer 4: Hooks

**Contract:** Hooks catch errors from services and present them to users.
Every mutation has `onError`. Every query has error state handling.

```typescript
// Mutation with error handling
const saveMutation = useMutation({
  mutationFn: ({ cardId }: { cardId: string }) => saveCard(cardId, userId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: savedCardKeys.all });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  onError: (error) => {
    showMutationErrorToast(error, 'Couldn\'t save this experience');
    // Rollback optimistic update if applicable
  },
});

// Query with proper states
const { data, isLoading, isError, error, refetch } = useQuery({
  queryKey: savedCardKeys.list(userId),
  queryFn: () => getSavedCards(userId),
  enabled: !!userId,
  staleTime: 60_000,
});
```

**`showMutationErrorToast` contract:**
- Detects Supabase error codes
- Rejects SQL/stack trace content (never show to user)
- Detects network/timeout errors
- Shows actionable message: "Couldn't [action]. Tap to try again."

---

## Layer 5: Components

**Contract:** Components render the right state. They never show blank screens.

```typescript
// Every async component must handle ALL states:
if (isLoading) return <LoadingSkeleton variant="cards" />;
if (isError) return (
  <ErrorState
    message="Couldn't load your saved experiences"
    onRetry={refetch}
  />
);
if (!data?.length) return (
  <EmptyState
    icon="heart-outline"
    message="Save experiences by swiping right"
    action={{ label: 'Start exploring', onPress: goToExplore }}
  />
);
return <SavedCardList data={data} />;
```

**Submitting state:**
```typescript
<Button
  onPress={handleSave}
  disabled={mutation.isPending}
  loading={mutation.isPending}
>
  {mutation.isPending ? 'Saving...' : 'Save'}
</Button>
```

---

## The Golden Rule

```
Database enforces → Edge function validates → Service throws → Hook catches → Component renders
```

Errors flow UP the stack. Each layer adds its own handling but NEVER swallows.
The user always knows something happened — even if the message is gentle.
