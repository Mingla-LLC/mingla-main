# GitHub Project Sync — Plan & How to Run

This folder is the source-of-truth for the GitHub Project, milestones, labels, and issues that scaffold Mingla Business work for the team.

## Project structure (locked)

```
Project (org-level): "Mingla Business"
├── Milestones (7 phases)
│   ├── Phase 1 — Foundations          (cycles 0a, 0b)
│   ├── Phase 2 — Core Wedge           (cycles 1, 2, 3, 4, 5)
│   ├── Phase 3 — Public Surfaces      (cycles 6, 7, 8)        ← Expo Web (DEC-081)
│   ├── Phase 4 — Event Management     (cycles 9, 10, 11, 12, 13)
│   ├── Phase 5 — Account + Polish     (cycles 14, 15, 16, 17)
│   ├── Phase 6 — Backend MVP          (B1, B2, B3, B4)        ← MVP CUTLINE
│   └── Phase 7 — Post-MVP             (B5 marketing, B6 agent)
│
├── Issue hierarchy (3 levels via GitHub native sub-issues)
│   ├── Epic         (one per cycle, 23 total)
│   ├── User Story   (per journey within the cycle, gherkin AC)
│   └── Sub-task     (concrete component / hook / migration / edge fn)
│
└── Labels
    ├── Type:        epic, user-story, task, bug, spike
    ├── Phase:       phase:foundations, phase:core-wedge, phase:public-surfaces,
    │                phase:management, phase:account-polish, phase:backend-mvp, phase:post-mvp
    ├── Cycle:       cycle:0a, cycle:0b, cycle:1 .. cycle:17, cycle:b1 .. cycle:b6
    ├── Area:        area:account, area:brand, area:event, area:tickets, area:scanner,
    │                area:payments, area:marketing, area:analytics, area:agent,
    │                area:permissions, area:public-pages, area:platform
    ├── Layer:       layer:ui, layer:backend, layer:db, layer:api, layer:design
    ├── Platform:    platform:mobile, platform:web, platform:both
    ├── MVP gate:    mvp, post-mvp
    └── Priority:    priority:p0, priority:p1, priority:p2, priority:p3
```

## Decomposition policy

- **All 23 epics** (cycles) get created up-front so the new engineer sees the full plan at-a-glance.
- **Done cycles** (0a, 0b, 1, 2, 3, 4) are created as **closed** epics with brief "what shipped" descriptions and links to the existing implementation reports + commits.
- **Active cycle** (Cycle 5) gets full decomposition: epic + 5–7 user stories with gherkin AC + sub-tasks.
- **Future cycles** (6 → 17 + B1 → B6) get **epic-only placeholders** with description + scope outline + "decompose at active time" note. Founder + engineer decompose them as we approach.

This avoids stale backlogs (we already learned in Cycle 3 that pre-decomposition gets reworked 17× during execution) while still giving the engineer the full picture.

## User-story template (the founder's standard)

Every user-story-type issue body uses:

```markdown
**As a** [role]
**I need** [function]
**So that** [benefit]

### Details and Assumptions
* [document what you know]

### Acceptance Criteria

```gherkin
Given [some context]
When [certain action is taken]
Then [the outcome of action is observed]
```
```

## How to run the sync

**Prerequisite (one-time):**
```bash
gh auth login
# Choose: GitHub.com → HTTPS → authenticate via browser
# Make sure the auth scope includes: repo, project, write:org
```

**Then:**
```bash
bash Mingla_Artifacts/github/sync.sh
```

The script is **idempotent** — re-running it will skip already-created milestones, labels, and issues. Safe to re-run after auth fixes or partial failures.

## What the sync does (in order)

1. **Verify auth** — fails fast if not logged in or missing scopes.
2. **Create the project** "Mingla Business" at org `Mingla-LLC` (skips if exists).
3. **Create labels** — ~25 labels with consistent colors (skips existing by name).
4. **Create milestones** — 7 phases (skips existing by title).
5. **Create epic issues** — 23 cycles, body content from `epics/cycle-*.md`.
   - Done cycles: created and immediately closed with reference comment.
   - Active/future cycles: created as open with `epic` label + relevant cycle/phase/area labels.
6. **Create Cycle 5 user stories** — sub-issues of the Cycle 5 epic, body from `user-stories/cycle-5/*.md`.
7. **Add all created issues to the project** — one by one, with milestone assignment.
8. **Print summary** — issue counts, project URL, "next steps".

## What lives in this folder

```
Mingla_Artifacts/github/
├── PLAN.md                     ← this file
├── sync.sh                     ← idempotent bash script
├── labels.tsv                  ← name<TAB>color<TAB>description
├── milestones.tsv              ← title<TAB>description<TAB>due_on
├── epics/
│   ├── cycle-0a.md  (DONE)
│   ├── cycle-0b.md  (DONE)
│   ├── cycle-1.md   (DONE)
│   ├── cycle-2.md   (DONE)
│   ├── cycle-3.md   (DONE)
│   ├── cycle-4.md   (DONE)
│   ├── cycle-5.md   (active — full decomposition)
│   ├── cycle-6.md   (placeholder)
│   ├── ... cycle-17.md
│   ├── cycle-b1.md  (placeholder)
│   ├── ... cycle-b6.md
└── user-stories/
    └── cycle-5/
        ├── us-01-add-ticket-type.md
        ├── us-02-edit-ticket-type.md
        ├── us-03-reorder-ticket-types.md
        ├── us-04-ticket-visibility.md
        ├── us-05-approval-required.md
        ├── us-06-password-protected.md
        └── us-07-waitlist.md
```

## Maintenance going forward

- **Each new cycle:** before kickoff, the active engineer (or founder) decomposes that cycle's epic into user stories using the gherkin template, places them in `user-stories/cycle-N/`, and re-runs the sync (or creates issues directly via `gh issue create`).
- **Each cycle close:** the epic gets closed with a reference comment listing the closing commit + implementation report path.
- **Decomposition is just-in-time** — don't pre-decompose more than 1-2 cycles ahead. We've proven that pre-spec'd backlogs go stale fast.
