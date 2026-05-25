# REVIEW — ORCH-0963 SPEC

**Reviewer:** Claude `mingla-orchestrator`
**Date:** 2026-05-25
**Subject:** `Mingla_Artifacts/specs/SPEC_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` @ commit `39599c141`
**Verdict:** **APPROVED** with two implementor-checklist notes (not blockers).

---

## REVIEW gate checklist

| Gate | Verdict | Evidence |
|---|---|---|
| Root cause proven or just plausible? | **Proven** | INVESTIGATE F-1..F-7 cite file:line + DB data; ORCH-0859 REWORK 3 TODO comment is the smoking gun at `publicEventsService.ts:691`. |
| Scope appropriate — could be narrower? | **Appropriate** | Single surface (buyer-web). Event-brand polish (F-5) bundled per operator Decision 2; out-of-scope items named explicitly (consumer iOS/Android, trip-creation, paid-trip checkout, brand-edit audit, theme tokens). |
| Hidden fallback paths that mask failure? | **None** | Spec §3.4 explicitly forbids "null spots left"; T-05 adversarial guards. SC-14 covers empty trip list. No `?? fakeValue` fabrication. |
| Stale cache paths serving old data? | **N/A** | Query key unchanged (`publicEventKeys.brandBySlug(slug)`); server-side dispatch keeps cache coherent. React Query staleTime unchanged at 45s. |
| Response shape truthful in ALL states (loading, error, empty, populated)? | **Yes** | SC-14 (empty trip list), SC-15 (populated event list), SC-2 (null spotsLeft → no badge), SC-8 (verified-venue regression guard). Loading/error states inherited from `PublicBrandRoute` unchanged. |
| Real fix or symptom mask? | **Real** | Architectural branch + new server-side read path. Not papering over the missing data path. |
| Solo/collab parity checked? | **N/A** | Buyer-anon route, no auth, no collab mode. |
| Constitutional compliance verified? | **Yes** | §5 enumerates #1, #9, #10 preserved; I-38, I-39 satisfied for new Pressables. |
| Evidence chain complete? | **Yes** | INVESTIGATE → SPEC commits on per-ORCH branch (`a60204e32` + `bd6b2d9fe` + `39599c141`). |
| Documents updated? | **Yes** | WORLD_MAP + OPEN_INVESTIGATIONS + WORKTREE_REGISTRY rows added at INTAKE commit `66fd5d4e0`. |

### Commit-hash verification (mandatory per DEC-179 / ORCH-0959)

| File | Commit on branch `ORCH-0963-public-brand-page-events-vs-trip` |
|------|---------------------------------------------------------------|
| `Mingla_Artifacts/specs/SPEC_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` | `39599c141` ✓ |
| `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` | `bd6b2d9fe` (updated from `a60204e32`) ✓ |
| `Mingla_Artifacts/evidence/probe_brand_pages.mjs` + `f1_*.{png,html,json}` | `a60204e32` ✓ |
| `Mingla_Artifacts/prompts/FORENSICS_ORCH-0963_PUBLIC_BRAND_PAGE_EVENTS_VS_TRIP.md` | `66fd5d4e0` ✓ |
| `Mingla_Artifacts/OPEN_INVESTIGATIONS.md` row | `66fd5d4e0` ✓ |
| `Mingla_Artifacts/WORLD_MAP.md` row | `66fd5d4e0` ✓ |
| `Mingla_Artifacts/WORKTREE_REGISTRY.md` row | `66fd5d4e0` ✓ |

`git status --porcelain` clean on per-ORCH branch. No modified-but-uncommitted artifacts.

### Dependency walk for config-layer changes (mandatory per DEC-179 / ORCH-0959)

The SPEC describes touches to two config-layer files:

1. **`.github/workflows/strict-grep-mingla-business.yml`** — SPEC §3.6 adds one new job for the new gate `orch-0963-public-brand-kind-branched.mjs`.
   - **Consumers:** GitHub Actions CI only. No application code parses this YAML.
   - **Compatibility:** purely additive. YAML jobs are independent; adding a job below existing jobs cannot break existing jobs.
   - **Verdict:** safe.
