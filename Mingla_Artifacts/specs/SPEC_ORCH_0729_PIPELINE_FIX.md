# SPEC — ORCH-0729 PIPELINE FIX (unified)

**Status:** SUPERSEDES `SPEC_ORCH_0728_FULL_FIX.md` (carries all 4 scopes forward + adds Scope E for F-10c verified fix + 2 new invariants)
**Investigation anchor:** [`reports/INVESTIGATION_ORCH_0729_BRUTAL_PIPELINE_AUDIT.md`](../reports/INVESTIGATION_ORCH_0729_BRUTAL_PIPELINE_AUDIT.md)
**Authored:** 2026-05-06

---

## 1. Layman summary

Five scopes in one IMPL landing:
- **Scope A** — brand-create fix (covers F-10c PROVEN fix once raw-fetch probe disambiguates)
- **Scope B** — logError primitive + 14 site migrations + CI gate + I-PROPOSED-D ACTIVE
- **Scope C** — dev-build hygiene: build-info footer + force-reload runbook
- **Scope D** — stub-brand purge: persist migrate v13→v14 + delete brandList.ts + reapOrphanStorageKeys allowlist fix + I-PROPOSED-E ACTIVE
- **Scope E (NEW)** — pipeline-wide regression prevention: I-PROPOSED-F JWT-PROJECT-MATCH + I-PROPOSED-G ALL-RLS-MUTATIONS-AUDITED

After full IMPL: brand-create works, every other RLS-gated mutation works, ~50 silent-failure sites have structured terminal logs, stub-brand state ghosts are purged, and structural CI gates prevent recurrence of the entire failure class.

---

## 2. Scope + non-goals + assumptions

### IN

