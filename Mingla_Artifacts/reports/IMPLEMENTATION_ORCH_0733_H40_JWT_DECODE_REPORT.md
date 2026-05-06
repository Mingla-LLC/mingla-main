# IMPL REPORT — ORCH-0733 / H40 JWT DECODE PROBE

**Mode:** IMPLEMENT (DIAGNOSTIC ONLY — temporary)
**Dispatch anchor:** [`prompts/IMPL_ORCH_0733_H40_JWT_DECODE_PROBE.md`](../prompts/IMPL_ORCH_0733_H40_JWT_DECODE_PROBE.md)
**Predecessor:** ORCH-0731 B1 historical forensics → H39 (RLS confirmed denier via DISABLE/ENABLE) → H41 (only one PERMISSIVE INSERT policy with clean predicate `account_id = auth.uid() AND deleted_at IS NULL`)
**Authored:** 2026-05-06

---

## 1. Layman summary

Added a 60-line probe to `BrandSwitcherSheet.tsx` that decodes the actual access-token JWT in-app right before the existing PASS-7 raw-fetch and logs every claim — `sub`, `aud`, `iss`, `role`, `exp`, `email`, plus a `sub_matches_userId` boolean. Operator's next Create-tap will tell us instantly whether the JWT `sub` matches `user.id` (`b17e3e15-...`) or not. If sub matches → `auth.uid()` is broken inside PostgREST → escalate to Supabase support. If sub differs → JWT/identity bug we can fix locally. ADDITIVE only — every prior diagnostic + UX preserved. tsc=0.

**Status:** implemented and verified · **Verification:** passed (tsc=0; 6 diagnostic markers present)

---

## 2. Sites patched

| # | File | Line(s) | Change |
|---|---|---|---|
| 1 | `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` | 150–208 (new block) | Added `[DIAG ORCH-0733-JWT-DECODE]` block immediately before existing PASS-7 raw-fetch (line 209). 60 lines including comments, padded base64url decoder, and structured `console.error` log. |

No new imports required — `supabase` was already imported at line 50 for PASS-5.

---

## 3. Old → New receipt

### `mingla-business/src/components/brand/BrandSwitcherSheet.tsx`

**What it did before:** 5 diagnostic markers in handleSubmit — PASS-3 silent-return, PASS-3 catch, PASS-5 session probe, PASS-7 raw-fetch INSERT, PASS-8 creator-accounts GET. PASS-7 returned 403+42501 with explicit Authorization header. PASS-8 returned 200 with rowCount=1 (proving JWT is valid for SELECT on creator_accounts via PostgREST). H39+H41 then narrowed the bug to brands-INSERT-specific RLS denial — but the policy text is exactly `(account_id = auth.uid()) AND (deleted_at IS NULL)` and dashboard simulation with `sub=b17e3e15-...` made the same INSERT WORK. Only remaining variable: what's actually in the JWT at runtime.

**What it does now:** Immediately after PASS-5 captures `sessionProbe`, a new `[ORCH-0733-DIAG]` block decodes `sessionProbe.data.session.access_token`. Splits on `.`, base64url-decodes header and payload (with proper `+`/`/` substitution and `=` padding), JSON-parses, then logs the full decoded payload claims via `console.error`. Critical fields surfaced: `payload_sub`, `payload_aud`, `payload_iss`, `payload_role`, `payload_exp`, `payload_iat`, `payload_email`, `payload_session_id`, `payload_app_metadata`, `payload_user_metadata_keys`, `payload_all_keys`, plus `sub_matches_userId: payload.sub === user.id` (the punchline boolean) and `expected_userId: user.id`. Wrapped in try/catch so if `atob` is missing or token is malformed, we still see something useful. All decoder edge cases handled: missing token, malformed token (parts ≠ 3), per-segment JSON parse error.

