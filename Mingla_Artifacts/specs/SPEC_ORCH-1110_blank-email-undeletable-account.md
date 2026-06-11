# SPEC — ORCH-1110 — Business-app email field blank + account un-deletable when stored email is empty

**Status:** READY FOR IMPLEMENT
**Author:** mingla-forensics (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1110-[blank-email-undeletable-account]/` on branch `ORCH-1110-blank-email-undeletable-account`
**Date:** 2026-06-10
**Surfaces in scope:** Business iOS, Business Android (consumer/admin/buyer-web NOT in scope)
**Project ref:** `gqnoajqerqhnvulmnyvv`

---

## 1. Executive summary

A business user (`sethogievabelgium@gmail.com`, auth id `332e1733-af2b-49ca-8014-87d56f1b735e`) cannot delete their Mingla Business account. The delete-account screen's Step 3 ("Type your email to confirm") shows a **blank** "YOUR EMAIL" box, and typing the real email never enables the "Delete my account" button — the account is permanently un-deletable.

Two real defects cause this:

1. **Client trap (primary).** `mingla-business/app/account/delete.tsx` reads `user.email` from `useAuth()`. For this user `auth.users.email` is `NULL`, which the GoTrue JS SDK serializes as the **empty string** `""` on `User.email`. The screen displays `email={user?.email ?? ""}` (renders blank) and gates on `emailMatches` which compares the typed email to that empty stored value — the typed real email can never equal `""`, so the button stays `disabled` forever. The inverse is also wrong: with stored email `""`, leaving the input empty makes `"" === ""` TRUE, mis-enabling delete on blank input.

2. **Provisioning (root data origin).** `mingla-business/src/services/creatorAccount.ts:37` writes `email: user.email ?? null` into `creator_accounts` on first sign-in. When `auth.users.email` is NULL, the JS `User.email` is `""` (empty string, not null/undefined), so `"" ?? null` evaluates to `""` and an empty-string email is persisted — even though the real email (`sethogievabelgium@gmail.com`) is present in `user.user_metadata.email` AND `user.identities[0].identity_data.email`. (Confirmed live: `creator_accounts.email = ''`, `auth.users.email = NULL`, `user_metadata.email` + identity email = the real address.)

This SPEC contracts: (1) hardening the delete-gate + normalizing the email source so the gate can never deadlock and never mis-enables on blank input; (2) fixing `ensureCreatorAccount` to persist the best-resolvable real email at provisioning; (3) a one-time backfill migration for the 3 existing blank/null rows; (4) two required regression tests; (5) one DRAFT invariant.

---

## 2. Scope & non-goals

### In scope
- **Email resolution helper** — a shared pure function that resolves the best-available real email from a Supabase `User` object (handles empty-string as "absent").
- **`delete.tsx` Step 3 gate hardening** — resolve a real email for display + matching; when none is resolvable, fall back to a typed-`DELETE` confirmation token so the destructive action is always reachable; never mis-enable on blank input.
- **`creatorAccount.ts` provisioning fix** — persist the resolved real email (not the raw empty string) at first-sign-in seed.
- **One-time backfill migration** — set `creator_accounts.email` from `COALESCE(auth.users.email, identities.identity_data->>'email', profiles.email)` for the 3 existing blank/`''`/NULL rows. NULL-empty normalized.
- **Two regression tests** (happy-path fails-on-revert + adversarial different-angle).
- **One DRAFT invariant.**

### Non-goals (explicitly NOT covered)
- **Consumer-app account deletion** — the consumer delete flow does NOT gate on a typed-email match, so it is not trapped (verified: no consumer delete-account screen exists in `app-mobile/` that mirrors this gate). The consumer `profiles.email` for this user is already correct. NOT touched.
- **Admin web / buyer web** — no email-gated delete; out of scope.
- **Root cause of `auth.users.email = NULL` for the Google OAuth user** — this originates in the *consumer-app* Google OAuth callback / GoTrue provisioning (the user first signed up consumer-side 2026-06-01); it is a Supabase-auth-level data state, not a business-app bug. We work AROUND it (resolve from identity/metadata) rather than re-deriving `auth.users.email`. **Noted as a Discovery for Orchestrator (see §10).**
- **`formatCurrency(preview.totalRevenueGbp, "GBP")` at `delete.tsx:365`** — a hardcoded GBP currency display. OUT of scope per dispatch. **DO NOT TOUCH.** Logged as a separate observation in §10.
- **Server-side / RPC email re-validation** — the deletion mutation (`useAccountDeletion.ts:41-45`) gates on `user.id` only, never on email. No server change is needed to unblock deletion; the gate is purely a client confirmation UX. We do NOT add a server email check.

### Assumptions
- A1. The signed-in business user's `User` object client-side carries `user_metadata.email` and/or `identities[].identity_data.email` whenever a real email exists. **Verified live** for the affected account (both present).
- A2. `creator_accounts.email` is nullable with no default (verified). Backfill writes are safe single-column UPDATEs.
- A3. The deletion RLS self-write UPDATE policy (`auth.uid() = id`) is unaffected and already permits the soft-delete write.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior demanded | Files touched here | Parity |
|---|---------|---------|-------------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/` iOS) | NO | — (no email-gated business delete on consumer) | none | n/a |
| 2 | Consumer Android (`app-mobile/` Android) | NO | — | none | n/a |
| 3 | Buyer/anon Web | NO | — (no account delete surface) | none | n/a |
| 4 | **Business iOS** | **YES** | Delete Step 3 shows the real email (or `DELETE` fallback prompt); button enables on a correct match; never deadlocks; never enables on blank input | `mingla-business/app/account/delete.tsx`, `mingla-business/src/services/creatorAccount.ts`, new `mingla-business/src/utils/resolveUserEmail.ts`, migration | Automatic (shared RN code path — iOS + Android render identical component) |
| 5 | **Business Android** | **YES** | Identical to iOS | (same as above) | Automatic (shared RN code) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | — | none | n/a |
| 7 | Business Web preview (adjacent) | INCIDENTAL | The same `delete.tsx` renders on business-web; the fix applies automatically. No web-specific behavior demanded, but the fix must not regress web (the resolution helper is platform-agnostic; no native API used). | (same shared files) | Automatic |

