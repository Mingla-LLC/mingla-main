# Coverage Map

> **2026-04-21 03:45 UTC — ORCH-0558 CLOSED Grade A.** Collaboration Sessions surface: 1 additional A from match promotion structural hardening (advisory lock + unique constraint + atomic RPC + telemetry observable). Surface distribution: 7 total → 4 A / 0 B / 0 C / 0 D / 3 F (was 3 A / 0 B / 0 C / 0 D / 4 F). Match-promotion path verified live via 10 MCP deploy probes + tester Tier A/B/F + device test on iOS + Android. 6 new invariants registered.

> Last updated: 2026-04-18 (**ORCH-0503 CLOSED A** — v3 fix PASS; Discovery surface grade distribution unchanged: the fix restores correctness inside an already-Strong-graded deck pipeline, so no grade-count movement; new invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` reinforces Constitutional #2 "One owner per truth" at the deck-sync-effect boundary)

## Surface Coverage

| Surface | Total | A | B | C | D | F | % Unaudited | % Stale | Confidence |
|---------|-------|---|---|---|---|---|-------------|---------|------------|
| Auth & Session | 7 | 2 | 4 | 1 | 0 | 0 | 0% | 0% | Partial |
| Onboarding | 11 | 2 | 0 | 0 | 0 | 9 | 82% | 0% | Weak |
| Discovery / Explore | 55 | 39 | 10 | 0 | 0 | 6 | 11% | 0% | Strong (↑ ORCH-0474 closed B — ORCH-0469, ORCH-0472 previously B) |
| **Place Pipeline (Seeding + AI Validation)** | **11** | **8** | **0** | **0** | **0** | **3** | **27%** | **0%** | **Strong (NEW 2026-04-17)** |
| Collaboration Sessions | 7 | 4 | 0 | 0 | 0 | 3 | 43% | 0% | Partial (↑ ORCH-0558 closed A — match promotion structurally proven deterministic + observable) |
| Social / Friends | 7 | 1 | 1 | 0 | 0 | 5 | 71% | 0% | Weak |
| Notifications | 11 | 6 | 2 | 0 | 0 | 3 | 27% | 0% | Partial |
| Saved / Boards | 5 | 0 | 0 | 0 | 0 | 5 | 100% | 0% | Unaudited |
| Profile & Settings | 10 | 4 | 1 | 0 | 0 | 5 | 50% | 0% | Weak |
| Map & Location | 16 | 0 | 0 | 0 | 0 | 16 | 100% | 0% | Unaudited |
| Chat / DM | 8 | 0 | 0 | 0 | 0 | 8 | 100% | 0% | Unaudited |
| Payments & Subscriptions | 15 | 8 | 6 | 1 | 0 | 0 | 0% | 0% | Strong |
| Calendar & Scheduling | 8 | 0 | 0 | 0 | 0 | 8 | 100% | 0% | Unaudited |
| Holidays & Events | 8 | 1 | 1 | 0 | 0 | 6 | 75% | 0% | Weak |
| People Discovery | 10 | 0 | 0 | 0 | 0 | 10 | 100% | 0% | Unaudited |
| Pairing System | 10 | 3 | 0 | 0 | 0 | 7 | 70% | 0% | Weak |
| Sharing & Invites | 10 | 0 | 0 | 0 | 0 | 10 | 100% | 0% | Unaudited |
| Post-Experience | 9 | 0 | 0 | 0 | 0 | 9 | 100% | 0% | Unaudited |
| Booking | 2 | 0 | 0 | 0 | 0 | 2 | 100% | 0% | Unaudited |
| Network & Offline | 5 | 0 | 1 | 0 | 0 | 4 | 80% | 0% | Weak |
| State & Cache | 8 | 5 | 0 | 0 | 0 | 3 | 38% | 0% | Partial |
| Chat Responsiveness | 4 | 4 | 0 | 0 | 0 | 0 | 0% | 0% | Strong |
| Hardening Infrastructure | 3 | 3 | 0 | 0 | 0 | 0 | 0% | 0% | Strong |
| Error Handling | 5 | 0 | 0 | 0 | 0 | 5 | 100% | 0% | Unaudited |
| Security & Auth | 13 | 5 | 0 | 1 | 2 | 5 | 38% | 0% | Weak |
| Deep Linking | 4 | 0 | 1 | 0 | 0 | 3 | 75% | 0% | Weak |
| App Lifecycle | 11 | 2 | 0 | 0 | 0 | 9 | 82% | 0% | Weak |
| Analytics & Tracking | 11 | 1 | 0 | 2 | 2 | 6 | 55% | 0% | Weak |
| Weather & External | 6 | 0 | 0 | 0 | 0 | 6 | 100% | 0% | Unaudited |
| UI Components | 10 | 3 | 0 | 0 | 0 | 7 | 70% | 0% | Weak |
| **TOTAL** | **303** | **100** | **24** | **4** | **4** | **171** | **56%** | **0%** | **Weak → Slightly improving** |

## Heatmap Summary

### Strong (>70% at A/B)
- Chat Responsiveness (4/4 A)
- Hardening Infrastructure (3/3 A)
- Discovery / Explore (42/52 A+B = 81%)
- Payments & Subscriptions (14/15 A+B = 93%)

### Partial (40-70% at A/B)
- Auth & Session (6/7 A+B = 86%)
- Notifications (8/11 A+B = 73%)
- State & Cache (5/8 A = 63%)

### Weak (<40% at A/B)
- Profile & Settings (4/10 = 40%)
- Collaboration Sessions (3/7 = 43%)
- Pairing System (3/10 = 30%)
- Security & Auth (5/13 A+B = 38%)
- All cross-cutting except Chat-Resp, Infra, and State & Cache

### Unaudited (>80% at F)
- Saved / Boards (100%)
- Map & Location (100%)
- Chat / DM (100%)
- Calendar & Scheduling (100%)
- People Discovery (100%)
- Sharing & Invites (100%)
- Post-Experience (100%)
- Booking (100%)
- Error Handling (100%)
- Weather & External (100%)
- Onboarding (82%)
- Holidays & Events (86%)
- Analytics & Tracking (88%)
- App Lifecycle (82%)

## Staleness Check

All evidence dates are within 7 days (latest: 2026-03-31). No stale items.
7 payment bugs closed 2026-03-31 — audit velocity resumed. All payment bugs now closed.
Security Wave 2: 4 items regraded (D/B/C/D → D/A/C/D), 3 closed (ORCH-0253, ORCH-0258, ORCH-0252), 8 new bugs registered 2026-03-31.
Deterministic Deck Contract: 5 closed (ORCH-0266/0267/0268/0038/0048), 2 upgraded (ORCH-0065 F→B, ORCH-0066 C→B). Discovery now 81% A+B.
State Persistence: 4 closed (ORCH-0209 F→A, ORCH-0240 B→A, ORCH-0270 new→A, ORCH-0271 new→A). State & Cache now 63% A. App Lifecycle loses its only B, now 2A/9F.
