# CLOSE — ORCH-1103 · Ari Smart Brand CRUD + In-Chat Media

**Date:** 2026-06-09
**Verdict:** CLOSED PASS — Grade A
**Surfaces:** Ari in `mingla-business` (business iOS / Android / desktop web) + backend edge functions
**Epic:** first completed capability under GitHub #424 (Ari — full conversational control of the business app)

## What shipped

- **Tools:** new `update_brand` + `delete_brand`; extended `create_brand` (cover, de-GBP currency, first-brand-default). Registered in the tool registry AND the system-prompt CAPABILITIES (PROMPT_VERSION v3).
- **Delete safety (zero bypass):** `delete_brand` replicates `softDeleteBrand` exactly — blocking-events refusal (type-agnostic across events/trips/experiences) BEFORE any write → 409; soft-delete only (rowcount-verified `deleted_at`); clear `default_brand_id`; 30-day recovery; type-the-name confirm. Invariants `I-ARI-BRAND-DELETE-GUARD` + `I-ARI-NO-HARD-DELETE`.
- **In-chat media:** "Add cover" on the brand proposal card opens the existing `CoverPickerSheet`; create-time device image + video work via the seamless **Create & attach** (create-row-first / attach-second) flow.
- **Conversational flows:** `agentChoices.ts` choices payload renders `brand_disambiguation` + `no_brand_handoff` as chips (reusing QuickReplyChips CHOICE); brand receipt via ResponseCard.
- All UI reuses the four ORCH-1101 presentational components verbatim.

## Reworks (operator device-testing on physical iPhone)

1. Add-cover create-time dead tap (picker mounted update-only) → fixed (Q7 create-and-attach).
2. Disambiguation + no-brand chips were prose-only → wired into MessageList (both agent + client sides).
3. Create-and-attach lifecycle: after commit, the card left a live Confirm (→ "Cannot confirm — status: executed") and double-rendered the receipt → fixed (single Done, mutually-exclusive card/receipt, cover on receipt, stale confirm = no-op).
4. Tooling: worktree symlinked `node_modules` blocked Metro's lazy resolution of `expo-image-picker` → replaced with a real `npm ci` install for the test session.

## Verification

- 128 Ari jest + 25 Deno backend tests green (post-rebase).
- Step 0.5 regression gate: implementor happy-path tests (fails-on-revert) + tester adversarial test (7 cases, different angles — trip-only blocking delete, blocking-before-stamp ordering, no patch on soft-deleted brand, ownership zero-write, explicit non-GBP currency, idempotent re-delete).
- C7 `no-new-backend-files` gate: `ORCH_1103_BACKEND_ALLOWLIST` added (agentChoices.ts + new tests + the extended agentTools/agentSystemPrompt/agent-chat/agent-confirm-action). Gate runs PASS locally.
- No migration.
- Operator created / edited / deleted brands with image + video covers on his physical iPhone via the live dev build; the three reworks were operator-confirmed live.

## Deploy

- Edge functions `agent-chat` + `agent-confirm-action` were deployed to the linked project for the operator's live test; **redeployed from MERGED main at close** (canonical code).
- UI ships via `[deploy]` (mingla-business web is Vercel-gated) + business-app OTA (per-platform).
- No `[TEST-MOD-APPROVED]` token: all test files are new (no existing-test modifications).

## Known follow-ups (out of scope, logged)

- Create-attach cover persists null in the DB message row (client overlays for display) — durable persistence is a small backend follow-up if conversation-reload receipt fidelity matters.
- `create_experience` prompt/registry drift (flag only; G-3 scoped).
- `app/event/create.tsx` no-brand dead-end (Ari now handles the handoff; the manual screen still dead-ends).

## Next

Continue EPIC #424 — next capability domain (Events recommended; reuses cover/media + publish patterns), following the ORCH-1103 pattern.
