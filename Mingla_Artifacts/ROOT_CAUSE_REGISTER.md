# Root Cause Register

> Last updated: 2026-05-06
> Proven root causes with causal clusters.

## Root Causes

### RC-0728: RLS-RETURNING-OWNER-GAP — supabase-js mutations fail because no SELECT policy admits the post-mutation row
- **Discovery date:** 2026-05-06 (proven after 13 forensic passes ORCH-0728/0729/0731 + H39/H40/H41/H42)
- **Proof:** [reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH_0731_B1_HISTORICAL_FORENSICS.md) (PASS-10) + H39 (DISABLE/ENABLE RLS toggle confirmed RLS as denier) + H40 (JWT decode showed `sub === user.id` exactly — JWT not the bug) + H41 (pg_policies enumeration showed 5 policies on brands; only INSERT and UPDATE/DELETE policies for owners, NO owner-SELECT policy) + H42 (operator dashboard SQL: pure INSERT *without* RETURNING succeeded under simulated auth, while INSERT *with* RETURNING returned 42501 — definitive disambiguator). Brands-table relpages = 0 confirmed bug latent since B1 phase 2 cycle.
- **Symptoms caused:** Brand-create from `BrandSwitcherSheet` returns 42501 (operator-reported "create-brand glitch"). Brand-delete from `BrandDeleteSheet` exhibits identical 42501 (operator-confirmed 2026-05-06). Likely also blocks every other operator-facing mutation across mingla-business B1 tables (events, tickets, orders, brand_members, team_invitations) that hits an RLS-gated INSERT/UPDATE/DELETE — full audit pending under ORCH-0734.
- **Causal chain:**
  1. supabase-js `.insert(...).select()` / `.update(...).select()` / `.delete().select()` defaults to `Prefer: return=representation`.
  2. Postgres performs the mutation. WITH CHECK / USING predicates pass for the actor.
  3. Postgres processes the implicit RETURNING by evaluating SELECT policies on the post-mutation row state.
  4. For brands INSERT: no SELECT policy admits an owner of a fresh brand (brand_members policy fails — no membership row, no AFTER INSERT trigger creates one — and public-events policy fails — fresh brand has zero events).
  5. For brands UPDATE soft-delete: every SELECT policy gates on `deleted_at IS NULL`; the post-update row has `deleted_at IS NOT NULL`; no SELECT policy admits.
  6. With no SELECT policy passing, Postgres rolls back the entire mutation and returns 42501 with the misleading message "new row violates row-level security policy" — although the INSERT/UPDATE WITH CHECK actually passed.
- **Structural fix (in dispatch — ORCH-0734 forensics IA):** [prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md](Mingla_Artifacts/prompts/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md) — comprehensive audit of every authenticated INSERT/UPDATE/DELETE policy on every mingla-business B1 table for matching post-mutation SELECT-policy coverage, followed by single fix migration. Canonical fix archetype: add permissive SELECT policy `(account_id = auth.uid()) AND (deleted_at IS NULL OR <admin/owner branch>)` for owners, and broaden any soft-delete-affected SELECT policies to admit `deleted_at IS NOT NULL` for admins/owners as appropriate.
- **Status:** Root cause PROVEN (HIGH confidence). Audit + fix dispatched as ORCH-0734. Awaiting forensics return → spec → impl → tester PASS → CLOSE + lock-in.
- **Invariants:** NEW (DRAFT until ORCH-0734 CLOSE) **I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED** — every authenticated mutation policy on `public.*` schema tables MUST be paired with at least one SELECT policy that admits the actor for the post-mutation row state. Enforced by a SQL-aware CI gate plugged into `.github/workflows/strict-grep-mingla-business.yml`.
- **Causal cluster:** Cluster 4 (NEW): "RLS-RETURNING bug class" — distinct from RC-001 (state ownership), RC-002 (silent errors), RC-003 (fabricated data). Architectural pitfall: spec authors who design RLS by thinking about "who can write/edit/delete" forget that supabase-js's RETURNING means "who can write" implies "who can read it back." Brand-create + brand-delete are two confirmed instances; ORCH-0734 audit will surface every other latent instance in mingla-business.
- **Lesson codified:** Every mutation policy needs a paired SELECT policy that admits the post-mutation row state. Soft-delete UPDATEs in particular need owner/admin-broadened SELECT policies because every "active row" SELECT policy excludes the freshly-tombstoned row. Future B-cycle backend work must use this as a checklist item before tester PASS. ORCH-0734 ships an invariant + CI gate + permanent memory file (`feedback_rls_returning_owner_gap.md`) so this pattern never re-emerges.