Business iOS and Android run the **same** React Native component and the **same** AuthContext/service; there is no separate native path, so parity is automatic. Web preview shares the component too — the helper uses no native API, so it is safe there.

---

## 4. Layered specification

### 4.1 NEW utility — `mingla-business/src/utils/resolveUserEmail.ts`

A pure, platform-agnostic helper. Single source of truth for "the best real email for this user", treating empty-string and whitespace-only as ABSENT.

**Exports:**

```ts
export function resolveUserEmail(user: User | null): string | null
```

**Contract:**
- Returns a non-empty, trimmed email string, or `null` if no real email can be resolved.
- Resolution order (first non-empty wins; each candidate `.trim()`-ed; empty-after-trim treated as absent):
  1. `user.email`
  2. `user.user_metadata?.email` (string)
  3. `user.identities?.[…].identity_data?.email` — iterate identities, first one whose `identity_data.email` is a non-empty string.
- A helper `const cleaned = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);` normalizes each candidate.
- If `user === null` → return `null`.
- **Return type explicit** (`string | null`). No `any`. No `as unknown as`.
- **Does NOT lowercase** — preserves the user's display casing for the "YOUR EMAIL" box. Case-insensitivity is applied only at the comparison site (delete.tsx).

> Rationale: centralizing the chain means the delete gate, the provisioning seed, and any future consumer of "the user's email" all agree, and `""` can never again leak through a bare `??`.

### 4.2 Service — `mingla-business/src/services/creatorAccount.ts` (`ensureCreatorAccount`)

**Current (line 34-46):**
```ts
const { error } = await supabase.from("creator_accounts").upsert(
  { id: user.id, email: user.email ?? null, display_name: displayName, avatar_url: avatarUrl },
  { onConflict: "id", ignoreDuplicates: true },
);
```

**Change:** replace `email: user.email ?? null` with `email: resolveUserEmail(user)` (imported from `../utils/resolveUserEmail`). `resolveUserEmail` returns `null` when no real email exists, so the column gets a real email or NULL — **never `""`**.