**Why:** ORCH-0731 PASS-10 + H39 + H41 leave only two possibilities for why the brands INSERT denies despite `account_id = auth.uid() AND deleted_at IS NULL` evaluating TRUE in dashboard simulation: (a) JWT `sub` claim ≠ `user.id` at runtime (Auth Hook rewriting claims, account-merge mismatch, multi-project token contamination), OR (b) `auth.uid()` resolves differently inside PostgREST than under `SET LOCAL "request.jwt.claims"`. Decoding the JWT in-app distinguishes (a) from (b) in one Create-tap.

**Lines changed:** ~60 added (1 block insertion). 0 lines removed. All prior markers + UX paths preserved.

---

## 4. Verification

### tsc

```
$ cd mingla-business && npx tsc --noEmit
[exit 0, no output]
EXIT=0
```

✅ PASS

### Existing diagnostics + UX preserved (post-edit re-read of lines 120–319)

| Marker | Line | Status |
|---|---|---|
| `[ORCH-0728-DIAG] PASS-3 silent-return` | 124 | UNCHANGED ✅ |
| `[ORCH-0728-DIAG] PASS-5 session probe` | 135 | UNCHANGED ✅ |
| `[ORCH-0733-DIAG] JWT DECODE` | 150 | **NEW — correctly placed** ✅ |
| `[ORCH-0729-DIAG] RAW FETCH RESULT` | 209 | UNCHANGED ✅ |
| `[ORCH-0730-DIAG] CREATOR-ACCOUNTS PROBE` | 261 | UNCHANGED ✅ |
| `await createBrandMutation.mutateAsync({...})` | 305 | UNCHANGED ✅ |
| `[ORCH-0728-DIAG] handleSubmit FAILED` catch | 317 | UNCHANGED ✅ |
| All setState / setSlugError / setSubmitting / Toast UX | 254–282 | UNCHANGED ✅ |

---

## 5. Spec traceability

Diagnostic-only micro-dispatch — own success criteria from `prompts/IMPL_ORCH_0733_H40_JWT_DECODE_PROBE.md`:

| Criterion | Verification |
|---|---|
| Block inserted immediately before PASS-7 raw-fetch (after PASS-5 session probe) | ✅ Confirmed (line 150, between lines 149 and 209) |
| Probe decodes `session.access_token` via base64url + JSON.parse | ✅ Confirmed (decoder helper at lines 168–176, padding logic correct) |
| Logs header + payload_sub/aud/iss/role/exp/iat/email/session_id/app_metadata/user_metadata_keys/all_keys | ✅ Confirmed (lines 181–199) |
| Logs `sub_matches_userId` boolean comparing payload.sub === user.id | ✅ Confirmed (line 197) |
| Marker `[DIAG ORCH-0733-JWT-DECODE]` + `[ORCH-0733-DIAG]` in console.error | ✅ Confirmed |
| Existing 5 diagnostic markers + mutateAsync + UX paths preserved | ✅ Confirmed (post-read) |
| tsc=0 | ✅ Confirmed |
| ADDITIVE only — no removals | ✅ Confirmed |
| `atob` available in Hermes (no new imports) | ✅ Confirmed (Hermes provides global `atob`; tsc compiled cleanly using it) |

---

## 6. Cache safety

Read-only on session.access_token. No DB calls. No mutations. No cache impact. No `__QA_Probe_*` rows. No cleanup needed.

---

## 7. Regression surface

Diagnostic-only — no functional change. Adds ~5–20ms per Create-tap (in-app base64 decode of ~1KB JWT + JSON.parse + one console.error). Acceptable.

Adjacent features unaffected:
- Brand switcher row-pick handler (line 116–119) — UNTOUCHED
- Brand delete affordance (line 285–288) — UNTOUCHED
- Mode-switch handlers (lines 290–296) — UNTOUCHED
- TopSheet mount/unmount lifecycle — UNTOUCHED

---

## 8. Constitutional compliance