### RC-0686: TypeScript enum rename without SQL CHECK constraint update (`photo_backfill_runs.mode`)
- **Discovery date:** 2026-04-26
- **Proof:** [reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0686_PHOTO_BACKFILL_CREATE_RUN_500.md) — live-fire supabase MCP probe confirmed constraint def `CHECK ((mode = ANY (ARRAY['initial'::text, 'refresh_servable'::text])))`; data layer shows zero rows with new mode value `'pre_photo_passed'` (latest insert 2026-04-20, before ORCH-0678 deploy on 2026-04-25).
- **Symptoms caused:** Admin UI "Create photo download run" returns "Failed to create run / Edge Function returned a non-2xx status code" for every city. 14,401 pre-bouncer-approved places stranded. ORCH-0682 (Lagos+8-city operational recovery) Steps 2+3 cannot complete via the post-ORCH-0678 admin three-button flow.
- **Causal chain:** ORCH-0678 spec specified the `BackfillMode` TypeScript union rename `'initial'` → `'pre_photo_passed'` in `backfill-place-photos/index.ts` and admin UI call sites, but did NOT specify an `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` migration. Implementor faithfully followed spec; tester PASSed without live-fire of `create_run` end-to-end. Post-deploy, every `INSERT INTO photo_backfill_runs (..., mode='pre_photo_passed', ...)` raises Postgres SQLSTATE 23514 against the stale constraint. Edge fn returns 500. Supabase JS admin client surfaces generic message (body not unwrapped — Constitution #3 sub-finding F-4).
- **Structural fix (specced, not yet shipped):** [prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md](Mingla_Artifacts/prompts/SPEC_ORCH-0686_PHOTO_BACKFILL_MODE_CONSTRAINT.md) — migration amends constraint to `('initial','pre_photo_passed','refresh_servable')` (legacy `'initial'` retained for 18 historical rows, all terminal-state); flips DEFAULT to `'pre_photo_passed'`; adds CI gate `I-DB-ENUM-CODE-PARITY` requiring TS union and SQL CHECK to stay in sync; bundles admin error-body unwrapper helper to surface real Postgres errors in toast.
- **Status:** Investigated, specced, awaiting SPEC mode return → IMPL → TEST.
- **Invariants:** `I-PHOTO-FILTER-EXPLICIT` (text rewrite required — currently stale); new `I-DB-ENUM-CODE-PARITY` (registers structural prevention of this exact pattern).
- **Causal cluster:** Same shape as ORCH-0540 (PL/pgSQL type-resolution drift after flag flip — code change without schema/RPC alignment, missed by headless QA). Lesson: any rename of a persisted-value union or enum REQUIRES a migration step in the same spec, plus mandatory live-fire of an end-to-end write through the constrained column before tester PASS.

### RC-0664: DM Realtime Receive Silently Dropped (Pre-emptive Dedup)
- **Discovery date:** 2026-04-25
- **Proof:** `reports/INVESTIGATION_ORCH-0663_0664_0665_CHAT_TRIPLE.md` (3 RCs proven HIGH, 9 hidden flaws); confirmed live on 2026-04-25 via working-tree grep at `useBroadcastReceiver.ts:51`.
- **Symptoms caused:** Every friend's incoming DM silently dropped from receiver's UI until close+reopen. Both delivery paths (broadcast `chat:${id}` and postgres_changes `conversation:${id}`) successfully received the message but neither updated `setMessages`. Side effects (cache, conversation list, mark-as-read) DID run — purely a UI state miss.
- **Causal chain:** `useBroadcastReceiver.ts:51` marked `broadcastSeenIds.current.add(msg.id)` BEFORE invoking `onBroadcastMessageRef.current(msg)`. The delegate (`MessageInterface.handleBroadcastMessage`) was a no-op stub that did nothing. Then `subscribeToConversation`'s postgres_changes backup at `ConnectionsPage:1513` checked `broadcastSeenIds.current.has(newMessage.id)` → returned TRUE → skipped the `setMessages` add. Two delivery paths, both falsely thinking the other had handled it.
- **Structural fix:** Extracted `addIncomingMessageToUI` helper in `ConnectionsPage` as the SINGLE OWNER of message-add logic. Both paths funnel through it. Seen-set add is now INSIDE the helper, AFTER `setMessages` succeeds. `MessageInterface.onBroadcastReceive` is REQUIRED (non-optional) so TypeScript catches missing wiring at compile time. CI grep gate forbids any seen-set mutation calls inside `useBroadcastReceiver.ts`.
- **Status:** Fixed — ORCH-0664 cycle-2 (2026-04-25). Cycle-1 was lost when parallel ORCH-0666/0667/0668 work overwrote the working tree; cycle-2 re-applied the same contract surgically.
- **Invariant:** I-DEDUP-AFTER-DELIVERY (registered in INVARIANT_REGISTRY.md)
- **Recurrence vector:** Any future code using a "seen-set" or "idempotency cache" must populate it AFTER the handled work, not before delegation. The CI gate catches the canonical pattern in this file; pattern-equivalents in other files require code review discipline (no automated coverage). Sender-side at L1936-area is the documented legitimate exception (sender already mutated UI via optimistic-replace).

### RC-001: Duplicate State Authorities
- **Discovery date:** 2026-03-23
- **Proof:** Query key consolidation audit, Zustand field removal
- **Symptoms caused:** ORCH-0205 (query key drift), stale cache after mutations, ghost data
- **Causal chain:** Multiple query keys for same entity → invalidation misses one → stale data displayed
- **Structural fix:** One factory per entity, dead Zustand fields removed
- **Status:** Fixed
- **Invariant:** INV-S02, INV-S07

### RC-002: Silent Error Swallowing
- **Discovery date:** 2026-03-23
- **Proof:** 16 mutations without onError, 7 silent catches
- **Symptoms caused:** ORCH-0206, user actions appearing to succeed but failing silently
- **Causal chain:** try/catch without throw or toast → user sees no feedback → data inconsistency
- **Structural fix:** onError on all mutations, withTimeout wrappers, mutation error toast utility
- **Status:** Partially fixed (50+ remaining non-state-changing silent catches documented)
- **Invariant:** Constitutional #3 (no silent failures)

### RC-003: Fabricated Data on Card Surfaces
- **Discovery date:** 2026-03-24
- **Proof:** INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md Pass 1
- **Symptoms caused:** Fake ratings, hardcoded travel times, wrong currency symbols
- **Causal chain:** Fallback defaults used instead of real data → user sees plausible but false information
- **Structural fix:** All fallbacks removed, real data or nothing shown
- **Status:** Fixed
- **Invariant:** INV-D08, Constitutional #9

### RC-004: Race Condition in Preferences-to-Deck Pipeline
- **Discovery date:** 2026-03-24
- **Proof:** Commit 79d0905b, TEST_PASS2.md
- **Symptoms caused:** ORCH-0064, stale deck after preference change, cards from old preferences appearing
- **Causal chain:** invalidateQueries after preference save → batch fetch starts before cache clear → old params used
- **Structural fix:** invalidateQueries removed, prefsHash matching gates batch acceptance
- **Status:** Fixed
- **Invariant:** INV-S06

### RC-005: Error-Swallowing Multi-Step Operations
- **Discovery date:** 2026-03-22
- **Proof:** Commit 23f3a0dd (unpair flow)
- **Symptoms caused:** ORCH-0177, partial unpair leaving orphaned data
- **Causal chain:** 3-step sequential code with try/catch per step → step 2 fails → steps 1 and 3 succeed → inconsistent state
- **Structural fix:** Atomic RPC replaces multi-step client code
- **Status:** Fixed for unpair. Pattern likely exists elsewhere (unaudited).

## Recurring Patterns

| Pattern | Occurrences | Examples | Structural Fix | Status |
|---------|------------|----------|----------------|--------|
| Query-key drift | 8+ | ORCH-0205 (3 saved, 2 person, 2 blocked) | Key factory discipline | Fixed |
| Silent catch swallowing | 50+ | ORCH-0206 (16 mutations fixed) | onError + mutationErrorToast | Partially fixed |
| Fabricated fallback data | 10 surfaces | ORCH-0061 (ratings, prices, times) | Remove all fallbacks | Fixed |
| Duplicate state owners | 3 | Zustand prefs, Zustand blocked, old query keys | Single authority map | Fixed |
| Multi-step client mutation | Unknown | Unpair (fixed), other flows unaudited | Atomic RPCs | Partially fixed |

## Causal Clusters

### Cluster 1: "Card Data Truthfulness" (RESOLVED)
Root cause: RC-003. 10+ symptoms across card rendering, pricing, ratings, travel times.
All resolved in Card Pipeline Audit Passes 1-5.

### Cluster 2: "State Consistency" (PARTIALLY RESOLVED)
Root causes: RC-001 + RC-002 + RC-004. Query key drift + silent failures + race conditions.
Key factory fixed. Mutation errors partially addressed. Unknown extent in unaudited surfaces.

### Cluster 3: "Security Layer" (UNAUDITED)
Potential root cause: Missing or inconsistent RLS policies, unvalidated edge functions.
No investigation started. ORCH-0223, 0224, 0225, 0226 all at F.

### Cluster 4: "RLS-RETURNING bug class" (PROVEN, AUDIT IN FLIGHT)
Root cause: RC-0728. supabase-js `.insert/.update/.delete(...).select()` triggers `Prefer: return=representation`, which makes Postgres evaluate SELECT policies for RETURNING. If no SELECT policy admits the post-mutation row, the entire mutation rolls back with 42501 even though WITH CHECK passed. Two confirmed instances in mingla-business: brand-create (owner has no SELECT policy for fresh brands) and brand-delete (every SELECT policy excludes soft-deleted rows). ORCH-0734 audits the remaining surface area to enumerate and patch all latent instances. Lesson: every mutation policy needs a matching SELECT policy that admits post-state.
