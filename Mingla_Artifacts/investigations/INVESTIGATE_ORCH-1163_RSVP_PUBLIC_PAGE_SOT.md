# INVESTIGATE — ORCH-1163 · Public RSVP Page · Source-of-Truth Audit

**Delivered into:** META-ORCH (public offering-page standardization) — per the 2026-06-18 CONSOLIDATION NOTICE.
**Status:** SoT AUDIT COMPLETE — findings delivered; implementation **HELD** pending the META's package convention.
**Verified:** 2026-06-18 against `origin/main` (NOT the stale local anchor) via `git grep` / `git show` + a 4-surface read sweep.
**Refs:** COMMS-0040 (this RSVP initiative), COMMS-0038 (standard event), COMMS-0041 (experience), `Mingla_Artifacts/investigations/INVESTIGATE_PUBLIC_EXPERIENCE_PAGE_SOT_AUDIT.md`.
**Feature lineage:** RSVP shipped ORCH-1150 (PR #503); the public RSVP page was redesigned by ORCH-1157 (PR #526, "Direction-C Momentum").

---

## 1. The question
How many public RSVP-page implementations exist; is there ONE shared component; is there ONE source of truth across business app, consumer app, and buyer web?

## 2. The answer (one line)
**THREE render paths, TWO distinct page bodies.** The backend and the Going/Maybe/Can't decision control are single-source; the full page BODY is NOT — web + business share `RsvpPublicBody`, while the consumer app forks a hand-parity copy because the body lives in `mingla-business/src/` where `app-mobile` cannot import it. This is the EXACT mirror of the experience gap (COMMS-0041) and the same root cause the standard-event page already solved (COMMS-0038).

## 3. The three render paths
1. **Buyer / anon WEB** — route `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` → adapter `mingla-business/src/components/event/PublicEventPage.tsx`: `const isRsvp = event.event_type === "rsvp"` (~L515) → renders `<RsvpPublicBody>` (~L570) and returns early (zero tickets, no checkout). Imports at L63 `RsvpPublicBody`, L64 `submitPublicRsvp` from `../../services/rsvpEvents`.
2. **Business host PREVIEW** — `mingla-business/app/rsvp/[id]/preview.tsx` (import L32, render L358) → renders the **SAME** `RsvpPublicBody`.
3. **Consumer app** — `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` → does **NOT** import `RsvpPublicBody` (it appears only in comments); it imports `RsvpMomentumDecision` (L79), renders it (L701, L735), and **hand-mirrors** the RsvpPublicBody section sequence (comments at L351, L680–681, L765, L1064 — its own words: "stays byte-parity with the buyer-web / business RsvpPublicBody").

## 4. The two page bodies
- **Body A — `mingla-business/src/components/event/RsvpPublicBody.tsx`** → serves WEB + BUSINESS preview (genuinely shared between those two surfaces).
- **Body B — the RSVP branch of `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`** → serves CONSUMER; a separate, hand-maintained re-implementation of Body A.

## 5. What IS shared today (genuine single source of truth)
- **Decision control:** `packages/offering-rendering/RsvpMomentumDecision.tsx` — the Going/Maybe/Can't UI; imported by all 3 surfaces (via Body A and Body B).
- **CTA-state resolver:** `resolveRsvpCta` in `packages/event-rendering/offeringCta.ts`.
- **Write path:** `submitPublicRsvp` (`mingla-business/src/services/rsvpEvents.ts`) → edge function `supabase/functions/public-submit-rsvp`.
- **Storage:** `events` rows discriminated by `event_type='rsvp'` (+ RSVP columns), migration `20261004000000_orch_1150_rsvp_events.sql`; per-guest rows in `event_rsvps`.

## 6. What is NOT shared (the gap)
- **The full page BODY.** `RsvpPublicBody.tsx` lives in `mingla-business/src/` → `app-mobile` cannot import across the app boundary → the consumer forks **Body B** and keeps "byte-parity" by hand. This is the drift risk and the precise thing to fix.
- **READ-PATH seam** (same shape as COMMS-0038's standard-event seam): web `RsvpPublicBody` receives props from the `PublicEventPage` adapter (`publicEventsService` reading the public-events view + RSVP fields); consumer builds props from the deck feed (`app-mobile/src/services/rsvpDeckService.ts`). A new field therefore needs a per-surface feed update, not just a component edit. *(The exact RSVP detail read RPC was not separately pinned in this audit — flagged for the META's read-path standard.)*

## 7. Root cause (shared with the experience gap)
The page body is authored **inside `mingla-business/src/`** instead of a shared `packages/` module, so any surface outside mingla-business (the consumer app) is forced to fork. The proven solution already in the repo: the standard-event page (COMMS-0038) puts its full body in `@mingla/event-rendering/PublicEventPage.tsx` and **all 3 surfaces import it** → edit-once-renders-everywhere.

## 8. Recommended fix — HELD pending the META convention
Promote `RsvpPublicBody` into a shared `packages/` module (candidate: `@mingla/offering-rendering`, where `RsvpMomentumDecision` already lives and which is already React-Native-Web-compatible since web renders it today) so all 3 surfaces import **ONE body**. **HELD:** the META-ORCH decides the single package convention so RSVP, trip, and experience land identically rather than inventing three. Do not move the body yet; do not register a standalone ORCH/spec/worktree; do not diverge the read path.

## 9. Adjacent surfaces (NOT public — listed for completeness)
Host console (authenticated, id-based, not the public page): `mingla-business/app/rsvp/[id]/index.tsx`, `edit.tsx`, `guests.tsx`, `create.tsx`; wizard `mingla-business/src/components/rsvp/RsvpCreatorWizard.tsx`. Consumer deck supply: `app-mobile/src/services/rsvpDeckService.ts`.

## 10. Evidence method
`git fetch origin`, then `git grep` / `git show` against **`origin/main`**. The local anchor `~/Desktop/mingla-main` was 54 commits stale and produced false "RSVP not implemented" reads in an initial agent pass — recorded here as a caution for the META and any session auditing off the anchor. Import direction confirmed: the consumer's references to `RsvpPublicBody` are comments only; there is no import statement.
