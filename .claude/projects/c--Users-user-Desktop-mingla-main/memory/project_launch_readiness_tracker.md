---
name: Launch Readiness Tracker
description: Location and rules for the LAUNCH_READINESS_TRACKER.md — the living document tracking launch readiness grades for every flow and cross-cutting concern
type: project
---

The Launch Readiness Tracker lives at `outputs/LAUNCH_READINESS_TRACKER.md`.

**Why:** This is the single source of truth for whether Mingla is ready to ship. Every flow and cross-cutting concern is graded A-F with evidence requirements.

**How to apply:**
- Read this tracker at the start of every reliability/hardening conversation
- Update it after every completed pipeline (audit → spec → implement → test → review)
- Never promote a grade without test evidence
- The Launch Hardener skill owns this document — its reference docs are at `.claude/skills/Launch Hardener/references/`

**Current state (2026-03-19):** Initialized with all flows at grade F (unaudited). Only curated card integrity (CRIT-001/002/003) starts at grade C (migrations deployed, not fully verified).