- All 4 scopes from `SPEC_ORCH_0728_FULL_FIX.md` carry forward UNCHANGED (Scope A includes PASS-4 amendments §3.4-A proactive session-refresh + §3.9-A reapOrphanStorageKeys allowlist fix)
- NEW: F-10c specific fix (depends on raw-fetch probe outcome — TWO possible paths spec'd below)
- NEW: I-PROPOSED-F build-time JWT-PROJECT-MATCH check
- NEW: I-PROPOSED-G ALL-RLS-MUTATIONS-AUDITED catalog

### OUT

- Cycle 14 account-soft-delete cascade-into-brands (still deferred per A-2)
- Subsequent ~40 logging sites (ORCH-0728-followup)
- Sentry/DataDog remote-sink integration (interface reserved only)

### Assumptions

- **A-1** Raw-fetch probe (PASS-8 implementor sub-step) determines F-10c PROVEN vs REJECTED before this spec's full IMPL fires.
- **A-2** If F-10c PROVEN: fix is `await supabase.auth.refreshSession()` before mutateAsync (already in PASS-4 amendment §3.4-A) + supabase-js version pin / upgrade.
- **A-3** If F-10c REJECTED: this spec's Scope A expands; orchestrator escalates to a separate ORCH for the deeper auth issue.

---

## 3. Layer-by-layer specification

### 3.1 Carries from SPEC_ORCH_0728_FULL_FIX.md (UNCHANGED)

§3.1 Database NOTIFY pgrst follow-up · §3.2 logError primitive · §3.3 humanizeBrandError · §3.4 BrandSwitcherSheet auth-not-ready disabled-button · §3.4-A PASS-4 amendment proactive session-refresh · §3.5 useBrands.ts hook migrations (4 sites) · §3.6 Service + context migrations (10 sites) · §3.7 CI gate i-proposed-d-mb-error-coverage · §3.8 Persist migrate v13→v14 · §3.9 Delete brandList.ts · §3.9-A PASS-4 amendment reapOrphanStorageKeys allowlist fix · §3.10 Build-info footer · §3.11 Migration discipline runbook.

### 3.2 NEW — Scope A F-10c specific fix (depends on probe)

#### Path P-1: F-10c PROVEN (raw-fetch succeeds, supabase-js fails)

Apply ALL of:

1. **Upgrade `@supabase/supabase-js`** from 2.74.0 to latest stable (verify changelog for session-attach fixes between 2.74 and current).
2. **Proactive session-refresh** (carry from PASS-4 amendment §3.4-A) — applies to BrandSwitcherSheet, BrandEditView, BrandDeleteSheet, Stripe Connect onboard.
3. **Defensive: explicit setSession** — after `await supabase.auth.getSession()`, call `await supabase.auth.setSession({ access_token, refresh_token })` to force-refresh internal state. Apply only at handleSubmit prefix.
4. **Global fetch interceptor (LAST RESORT)** — if upgrading supabase-js doesn't resolve, add a custom fetch wrapper in `src/services/supabase.ts` that forces `Authorization: Bearer <session.access_token>` on every PostgREST request. Spec'd here for completeness:

```ts
// supabase.ts — global config (LAST RESORT only)
import { fetch as expoFetch } from "expo/fetch";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
  global: {
    fetch: async (input, init) => {
      const session = (await supabase.auth.getSession()).data.session;
      const headers = new Headers(init?.headers);
      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
      }
      headers.set("apikey", supabaseAnonKey);
      return expoFetch(input as string, { ...init, headers });
    },
  },
});
```

This is heavy-handed but guarantees the header attachment.

#### Path P-2: F-10c REJECTED (raw-fetch ALSO returns 42501)

Investigation expands. Spec defers Scope A entirely and orchestrator dispatches a NEW ORCH for the deeper auth issue. ORCH-0728 + 0729 close this scope as "diagnostic improvements landed; further auth investigation continues".

### 3.3 NEW — Scope E.1 — I-PROPOSED-F JWT-PROJECT-MATCH (build-time check)

Add a build-time check in `app.config.ts` (runs every `npx expo start` / `eas build`):

```ts
// At top of app.config.ts (after imports, before const declarations)
function decodeAnonKeyRef(anonKey: string): string | null {
  try {
    const parts = anonKey.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    return typeof payload.ref === "string" ? payload.ref : null;
  } catch {
    return null;
  }
}
function extractProjectRefFromUrl(url: string): string | null {
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : null;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
if (supabaseUrl && supabaseAnonKey) {
  const urlRef = extractProjectRefFromUrl(supabaseUrl);
  const keyRef = decodeAnonKeyRef(supabaseAnonKey);
  if (urlRef && keyRef && urlRef !== keyRef) {
    throw new Error(
      `[I-PROPOSED-F] EXPO_PUBLIC_SUPABASE_URL project ref "${urlRef}" does not match EXPO_PUBLIC_SUPABASE_ANON_KEY ref "${keyRef}". Refusing to build.`
    );
  }
}
```

This catches F-10a class regressions at BUILD time. Build fails fast if env vars drift.

### 3.4 NEW — Scope E.2 — I-PROPOSED-G ALL-RLS-MUTATIONS-AUDITED

Catalog at `Mingla_Artifacts/RLS_AUDIT.md`:

| Surface | File | Operation | RLS check | Test that proves it works |
|---|---|---|---|---|
| ensureCreatorAccount upsert | services/creatorAccount.ts | INSERT/UPDATE creator_accounts | `auth.uid() = id` | Operator can sign in fresh + ensureCreatorAccount succeeds (auto via AuthContext bootstrap) |
| updateCreatorAccount edit-profile | services/creatorAccount.ts | UPDATE creator_accounts | `auth.uid() = id` | Operator can edit display_name in app |
| Brand create | services/brandsService.ts:createBrand | INSERT brands | `account_id = auth.uid() AND deleted_at IS NULL` | Operator can create a new brand |
| Brand list | services/brandsService.ts:getBrands | SELECT brands | `(deleted_at IS NULL) AND biz_is_brand_member_for_read_for_caller(id)` | List populates with operator's brands |
| Brand edit | services/brandsService.ts:updateBrand | UPDATE brands | `biz_is_brand_admin_plus_for_caller(id)` | Edit save works |
| Brand soft-delete | services/brandsService.ts:softDeleteBrand | UPDATE brands SET deleted_at | `biz_is_brand_admin_plus_for_caller(id)` | Delete from BrandDeleteSheet works |
| Brand cascade preview | hooks/useBrands.ts:useBrandCascadePreview | SELECT counts events/team/stripe | various | Preview renders accurate counts |
| Brand team invite | components/team/InviteBrandMemberSheet.tsx | INSERT brand_invitations | `biz_is_brand_admin_plus_for_caller(brand_id)` | Invite send works |
| Event create | (Cycle 3+ wizard) | INSERT events | `biz_is_brand_admin_plus_for_caller(brand_id)` (likely — verify in code) | Event create wizard finalizes |
| Event edit | (Cycle 3+ edit) | UPDATE events | `biz_is_brand_admin_plus_for_caller(brand_id)` | Event edit save works |
| Event ticket tier | (Cycle 3+ tier setup) | INSERT event_ticket_tiers | brand-admin chain | Tier setup works |
| Account soft-delete | hooks/useAccountDeletion.ts:requestDeletion | UPDATE creator_accounts SET deleted_at | `auth.uid() = id` | Account-delete flow works |
| Account recovery | hooks/useAccountDeletion.ts:tryRecoverAccountIfDeleted | UPDATE creator_accounts SET deleted_at = NULL | `auth.uid() = id` | Auto-recovery on next sign-in (proven by audit log) |

Future ORCH-IDs that add new RLS-gated mutations MUST update this catalog.

### 3.5 Updated implementation order

1-19 carry from SPEC_ORCH_0728_FULL_FIX.md
20. NEW: I-PROPOSED-F build-time check in `app.config.ts`
21. NEW: I-PROPOSED-G `RLS_AUDIT.md` initial catalog
22. F-10c specific fix (P-1 path: supabase-js upgrade + proactive refreshSession + global fetch interceptor as last resort) — gated on raw-fetch probe outcome

**Estimated effort:** 7-9h (1-2h above ORCH-0728 estimate, mostly for F-10c fix + I-PROPOSED-F + RLS_AUDIT catalog)

---

## 4. Success criteria (ADDITIONS to ORCH-0728 spec)

| # | Criterion | Verification |
|---|---|---|
| **SC-A-7** | Brand-create succeeds end-to-end on fresh dev-build retest (post F-10c fix) | Operator runtime smoke |
| **SC-A-8** | Event-create succeeds end-to-end (verifies F-10c fix isn't brand-specific) | Operator runtime smoke (CreatorStep wizard finalize) |
| **SC-A-9** | Account-edit-profile succeeds (UPDATE creator_accounts) | Operator runtime smoke (account/edit-profile.tsx) |
| **SC-E-1** | I-PROPOSED-F build-time check exists in app.config.ts; building with mismatched URL+key throws Error | Manual: temporarily edit .env to mismatch + run `npx expo start` → expect Error |
| **SC-E-2** | RLS_AUDIT.md exists with ≥13 mutation entries | File read |
| **SC-E-3** | I-PROPOSED-F + I-PROPOSED-G entries in INVARIANT_REGISTRY.md as DRAFT | File read |

---

## 5. Test cases (ADDITIONS)

| Test | Scenario | Expected |
|---|---|---|
| T-34 | Build with matching URL + anon key | npx expo start succeeds |
| T-35 | Build with mismatched URL + anon key | Error thrown at config-resolve time |
| T-36 | Brand create after F-10c fix | 201 Created + brand visible in list |
| T-37 | Event create after F-10c fix | Event row in DB |
| T-38 | Account edit-profile after F-10c fix | UPDATE succeeds |

---

## 6. Invariants — preserved + new

### Preserved

(All from SPEC_ORCH_0728 — Const #1, #3, #5, I-PROPOSED-A, I-PROPOSED-C, I-PROPOSED-D, I-PROPOSED-E, I-17 — unchanged.)

### New

#### I-PROPOSED-F JWT-PROJECT-MATCH (DRAFT — flips ACTIVE on ORCH-0729 CLOSE)

**Statement:** Build-time check enforces that `EXPO_PUBLIC_SUPABASE_URL`'s project ref matches the `ref` claim in `EXPO_PUBLIC_SUPABASE_ANON_KEY`'s decoded JWT payload. Mismatch throws Error at `app.config.ts` resolve time, blocking the build.

**Scope:** mingla-business build pipeline. Future products with similar config drift risk should adopt the same pattern.

**Established by:** ORCH-0729 SPEC §3.3 + Scope E.

**EXIT condition:** None — permanent invariant. If Supabase migrates project from one ref to another, env vars must update together (this invariant catches partial updates).

#### I-PROPOSED-G ALL-RLS-MUTATIONS-AUDITED (DRAFT — flips ACTIVE on ORCH-0729 CLOSE)

**Statement:** Every RLS-gated mutation across mingla-business's 4 pipelines (account / brand / event / deletion) is cataloged in `Mingla_Artifacts/RLS_AUDIT.md` with file:line + RLS check + test. Future ORCH-IDs that add a new RLS-gated mutation MUST update this catalog as part of their CLOSE protocol.

**Scope:** mingla-business; expand to app-mobile + mingla-admin in future cycles.

**Established by:** ORCH-0729 SPEC §3.4 + Scope E.

**EXIT condition:** None — permanent invariant.

---

## 7. Operator-side runtime smoke (post-IMPL, pre-CLOSE)

| # | Test | Pass |
|---|---|---|
| 1 | Migration `20260506000002` applied + (if ORCH-0729 added migration) | DB confirms |
| 2 | I-PROPOSED-F check fires correctly on mismatched env | Manual |
| 3 | Brand create happy path | Brand created + multi-device sync |
| 4 | Brand edit happy path | Update succeeds |
| 5 | Brand delete (no events) | Soft-delete succeeds |
| 6 | Event create happy path | Event row appears |
| 7 | Account edit-profile | display_name updates |
| 8 | All catch sites surface terminal logs | Test by inducing failures |
| 9 | Cold-start with stub-brand currentBrand | Cleared by v13→v14 migrate |
| 10 | Build-info footer visible in __DEV__ | Visual |

---

## 8. Discoveries to register

| ID | Severity | Description |
|---|---|---|
| **D-ORCH-0729-SPEC-1** | NEW | Build-time JWT-PROJECT-MATCH check is generic; consider porting to app-mobile + mingla-admin |
| **D-ORCH-0729-SPEC-2** | NEW | RLS_AUDIT.md becomes the canonical reference for which mutations are RLS-gated; useful for future onboarding |
| **D-ORCH-0729-SPEC-3** | Forward | If F-10c is REJECTED post-probe, escalate to ORCH-0730 for deeper Supabase Auth investigation |

---

**Authored:** 2026-05-06
**Authored by:** mingla-forensics (PASS-7 / ORCH-0729 brutal pipeline spec)
**Status:** Spec complete; gated on F-10c raw-fetch disambiguation (PASS-8 implementor sub-step)
**Supersedes:** `SPEC_ORCH_0728_FULL_FIX.md` (carries all 4 scopes forward + adds Scope E)