2. **`.github/scripts/strict-grep/`** — SPEC §3.6 adds new file `orch-0963-public-brand-kind-branched.mjs`; SPEC §11 + §7-step-9 require updating `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` `ORCH_0963_BACKEND_ALLOWLIST` constant in the same commit as the new migration + RPC files.
   - **Consumers:** the orch-0863 gate is run as a required check on every PR (per COMMS-0002). If the allowlist isn't updated, the PR fails C7 `no-new-backend-files`.
   - **Compatibility:** new constant `ORCH_0963_BACKEND_ALLOWLIST` is additive to the script. Allowlist files are listed in `ORCH_0963_BACKEND_ALLOWLIST = ['supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql']`. Standard pattern, mirrors existing ORCH_0869/0875/0876/0877/0879/0880/0881/0891/0898/0902-0903 entries.
   - **Verdict:** safe IF implementor updates orch-0863 allowlist in same commit. Flagged in implementor checklist below.

No other config-layer files (`app.json`, `app.config.ts`, `package.json`, `tsconfig.json`, `vercel.json`, `metro.config.*`, `babel.config.*`, `next.config.*`) are touched.

### COMMS-LEDGER acks for this turn

- **COMMS-0001** — to ORCH-0955 only. Not in scope for ORCH-0963.
- **COMMS-0002** — to ALL (ORCH-0863 strict-grep gate blocks backend PRs). **Acknowledged + factored in** — implementor MUST update `ORCH_0963_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs` in the same commit as the migration. Note in implementor checklist below.
- **COMMS-0003** — to ALL (external-API docs verified). **N/A** — ORCH-0963 has zero external-API touches (confirmed in SPEC §9). Ack as not-applicable.
- **COMMS-0004** — to ALL (INTAKE must scan WORLD_MAP). **Acknowledged + already complied** — ORCH-0963 INTAKE scan at `66fd5d4e0` checked WORLD_MAP (highest = ORCH-0960), MASTER_BUG_LIST, OPEN_INVESTIGATIONS, COMMS_LEDGER, and active worktrees (ORCH-0954/0961/0962/0964) before claiming the ID. No collision.

### Cross-ORCH coordination — COMMS-0005 (TO WRITE)

Per investigation D-5: ORCH-0964 [public-page theme customization] is editing the same file (`PublicBrandPage.tsx`) in parallel. ORCH-0963 SPEC explicitly carves out scope (does not touch `<Head>`, theme tokens, fonts, animations). The two ORCHs will merge cleanly because they touch non-overlapping sections of the same file. **Action this REVIEW turn:** write COMMS-0005 to main from clean anchor checkout, naming the files ORCH-0963 will change so ORCH-0964 can rebase awareness.

## Implementor checklist (additive to SPEC §7 implementation order)

These are NOT REVIEW gaps in the SPEC; they're implementor reminders that fall out of the cross-ORCH context this REVIEW surfaced:

1. **Update `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`** — add `ORCH_0963_BACKEND_ALLOWLIST = ['supabase/migrations/20260728000000_orch_0963_pg_public_trips_by_brand.sql']` (and any sibling tests under `supabase/migrations/__tests__/`) in the SAME commit as the new migration. Failure to do this breaks the no-new-backend-files gate on the PR. Per COMMS-0002 + memory rule "CLOSE Step 2 pre-commit checks".
2. **Grep sibling worktrees before locking migration prefix:** `ls ~/Desktop/mingla-orchs/*/supabase/migrations/` and confirm no other worktree is using `20260728*`. If collision, bump to `20260728000001`.
3. **`tripPublicPath` import** — already exists in `mingla-business/src/constants/publicUrls.ts:71`; implementor doesn't need to create it, just import.
4. **`EventCoverMedia` accepts `hue` prop already** (verified `mingla-business/src/components/ui/EventCoverMedia.tsx`). For cover-less trips, derive deterministic hue from trip.id via a small helper.

## Verdict: **APPROVED**

SPEC is ready for IMPLEMENT phase. Two pre-implement actions are mine to execute this turn:
1. Write COMMS-0005 cross-ORCH coordination entry from clean anchor.
2. Hand off to implementor (Codex `implementor-mingla` per default routing, or Claude `mingla-implementor` if operator redirects).