- Import: `import { resolveUserEmail } from "../utils/resolveUserEmail";`
- The existing `displayName` derivation (`user.email?.split("@")[0]`) at line 23-27 stays as-is — it is display-name fallback, not the email column, and out of this fix's path. (Note: it would still produce `""`-derived junk in the no-real-email edge, but display_name is not the bug and not in scope; leave unchanged.)
- `ignoreDuplicates: true` semantics unchanged — this fix only affects the **seed** value on first insert. Existing rows are corrected by the backfill (§4.4), not by re-running this upsert (the upsert can't update an existing row by design).
- Error contract unchanged (throws on error; callers wrap).

### 4.3 Component — `mingla-business/app/account/delete.tsx`

#### 4.3.1 Resolved-email + confirmation-mode derivation (host component)

Replace the `emailMatches` `useMemo` (lines 137-143) and the inline `email={user?.email ?? ""}` (line 239) with a normalized model.

Add near the top of `DeleteAccountRoute`, after `provider` useMemo:

```ts
const resolvedEmail = useMemo<string | null>(() => resolveUserEmail(user), [user]);
const confirmMode: "email" | "keyword" = resolvedEmail === null ? "keyword" : "email";
const DELETE_KEYWORD = "DELETE";
```

Import: `import { resolveUserEmail } from "../../src/utils/resolveUserEmail";`

Rewrite `emailMatches` (rename to `confirmMatches` to reflect both modes):

```ts
const confirmMatches = useMemo<boolean>(() => {
  const typed = confirmEmailInput.trim();
  if (confirmMode === "keyword") {
    return typed.toUpperCase() === DELETE_KEYWORD; // case-insensitive DELETE
  }
  if (typed.length === 0) return false;            // blank input NEVER matches
  return typed.toLowerCase() === (resolvedEmail as string).toLowerCase();
}, [confirmEmailInput, confirmMode, resolvedEmail]);
```

- Update `handleConfirmDelete` (line 170-190): replace `if (!emailMatches || deleting)` with `if (!confirmMatches || deleting)`. The deps array updates `emailMatches → confirmMatches`.
- The empty-input guard (`typed.length === 0 → false`) closes the mis-enable direction: an empty input can never enable delete in `email` mode. In `keyword` mode an empty input is also `!== "DELETE"` so it stays disabled.

#### 4.3.2 Step3Confirm props + UI (the two modes)

`Step3Confirm` must render differently per `confirmMode`. Change its props:

```ts
interface Step3ConfirmProps {
  confirmMode: "email" | "keyword";
  resolvedEmail: string | null;   // non-null when confirmMode === "email"
  input: string;
  onChangeInput: (value: string) => void;
  confirmMatches: boolean;
  deleting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}
```

Call site (replace lines 237-249):
```tsx
{step === 3 ? (
  <Step3Confirm
    confirmMode={confirmMode}
    resolvedEmail={resolvedEmail}
    input={confirmEmailInput}
    onChangeInput={setConfirmEmailInput}
    confirmMatches={confirmMatches}
    deleting={deleting}
    onConfirm={() => { void handleConfirmDelete(); }}
    onBack={handleBack}
  />
) : null}
```

**States inside `Step3Confirm`:**

| State | confirmMode | Rendered |
|-------|-------------|----------|
| **email — populated** (`resolvedEmail` non-null) | `email` | Title "Type your email to confirm"; subtitle unchanged; "YOUR EMAIL" box shows `resolvedEmail` (never blank); TextInput placeholder "Type your email", `keyboardType="email-address"`, `autoCapitalize="none"`. Button `disabled={!confirmMatches || deleting}`. |
| **keyword — no resolvable email** (`resolvedEmail === null`) | `keyword` | Title "Type DELETE to confirm"; subtitle "We couldn't find an email on file for your account. Type the word DELETE to confirm you want to delete it."; **NO "YOUR EMAIL" box rendered** (it would be blank — Constitution rule 1: no blank confirmation surface); TextInput placeholder "Type DELETE", `autoCapitalize="characters"`, `autoCorrect={false}`, `keyboardType="default"`. Button `disabled={!confirmMatches || deleting}`. |
| **submitting** | either | Button label "Deleting...", `disabled` true (unchanged behavior). |
| **error** (delete failed) | either | Existing toast "Couldn't delete. Tap to try again." + `setStep(3)` + `setConfirmEmailInput("")` (unchanged). |

- The "YOUR EMAIL" box (`confirmEmailBox`, lines 462-467) renders **only** when `confirmMode === "email"`. The `numberOfLines={1}` + existing styling stay.
- Accessibility: the "Delete my account" button keeps `accessibilityLabel="Delete my account"`. The TextInput gets `accessibilityLabel={confirmMode === "email" ? "Type your email to confirm" : "Type DELETE to confirm"}`.
- No new colors/tokens; reuse existing `styles`. No inline style objects.

#### 4.3.3 What is removed
- `email={user?.email ?? ""}` prop (replaced by `resolvedEmail`/`confirmMode`).
- The `emailMatches` name (replaced by `confirmMatches`).
- No other host logic changes (steps 1/2/4, preview, toast, navigation all unchanged).

### 4.4 Database — one-time backfill migration

**File:** `supabase/migrations/20260924000000_orch_1110_backfill_creator_account_email.sql`
(Strictly greater than the current latest `20260923000000_orch_426_scale_hot_path_indexes.sql`.)

**SQL (idempotent, safe):**
```sql
-- ORCH-1110: backfill creator_accounts.email where it is '' or NULL, from the
-- best available real email (auth.users.email → newest identity email → profiles.email).
-- Empty-string is normalized to a real email or left NULL (never '').
-- Idempotent: re-running affects only rows still blank/NULL. No-op once corrected.
UPDATE public.creator_accounts ca
SET email = sub.resolved_email,
    updated_at = now()
FROM (
  SELECT u.id,
    COALESCE(
      NULLIF(BTRIM(au.email), ''),
      NULLIF(BTRIM((
        SELECT ai.identity_data->>'email'
        FROM auth.identities ai
        WHERE ai.user_id = u.id AND NULLIF(BTRIM(ai.identity_data->>'email'), '') IS NOT NULL
        ORDER BY ai.last_sign_in_at DESC NULLS LAST
        LIMIT 1
      )), ''),
      NULLIF(BTRIM(p.email), '')
    ) AS resolved_email
  FROM public.creator_accounts u
  JOIN auth.users au ON au.id = u.id
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE NULLIF(BTRIM(u.email), '') IS NULL          -- '' or NULL only
) sub
WHERE ca.id = sub.id
  AND sub.resolved_email IS NOT NULL                 -- never write NULL or ''
  AND NULLIF(BTRIM(ca.email), '') IS NULL;           -- re-guard at write time
```

**Safe-migration considerations:**
- **Read-write scope:** UPDATE only `public.creator_accounts.email` + `updated_at`; touches at most the 3 currently-blank rows (verified live: 1 `''` + 2 NULL).
- **No DDL** — no schema change, no constraint, no RLS change. Pure data correction.
- **Idempotent** — the `WHERE NULLIF(BTRIM(u.email),'') IS NULL` + `sub.resolved_email IS NOT NULL` guards mean a second run is a no-op; corrected rows are excluded.
- **Never writes `''` or NULL** — the `NULLIF(BTRIM(...),'')` chain + `sub.resolved_email IS NOT NULL` guard ensure only a real email is written. A row with no resolvable email anywhere is left as-is (the client `keyword` fallback in §4.3.2 still lets that user delete).
- **No `$function$;` / GRANT / DROP-before-widen concerns** — this is a plain UPDATE, not a function or RETURNS TABLE change.
- **Apply path:** per `feedback_edge_deploy_and_migration_apply_hazards.md`, if CLI is drift-wedged, apply via Supabase Management API (the implementor, not this SPEC, executes the apply at IMPLEMENT/CLOSE; do NOT apply during SPEC).

**Backfill decision: YES.** Exactly 3 rows are blank/NULL; all 3 have a resolvable real email (verified live). The backfill immediately un-traps the affected account in production without waiting for a re-sign-in, and corrects the two ORCH-1108 test rows. Low blast radius, fully guarded, idempotent.

---

## 5. Success criteria

Parity is automatic (shared RN component) → criteria are not split per-platform except where a platform render delta exists (none here; iOS/Android render identically).

- **SC-1.** When a business user with a resolvable real email (from `user.email`, `user_metadata.email`, or an identity) opens Delete → Step 3, the "YOUR EMAIL" box displays that real email (never blank).
- **SC-2.** In `email` mode, typing the resolved email (any case) enables "Delete my account"; tapping it runs the soft-delete and proceeds to Step 4.
- **SC-3.** In `email` mode, an **empty** input leaves "Delete my account" **disabled** (no mis-enable).
- **SC-4.** When NO real email is resolvable (`resolveUserEmail` returns null), Step 3 enters `keyword` mode: no blank "YOUR EMAIL" box, title "Type DELETE to confirm", and typing `DELETE` (any case) enables the button; empty input keeps it disabled. The account is therefore always deletable.
- **SC-5.** A NEW business sign-in where `auth.users.email` is NULL but `user_metadata.email`/identity carries the real email persists that real email into `creator_accounts.email` (never `''`).
- **SC-6.** After the backfill migration, `creator_accounts.email` for `332e1733-af2b-49ca-8014-87d56f1b735e` equals `sethogievabelgium@gmail.com`, and the 2 ORCH-1108 test rows equal their respective real emails. Zero rows remain `''`.
- **SC-7.** No new `''` can be written to `creator_accounts.email` by `ensureCreatorAccount` (it writes a real email or NULL via `resolveUserEmail`).

---

## 6. Invariants

### Preserved
- **I-35** (`creator_accounts.deleted_at` is the soft-delete marker; self-write UPDATE RLS; recover-on-sign-in auto-clears). This fix changes only the **client confirmation gate** and the **email column value**, not the deleted_at write path, RLS, or recovery. Preserved by: the deletion mutation (`useAccountDeletion.ts`) is untouched; verified by SC-2/SC-4 reaching Step 4 via the same `requestDeletion()`.
- **I-NO-SILENT-FAILURES / Const #3** — `ensureCreatorAccount` still throws on upsert error; `resolveUserEmail` is pure (no swallowed error). Preserved.

### NEW (DRAFT — flips ACTIVE on CLOSE; orchestrator owns the flip)
- **I-PROPOSED-DELETE-CONFIRM-ALWAYS-REACHABLE** (DRAFT): *The business delete-account confirmation (delete.tsx Step 3) must remain reachable for every signed-in user — when no real email can be resolved, a `DELETE`-keyword fallback gates the destructive action; and the confirmation must never enable on an empty/blank input.* Verified by the adversarial regression test (§7 T-A2, §9).
- **I-PROPOSED-CREATOR-EMAIL-NEVER-EMPTY-STRING** (DRAFT): *`creator_accounts.email` is never written as the empty string `''` by client provisioning — `ensureCreatorAccount` resolves the best real email via `resolveUserEmail` and writes a real email or NULL.* Verified by §7 T-P1.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-P1 | provisioning: NULL auth email but identity/metadata email present | `User{ email:"", user_metadata:{email:"a@b.com"} }` | upsert row `email` === `"a@b.com"` | service |
| T-P2 | provisioning: no real email anywhere | `User{ email:"", user_metadata:{}, identities:[] }` | upsert row `email` === `null` (never `""`) | service |
| T-P3 | provisioning: real `user.email` present | `User{ email:"x@y.com" }` | upsert row `email` === `"x@y.com"` (unchanged behavior) | service |
| T-R1 | resolver: empty `user.email`, metadata email | `{email:"", user_metadata:{email:"M@x.com"}}` | returns `"M@x.com"` | util |
| T-R2 | resolver: empty everywhere | `{email:"  ", user_metadata:{}, identities:[{identity_data:{email:""}}]}` | returns `null` | util |
| T-R3 | resolver: only identity email | `{email:undefined, identities:[{identity_data:{email:"i@x.com"}}]}` | returns `"i@x.com"` | util |
| T-G1 (happy, fails-on-revert) | gate enables on real email match when auth email is blank | resolvedEmail `"a@b.com"`, typed `"A@B.COM"` | `confirmMatches` true → button enabled | component |
| T-A1 (adversarial) | gate must NOT enable on blank input when stored email is empty | resolvedEmail `"a@b.com"` (or `null`), typed `""` | `confirmMatches` false → button disabled | component |
| T-A2 (adversarial) | gate reachable via keyword when no email resolvable | resolvedEmail `null`, typed `"delete"` | `confirmMatches` true (keyword mode) → deletable | component |
| T-M1 | backfill corrects affected row | run migration | `creator_accounts.email` for `332e1733…` === real email; 0 rows `''` | db |

---

## 8. Implementation order

1. **Util** — create `mingla-business/src/utils/resolveUserEmail.ts` (§4.1).
2. **Service** — edit `mingla-business/src/services/creatorAccount.ts` to use `resolveUserEmail(user)` (§4.2).
3. **Component** — edit `mingla-business/app/account/delete.tsx`: add `resolvedEmail`/`confirmMode`/`confirmMatches`, rewrite `Step3Confirm` for the two modes, update call site + `handleConfirmDelete` (§4.3).
4. **Migration** — create `supabase/migrations/20260924000000_orch_1110_backfill_creator_account_email.sql` (§4.4).
5. **Tests** — author T-P1/T-P2 (extend `creatorAccountEnsure.test.ts`), T-R1..T-R3 (new `resolveUserEmail.test.ts`), T-G1/T-A1/T-A2 (new `deleteAccountGate.test.ts` — unit-test the `confirmMatches`/`resolveUserEmail` logic; the gate logic must be extracted or tested via a thin exported helper so it is unit-testable without a full RN render). T-M1 is a manual/SQL verification at CLOSE.
6. **Apply migration** — at IMPLEMENT/CLOSE, via CLI or Supabase Management API (NOT during SPEC).

> **Testability note for the implementor:** to unit-test the gate without rendering RN, extract the match logic into a tiny pure exported function (e.g. `export function computeConfirmMatches(mode, resolvedEmail, typed): boolean` in `resolveUserEmail.ts` or a sibling `deleteConfirm.ts`), and have `delete.tsx` call it inside the `useMemo`. This makes T-G1/T-A1/T-A2 pure-function tests (no RN renderer needed) and is the fails-on-revert anchor.

---

## 9. Regression prevention — fails-on-revert contract

**Structural safeguard:** the gate logic and the email resolution both live in pure, exported, unit-tested functions (`resolveUserEmail` + `computeConfirmMatches`). The blank-email trap cannot recur silently because:

- **T-G1 (happy-path, MUST fail on revert):** asserts that with `auth.users.email` blank but a resolvable real email, `computeConfirmMatches("email", "a@b.com", "A@B.COM")` is `true`. **Reverting** the fix (restoring `user.email ?? ""` comparison) makes the resolved email blank → the match returns `false` → **T-G1 FAILS**. Restoring the fix → **PASSES**.
- **T-A2 (adversarial, different angle, MUST fail on revert):** asserts that when `resolveUserEmail` returns `null`, the gate enters keyword mode and `computeConfirmMatches("keyword", null, "delete")` is `true` (account stays deletable). Reverting to the old single-mode email gate (no keyword fallback) → no path enables the button → **T-A2 FAILS**.
- **T-A1 (adversarial):** empty input never enables — guards the mis-enable direction the old `"" === ""` bug allowed.
- **T-P1 (provisioning):** asserts the seed writes a real email, not `""`, when auth email is blank — reverting `creatorAccount.ts` to `user.email ?? null` makes the upsert write `""` → **T-P1 FAILS**.

**Protective comments:** each fix site carries a one-line `// ORCH-1110: …` comment explaining the empty-string-is-absent rule and pointing at this SPEC, so a future edit doesn't reintroduce a bare `?? ""` / `?? null` on the email.

---

## 10. Open questions & discoveries

### Open questions (need orchestrator/Seth steering)
- **OQ-1.** Keyword fallback token: SPEC chose `DELETE` (case-insensitive). Acceptable, or prefer a different word? Default = `DELETE` if no objection.
- **OQ-2.** Should the backfill also normalize any FUTURE blank rows via a periodic job, or is the one-time backfill + provisioning fix sufficient? SPEC's position: provisioning fix prevents new blanks, so one-time backfill is sufficient — no cron. Confirm.

### Discoveries for Orchestrator (NOT fixed here)
- **D-1.** `auth.users.email = NULL` for the Google OAuth user (`332e1733…`) originates in the **consumer-app Google OAuth callback / GoTrue provisioning** (first signup 2026-06-01, consumer-side). Only 1 user app-wide has a null auth email — not systemic. The consumer `profiles.email` is correct, so the consumer app is not visibly broken, but the **null `auth.users.email` is the upstream data anomaly** that this business-app fix works around. Recommend a separate INVESTIGATE into why the consumer OAuth callback didn't propagate the identity email to `auth.users.email`.
- **D-2.** `delete.tsx:365` hardcodes `formatCurrency(preview.totalRevenueGbp, "GBP")` — a GBP currency assumption inconsistent with the de-GBP-ify direction (ORCH-1034). OUT of scope per dispatch; logged for a future currency-sweep ORCH. **DO NOT TOUCH in ORCH-1110.**
- **D-3.** The 2 ORCH-1108 test rows have `creator_accounts.email = NULL` despite `auth.users.email` being populated (email-OTP accounts). This suggests `ensureCreatorAccount`'s `ignoreDuplicates` short-circuited a row that was inserted by a different/earlier path before the email was available, OR a row pre-existed. Not a production-user issue; the backfill corrects them. Noted only.

---

## 11. Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY change ONLY these)
- `mingla-business/src/utils/resolveUserEmail.ts` (NEW — incl. optional `computeConfirmMatches` helper)
- `mingla-business/src/services/creatorAccount.ts` (edit line 37 region only)
- `mingla-business/app/account/delete.tsx` (Step 3 gate + Step3Confirm + call site + handleConfirmDelete deps)
- `supabase/migrations/20260924000000_orch_1110_backfill_creator_account_email.sql` (NEW)
- `mingla-business/src/utils/__tests__/resolveUserEmail.test.ts` (NEW)
- `mingla-business/src/utils/__tests__/deleteAccountGate.test.ts` (NEW — or co-located)
- `mingla-business/src/services/__tests__/creatorAccountEnsure.test.ts` (extend with T-P1/T-P2)

### DO-NOT-TOUCH
- `mingla-business/src/context/AuthContext.tsx` — **no change needed.** The `user` exposed by `useAuth()` is the raw Supabase `User`; the fix resolves the email at the consumption sites (delete.tsx, creatorAccount.ts) via `resolveUserEmail`, not by rewriting AuthContext's `setUser`. (Rewriting `setUser` to inject a synthesized email would fabricate data onto the auth object and risk every other `user.email` consumer — Constitution rule 9. Keep AuthContext pure.)
- `mingla-business/src/hooks/useAccountDeletion.ts` — deletion mutation gates on `user.id`; no email logic; unchanged.
- `delete.tsx:365` `formatCurrency(..., "GBP")` — out of scope (D-2).
- Any consumer-app (`app-mobile/`) file — out of scope.
- RLS policies, `creator_accounts` schema/constraints — no DDL.

**Stop-and-amend rule:** the implementor MUST request a SPEC amendment (append in-file or `SPEC_AMENDMENT_ORCH-1110_*.md`) before touching anything outside the allowlist.

---

## 12. Downstream routing

**Next = mingla-implementor (business side).** Inputs: this SPEC + the live forensic findings embedded above. Worktree: `~/Desktop/mingla-orchs/ORCH-1110-[blank-email-undeletable-account]/` on branch `ORCH-1110-blank-email-undeletable-account` (already rebased on origin/main). Build §8 order; author the two required regression tests (T-G1 happy fails-on-revert + T-A1/T-A2 adversarial) per CLOSE Step 0.5; prove fails-on-revert; apply the migration via CLI or Management API. **Then = mingla-tester** (device/sim repro: open Delete → Step 3 on a business build, confirm real email shows + button enables on match + blank stays disabled + keyword fallback reachable). **Then = orchestrator CLOSE** (flip the two DRAFT invariants ACTIVE, sweep artifacts, deploy/OTA per the OTA-per-platform rule).
