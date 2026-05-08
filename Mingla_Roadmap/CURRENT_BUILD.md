# Current Build

> Status: first PMM sync completed 2026-05-08.
> Owner: `$orchestrator` for lifecycle state; `$pmm-mingla` for product-market translation.
> Authority: planning mirror only. `Mingla_Artifacts/PRIORITY_BOARD.md`, `OPEN_INVESTIGATIONS.md`, and `AGENT_HANDOFFS.md` remain lifecycle authority.

## Active Build/Test Mirror

| Feature ID | ORCH ID | Workstream | Current lifecycle state | Product impact | PMM/GTM implication | Evidence | Next action | Last synced |
|---|---|---|---|---|---|---|---|---|
| `FEAT-0006` | ORCH-0758A | Event/public ticket cover media | Retest conditional PASS; DB/native/runtime gate next | Rich media is code-cleared but not production-runtime-cleared until storage migration, native `expo-video`, and device QA pass. | Do not announce cover media yet; prepare launch narrative around expressive event pages after runtime PASS. | `Mingla_Artifacts/PRIORITY_BOARD.md`; `reports/RETEST_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md`; `reports/IMPLEMENTATION_REWORK_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md` | Operator DB/native readiness, then runtime tester QA | 2026-05-08 |
| `FEAT-0005` | ORCH-0759 | Public domain and share URL authority | Implementation returned; tester dispatch ready | Shared public event links are a buyer-conversion S1 blocker; implementation claims canonical/server-backed route repair. | Position as launch-readiness infrastructure, not a visible feature. | `Mingla_Artifacts/AGENT_HANDOFFS.md`; `reports/INVESTIGATION_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`; `reports/IMPLEMENTATION_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md` | Dispatch tester, then DB push/Vercel/cold-link smoke if QA permits | 2026-05-08 |
| `FEAT-0003` | ORCH-0756B | Server-backed event drafts | Retest conditional PASS; runtime smoke/close decision next | Organiser trust depends on proving drafts survive sign-out and local data loss. | Strong "your work is safe" message only after runtime proof. | `Mingla_Artifacts/PRIORITY_BOARD.md`; `reports/RETEST_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md` | Runtime smoke or accepted conditional deferral | 2026-05-08 |
| `FEAT-0001` | ORCH-0756A | Active brand recovery | Conditional PASS; runtime evidence or accepted deferral needed | Returning organisers must not see a false no-brand state. | No external messaging; internal trust repair. | `Mingla_Artifacts/PRIORITY_BOARD.md` | Provide runtime smoke or accept conditional close | 2026-05-08 |
| `FEAT-0002` | ORCH-0755 | Business Home chrome cleanup | Implementor dispatch ready | Truthful Home is closed, but first-screen chrome still feels noisy. | Small polish release note possible after implementation/test. | `Mingla_Artifacts/PRIORITY_BOARD.md`; ORCH-0754 close evidence | Dispatch implementor | 2026-05-08 |
| `FEAT-0002` | ORCH-0754 | Business Home no fabricated events | Closed conditional PASS under DEC-132 | Home dashboard now derives real event truth. | Can become "dashboard now shows real brand events" after ORCH-0755 polish. | `Mingla_Artifacts/DECISION_LOG.md`; `Mingla_Artifacts/PRIORITY_BOARD.md` | Keep as closed evidence; no PMM launch yet | 2026-05-08 |
| `FEAT-0016` | ORCH-0757 | Place intel failed retry and city coverage | Closed PASS; operational monitoring ongoing | Consumer discovery quality/coverage improved for city seeding operations. | Internal ops/product quality note; not consumer-facing yet. | `Mingla_Artifacts/PRIORITY_BOARD.md` | Monitor Raleigh retry terminal state | 2026-05-08 |

## PMM Read

The live work is concentrated around **trust before growth**:

- save organiser work reliably;
- stop fake or stale dashboard claims;
- make public URLs actually work;
- make event presentation rich without data-integrity regressions.

Marketing Hub, Brain, and broad organiser GTM should wait until these foundational trust blockers are closed or explicitly accepted.
