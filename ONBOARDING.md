# Mingla Business — Engineer Onboarding

Welcome. This is your 10-minute orientation. Read top-to-bottom, then start at "Where to actually begin" at the end.

---

## What we're building (one paragraph)

Mingla Business is the **operating system for live experiences** — the place organisers create, manage, market, and monetise events that flow into Mingla's consumer demand graph. Every competitor (Posh / Partiful / Eventbrite / Mailchimp / Square) sells to the supply side; only Mingla owns the demand side. That demand-graph integration is the defensible wedge.

**Mingla is an experience app. Never describe it as a dating app.** This is a hard product-positioning rule.

---

## The three apps in this monorepo

| Domain | Path | Stack | Status |
|--------|------|-------|--------|
| **Mingla Business** | `mingla-business/` | React Native (Expo SDK 54), TypeScript strict, React Query, Zustand. Serves both iOS/Android AND web (Expo Web at `business.mingla.com`). Per **DEC-081** there is no separate `mingla-web/` codebase — web parity is inside this same repo. | **Pre-MVP, actively building** (you're here) |
| **Mingla Mobile (consumer)** | `app-mobile/` | Same RN/Expo stack. ~100 components, ~67 hooks, ~75 services. | Active, feature-rich |
| **Mingla Admin** | `mingla-admin/` | React 19 + Vite, JSX, Tailwind v4, Framer Motion, Recharts, Leaflet. | Active |
| **Backend (shared)** | `supabase/` | PostgreSQL, 72 Deno Edge Functions, 293 migrations, RLS everywhere. Shared by all three frontends. | Active |

**Cross-domain rule:** when you change DB tables, edge functions, or RLS — check impact on all three frontends.

---

## The strategic frame (5 truths)

1. **Foundations first, agent on top.** DB is source of truth. The chat agent is *strictly* post-MVP, gated to Cycle B6 per BUSINESS_PRD §U.0.
2. **Frontend-first sequence (DEC-071).** 17 UI cycles with stub data, THEN 6 backend cycles light it up live. Don't write database code during a UI cycle.
3. **Mobile + web parity from day one.** A feature isn't done until it works on both. (Risk R1.)
4. **Sequential pace.** One step at a time. Wait for founder approval after every step. No "while we're at it" expansions.
5. **Diagnose before code.** Investigate, explain in plain English, get confirmation, *then* build. No "this is simple enough to just do."

The full strategic plan: [`Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md`](./Mingla_Artifacts/BUSINESS_STRATEGIC_PLAN.md)

---

## Where we are right now

We're working through 23 cycles total: 17 UI + 6 backend. Cycles 0a → 4 done. Cycle 5 (ticket types) is next.

Cycle history:
- **Cycle 0a** ✅ Foundation: tokens, primitives, nav, auth
- **Cycle 0b** ✅ Web auth + bundle (Expo Web)
- **Cycle 1** ✅ Sign-in → Home → brand creation
- **Cycle 2** ✅ Brands inventory (list, profile, edit, team, finance)
- **Cycle 3** ✅ Event creator wizard (the wedge cycle — 7-step form)
- **Cycle 4** ✅ Recurring + multi-date events with per-date overrides
- **Cycle 5** 🟡 Ticket types — start here
- Cycles 6–17 + B1–B6 ⬜ Future (epic-only placeholders in GitHub Project)

The full at-a-glance plan + every cycle's scope: see the **Mingla Business** GitHub Project linked at `https://github.com/orgs/Mingla-LLC/projects` (or generated via [`Mingla_Artifacts/github/sync.sh`](./Mingla_Artifacts/github/sync.sh)).

---

## How we work (the agent pipeline)

This codebase uses a structured workflow with five role-skills:

```
INTAKE → INVESTIGATE → REVIEW → SPEC → REVIEW → IMPLEMENT → TEST → CLOSE
```

| Skill | Produces | Cannot |
|-------|----------|--------|
| `/mingla-orchestrator` | Reviews, gates, doc updates, writes prompts | Execute agents, write code |
| `/mingla-forensics` | Investigation reports + specs | Write code |
| `/mingla-implementor` | Code changes + implementation reports | Redesign, skip spec |
| (tester) | Test reports with pass/fail | Skip regression checks |
| `/ui-ux-pro-max` | Design recommendations | Implement code |

**The orchestrator NEVER writes code or executes agents directly.** It writes prompts to `Mingla_Artifacts/prompts/`. The user dispatches them. This is how we keep the audit trail clean.

Each cycle goes through this pipeline at least once, often multiple times for reworks.

---

## The 7 documents you must read in your first hour

Read in this order. They're all under `Mingla_Artifacts/`:

1. **`BUSINESS_STRATEGIC_PLAN.md`** — vision, MVP cut, milestones, risks (this file is the source of truth for direction)
2. **`BUSINESS_PRD.md`** — every feature inventory (11 sections); your reference encyclopedia
3. **`BUSINESS_PROJECT_PLAN.md`** — the granular execution plan including the database schema target
4. **`DECISION_LOG.md`** — every architectural decision and why (DEC-070 through DEC-085 are recent)
5. **`INVARIANT_REGISTRY.md`** — rules that must always hold (I-11 to I-14 are the most active)
6. **`POSITIONING_AND_GTM_STRATEGY.md`** — how we talk about Mingla externally
7. **The latest implementation report** in `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_4_*.md` — see how the most recent cycle was executed

The full **GitHub Project** ("Mingla Business") gives you the full task list at-a-glance. Each epic links back to spec/PRD references.

---

## Hard rules that have caught past mistakes

These exist because we ALREADY tripped over them. Don't trip again.

| Rule | Why |
|------|-----|
| **Diagnose before code.** Investigate → explain in plain English → get confirmation → then build. | Pre-spec'd backlogs go stale fast (Cycle 3 had 17 reworks despite a comprehensive spec). |
| **No silent failures.** Every catch must surface to user/log/monitoring. `catch () {}` is a fireable offense. | Constitution #3. Caught masked errors in PreferencesService that made onboarding succeed-with-stale-defaults. |
| **One owner per truth.** Drafts live in Zustand; server data lives in React Query. Don't mix. | Constitution #2. |
| **Logout clears everything.** No private data survives sign-out. | Constitution #6. |
| **Subtract before adding.** Remove broken code before writing replacement. | Constitution #8. |
| **Cross-domain check on every DB change.** Consumer + admin + business apps share Supabase. | R8 in risk register. |
| **Migration chain rule.** When investigating a DB function/table, find the LATEST migration that touches it. Earlier migrations may be superseded. | We previously cited a stale CHECK constraint as current truth. Forensics now MUST verify the latest definition. |
| **Sequential pace.** No parallel dispatches. Wait for approval after every step. | Founder rule. Stops scope creep. |
| **/ui-ux-pro-max for visible UI.** Every implementor task touching UI must invoke `/ui-ux-pro-max` as pre-flight. | Founder rule. Quality bar enforcement. |
| **Keyboard never blocks an input field.** Every TextInput must remain visible above the keyboard. Reference Cycle 3 wizard root pattern. | Cost multiple reworks across Cycle 3 and 4 before being codified globally (2026-04-30). |
| **No Co-Authored-By in commits.** No AI attribution lines. | Founder rule. |

---

## The kit primitives (don't reinvent)

When you need a sheet, modal, dialog, card, or chrome — DON'T write a new one. Use:

| Primitive | File | When |
|-----------|------|------|
| `Sheet` | `mingla-business/src/components/ui/Sheet.tsx` | Bottom-anchored sheets. Snap = peek/half/full or numeric (DEC-084). Native portal (I-13). |
| `Modal` | `mingla-business/src/components/ui/Modal.tsx` | Centered modals. Same portal contract as Sheet (DEC-085). |
| `ConfirmDialog` | `mingla-business/src/components/ui/ConfirmDialog.tsx` | Destructive confirms with type-to-confirm option. |
| `GlassCard` | `mingla-business/src/components/ui/GlassCard.tsx` | The L1-L4 glass treatment. Use variants `base` / `elevated`. |
| `Button` | `mingla-business/src/components/ui/Button.tsx` | Primary / ghost / destructive. Always `fullWidth` for dock buttons. |
| `Input` | `mingla-business/src/components/ui/Input.tsx` | Use variants `text` / `search`. For numeric, fall back to raw `TextInput`. |
| `IconChrome` | `mingla-business/src/components/ui/IconChrome.tsx` | The circular chrome buttons (back, close, share). |
| `Toast` | `mingla-business/src/components/ui/Toast.tsx` | Top-of-screen transient messages. |
| `Stepper` | `mingla-business/src/components/ui/Stepper.tsx` | Multi-step progress. |

If a need surfaces 3+ times that none of these can handle, propose a new primitive via Decision Log carve-out (precedent: DEC-084 + DEC-085).

---

## Local dev setup

```bash
# Mobile + web shared:
cd mingla-business
npm install
npm run start      # Expo dev server — scan QR for iOS/Android, press 'w' for web

# Type check:
npx tsc --noEmit
```

For Supabase (when working on backend cycles only):
```bash
cd supabase
supabase start           # Local Postgres + Edge Functions runtime
supabase db push         # Apply migrations to local DB
```

**Never** run `mcp__supabase__apply_migration` — it creates timestamp mismatches that break the deployment pipeline. Write `.sql` files only; the user pushes via `supabase db push`.

---

## Where to actually begin

1. **Read this file** (you're here ✓).
2. **Read the 7 documents listed above** (~1 hour).
3. **Open the "Mingla Business" GitHub Project** — see all 23 cycle epics at-a-glance.
4. **Look at the most recent implementation report** (`IMPLEMENTATION_BIZ_CYCLE_4_*`) for the pattern of how cycles get executed.
5. **Pair with the founder on Cycle 5 kickoff** — there are 7 user stories already drafted in `Mingla_Artifacts/github/user-stories/cycle-5/` waiting to be claimed.
6. **Pick a user story, run it through the pipeline:**
   - Use `/mingla-forensics` to investigate
   - Get the founder to review
   - Use `/mingla-implementor` to build
   - Self-test or use the tester pattern from Cycle 4

If you get stuck or unsure, the founder is available. Default to asking — silent decisions are explicitly forbidden by Strategic Plan §8.

---

## When something feels weird

This codebase has accumulated context. If something feels surprising or contradictory:

1. **Check `DECISION_LOG.md`** — there's likely a DEC-NN explaining it.
2. **Check `INVARIANT_REGISTRY.md`** — it might be a hard rule.
3. **Check `Mingla_Artifacts/reports/`** — past investigations explain a LOT.
4. **Search prompts/commits for the symptom** — the 17-rework Cycle 3 left rich breadcrumbs.
5. **Ask the founder.** "I see X but expected Y" is a totally valid question.

Welcome aboard. Build well.