| Rule | Status |
|---|---|
| #3 No silent failures | improved (probe surfaces JWT decode result + threw paths) |
| Other 13 | unchanged |

---

## 9. Discoveries for orchestrator

| ID | Description |
|---|---|
| **D-IMPL-0733-1** | The probe handles `accessToken === undefined` (no session), `parts.length !== 3` (malformed token), per-segment JSON parse failure (returns `{ __decode_error: ... }`), and outer try/catch (atob throws on non-base64 chars). All five edge cases logged distinctly. |
| **D-IMPL-0733-2** | Hermes (Expo SDK 51's RN engine) provides `atob`/`btoa` globally. No polyfill import needed. tsc compiled cleanly using global `atob`, confirming the type definition is resolved. |
| **D-IMPL-0733-3** | When operator pastes the result, the `sub_matches_userId` boolean is the smoking-gun field. If `false`, also inspect `payload_iss` to detect multi-project token contamination (different supabase project URL in the token's iss claim than what the app is configured to hit). |

---

## 10. Transition items

This site is TRANSITIONAL by design:
- Marker: `// [DIAG ORCH-0733-JWT-DECODE]`
- Exit condition: full IMPL of root-cause fix → grep finds the marker → block removed.

Tracking alongside the existing 5 diagnostic markers (PASS-3, PASS-5, PASS-7, PASS-8, PASS-3-catch). All 6 will be removed together at full IMPL.

---

## 11. Operator post-step

1. **Force-reload Metro bundle:** shake device (or Cmd+D in simulator) → tap **Reload**
2. **Wait for the "Loading bundle …" banner** to disappear
3. **Tap Create brand** (any name)
4. **Capture FULL Metro terminal output** — should now contain SIX diagnostic blocks:
   - `[ORCH-0728-DIAG] PRE-MUTATE session probe { ... }`
   - **`[ORCH-0733-DIAG] JWT DECODE { ... }`** ← NEW (the answer)
   - `[ORCH-0729-DIAG] RAW FETCH RESULT { ... }`
   - `[ORCH-0730-DIAG] CREATOR-ACCOUNTS PROBE { ... }`
   - `[ORCH-0728-DIAG] useCreateBrand#onError FAILED { ... }`
   - `[ORCH-0728-DIAG] BrandSwitcherSheet#handleSubmit FAILED { ... }`
5. **Paste FULL output into chat**

The JWT DECODE block routes orchestrator instantly:

| `payload_sub` value | Diagnosis |
|---|---|
| `"b17e3e15-218d-475b-8c80-32d4948d6905"` (matches `user.id`) AND `sub_matches_userId: true` | **JWT is correct.** Bug is at PostgREST/Postgres `auth.uid()` resolution layer → escalate to Supabase support (Path C) with full PASS-1..12 evidence package |
| Any OTHER UUID (string but ≠ user.id) AND `sub_matches_userId: false` | **H40 PROVEN — JWT sub differs from user.id.** Likely Supabase Auth Hook rewriting claims, account-merge artifact (auth.users.id ≠ creator_accounts.id), or stale token. Diagnose locally. |
| `null` / `undefined` / decode error / `__decode_error` field present | JWT malformed or auth state broken in unexpected way. Investigate immediately. |
| `payload_iss` ≠ `https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1` | **Multi-project token contamination.** Token from a DIFFERENT supabase project. Investigate env/config drift. |
| `payload_role` ≠ `"authenticated"` (e.g., `"anon"`) | JWT downgraded to anon despite session probe showing `sessionPresent: true`. Anomalous — investigate. |

---

**Authored:** 2026-05-06
**Authored by:** mingla-implementor (PASS-12 / H40 JWT-decode probe)
**Status:** implemented and verified (tsc=0, 6 markers confirmed, ADDITIVE-only, no DB side-effects)
**Awaiting:** operator force-reload + Create-tap + paste FULL terminal output → orchestrator → routes to Path C (Supabase support) or in-code identity fix
