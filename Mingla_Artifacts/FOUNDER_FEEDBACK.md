# Founder Feedback Log

Append-only log. Most recent first. Each entry: date received → verbatim feedback → status (open / triaged-to-ORCH-XXXX / declined) → orchestrator notes.

<!-- TEMPLATE for new entries:

## YYYY-MM-DD — One-line topic

> "verbatim founder quote here"

**Triage:** [orchestrator's plain-English breakdown]
**Status:** [open / triaged-to-ORCH-XXXX / declined]

-->

---

## 2026-05-04 — Top bar IA + bottom nav real estate

> "the + button, when you navigate to the events page is missing. + for adding evemnts, and the notification, and search should be constant on the top bar at all times. I am thinking of moving the account from thr menu, to tyhe top bar. It is taking too much real estate for the bottom nav menu"

**Triage:** 3 sub-items.
- **Sub-item 1** — Missing `+` on events page: triaged-to-Cycle 17a §A.1 (tactical fix — events.tsx renders `[search, bell, +]` inline) + Cycle 17b structural rework (TopBar `extraRightSlot` prop + new I-37 invariant)
- **Sub-item 2** — Constant top bar (search + bell + `+`): triaged-to-Cycle 17b structural rework (D-17-12)
- **Sub-item 3** — Move Account to top bar: **declined** per operator decision 2026-05-04 ("leave the account in the bottom nav menu")

**Status:** sub-items 1+2 in active 17a/17b pipeline; sub-item 3 declined.
