> Parity note: ported from `.claude/skills/mingla-orchestrator/references/bootstrap-sequence.md` during META-ORCH-0755-B so Codex orchestrator can load Claude’s bootstrap procedure when repairing or initializing artifacts.

# Bootstrap Sequence

Complete procedure for initializing the Mingla Artifacts system from scratch.

---

## Pre-Flight

1. Check if `Mingla_Artifacts/` exists in the working directory
2. If it exists, verify all required documents are present (see checklist below)
3. If any are missing, create only the missing ones
4. If none exist, run the full bootstrap

---

## Step 1 — Create Directory Structure

Run `scripts/bootstrap.sh` or manually create:

```
Mingla_Artifacts/
├── WORLD_MAP.md
├── PRIORITY_BOARD.md
├── PRODUCT_SNAPSHOT.md
├── MASTER_BUG_LIST.md
├── ROOT_CAUSE_REGISTER.md
├── OPEN_INVESTIGATIONS.md
├── SPEC_QUEUE.md
├── IMPLEMENTATION_QUEUE.md
├── TEST_QUEUE.md
├── RETEST_LEDGER.md
├── DECISION_LOG.md
├── INVARIANT_REGISTRY.md
├── AGENT_HANDOFFS.md
├── COVERAGE_MAP.md
└── prompts/
    ├── (agent handoff prompts go here)
```

---

## Step 2 — Ingest Existing Sources

Read and extract from these sources in order:

### Source 1: LAUNCH_READINESS_TRACKER.md
Extract:
- All graded items → Issue Registry in World Map
- All grades → Coverage Map
- All resolved issues → close them in Master Bug List
- Decision log entries → Decision Log
- Pass summaries → evidence links
- Bug inventory reference → Master Bug List

### Source 2: PRODUCT_DOCUMENT.md
Extract:
- Product surfaces → World Map surface inventory
- User journey steps → World Map user journey
- Architecture overview → World Map system context
- Known limitations → register as issues
- Feature details → product surface definitions

### Source 3: Existing investigation/spec/test reports
Current reports and specs live under `Mingla_Artifacts/reports/` and `Mingla_Artifacts/specs/`. Historical root `outputs/` material must be reached through `Mingla_Artifacts/ARTIFACT_MANIFEST.md` and `Mingla_Artifacts/archive/`, not treated as current truth.

Extract:
- Open findings → register as issues
- Completed work → update issue status with evidence
- Hidden flaws discovered → register as new issues

---

## Step 3 — Populate the World Map

The World Map is the master document. Fill each section:

### 3a. Product Surface Inventory
List every product surface from the tracker and product doc:
- Auth & Session, Onboarding, Discovery/Explore, Collaboration Sessions,
  Social/Friends, Notifications, Saved/Boards, Profile & Settings,
  Map & Location, Chat/DM, Payments/Subscriptions, Calendar/Scheduling,
  Holidays/Events, People Discovery, Pairing, Sharing/Invites,
  Post-Experience/Reviews, Booking, Admin Dashboard (all 17 pages),
  Cross-Cutting (Deep Linking, App Lifecycle, Analytics, Weather, UI Components,
  Query Architecture, Error Handling, Security)

### 3b. User Journey
Map the complete user path:
```
Install → Auth → Onboarding (7 steps) → Home/Explore → Discover →
Save → Schedule → Invite Friends → Collaborate → Go → Review → Return
```
Every issue gets located against this journey.

### 3c. Issue Registry
For EVERY item in the Launch Readiness Tracker:
- Assign ORCH-ID if not already tracked
- Record: ID, title, surface, flow location, severity, classification,
  status, grade, last verified, evidence link, assigned agent, notes
- Status values: `open` | `investigating` | `spec-ready` | `implementing` |
  `testing` | `retest-needed` | `verified` | `closed` | `deferred`

### 3d. Launch Readiness Grades
Copy current grades from tracker, organized by surface.

### 3e. Invariant Registry
Populate from `references/invariant-registry.md`.

### 3f. Agent Pipeline State
Initialize all queues as empty.

---

## Step 4 — Generate Priority Board

Score all open items using `references/priority-scoring.md`.
Rank the top 20. For each:
- ID, title, score, one-line rationale
- Recommended action (investigate / spec / implement / test / escalate)

---

## Step 5 — Generate Product Snapshot

Create a PM-facing summary:
- App readiness by surface (A/B/C/D/F counts)
- Critical flow status (can a user complete the core loop?)
- Top 5 launch blockers
- Top 5 quality risks
- What's strong (surfaces at A/B)
- What's fragile (surfaces at D/F)
- Engineering velocity summary (items closed this week)

---

## Step 6 — Generate Coverage Map

For every product surface:
- Total items tracked
- Grade distribution (how many A, B, C, D, F)
- % unaudited (F with no evidence)
- % stale (last verified > 7 days)
- Coverage confidence: `strong` | `partial` | `weak` | `unaudited`

---

## Step 7 — Present Executive Summary

After bootstrap completes, present to the user:

1. Total items tracked (with breakdown by status)
2. Grade distribution across all surfaces
3. Top 5 launch blockers
4. Top 5 priorities (highest-impact next actions)
5. Biggest coverage gaps (most unaudited surfaces)
6. Recommended first action

Ask for steering before proceeding.

---

## Document Checklist

All 14 documents must exist after bootstrap:

- [ ] WORLD_MAP.md
- [ ] PRIORITY_BOARD.md
- [ ] PRODUCT_SNAPSHOT.md
- [ ] MASTER_BUG_LIST.md
- [ ] ROOT_CAUSE_REGISTER.md
- [ ] OPEN_INVESTIGATIONS.md
- [ ] SPEC_QUEUE.md
- [ ] IMPLEMENTATION_QUEUE.md
- [ ] TEST_QUEUE.md
- [ ] RETEST_LEDGER.md
- [ ] DECISION_LOG.md
- [ ] INVARIANT_REGISTRY.md
- [ ] AGENT_HANDOFFS.md
- [ ] COVERAGE_MAP.md
