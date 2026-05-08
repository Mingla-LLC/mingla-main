# Current Build

> Status: first PMM sync completed 2026-05-08.
> Owner: `$orchestrator` for lifecycle state; `$pmm-mingla` for product-market translation.
> Authority: planning mirror only. `Mingla_Artifacts/PRIORITY_BOARD.md`, `OPEN_INVESTIGATIONS.md`, and `AGENT_HANDOFFS.md` remain lifecycle authority.

## Active Build/Test Mirror

| Feature ID | ORCH ID | Workstream | Current lifecycle state | Product impact | PMM/GTM implication | Evidence | Next action | Last synced |
|---|---|---|---|---|---|---|---|---|
| `FEAT-0004` | ORCH-0763 | Business event system regression repair | Investigation + orchestrator review approved; SPEC dispatch ready | Core event creation/publish is not trustworthy yet: published organiser events can be local-only, publish is not atomic, and wizard autosave can glitch typing. | Do not message event/media/GTM readiness; this is the top launch blocker before richer media/provider work. | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md`; `Mingla_Artifacts/reports/REVIEW_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_AUDIT.md` | Dispatch `$forensics` SPEC with `Mingla_Artifacts/prompts/SPEC_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md` | 2026-05-08 |
| `FEAT-0006` | ORCH-0758A | Event/public ticket cover media | Runtime BLOCKED/UNVERIFIED; authenticated fixture needed | Rich media is code-cleared and storage/RLS is remote-applied, but not production-runtime-cleared until a logged-in disposable business fixture proves upload/render/edit/reduced-motion behavior. | Do not announce cover media yet; prepare launch narrative around expressive event pages after runtime PASS. | `Mingla_Artifacts/PRIORITY_BOARD.md`; `reports/RETEST_ORCH-0758A_EVENT_PUBLIC_TICKET_COVER_MEDIA.md`; `reports/RUNTIME_ORCH-0758A_EVENT_COVER_MEDIA_NATIVE_QA.md` | Log in safe fixture, then rerun runtime tester QA | 2026-05-08 |
| `FEAT-0005` | ORCH-0759 | Public domain and share URL authority | Production deploy and cold-route shell cleared; real public fixture runtime smoke still blocked | The dead-domain organiser share bug and stale production bundle are cleared, but buyer-facing readiness still depends on proving a real durable public event/brand/checkout fixture and ShareModal behavior. | Position as launch-readiness infrastructure, not a visible feature. | `Mingla_Artifacts/AGENT_HANDOFFS.md`; `reports/DEPLOY_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`; `reports/RUNTIME_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`; `reports/RETEST_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md` | Finish ORCH-0763 event authority path or create a safe fixture, then rerun runtime tester smoke | 2026-05-08 |
| `FEAT-0003` | ORCH-0756B | Server-backed event drafts | Retest conditional PASS; runtime smoke/close decision next | Organiser trust depends on proving drafts survive sign-out and local data loss. | Strong "your work is safe" message only after runtime proof. | `Mingla_Artifacts/PRIORITY_BOARD.md`; `reports/RETEST_ORCH-0756B_BUSINESS_SERVER_BACKED_EVENT_DRAFTS.md` | Runtime smoke or accepted conditional deferral | 2026-05-08 |
| `FEAT-0001` | ORCH-0756A | Active brand recovery | Conditional PASS; runtime evidence or accepted deferral needed | Returning organisers must not see a false no-brand state. | No external messaging; internal trust repair. | `Mingla_Artifacts/PRIORITY_BOARD.md` | Provide runtime smoke or accept conditional close | 2026-05-08 |
| `FEAT-0002` | ORCH-0755 | Business Home chrome cleanup | Implementor dispatch ready | Truthful Home is closed, but first-screen chrome still feels noisy. | Small polish release note possible after implementation/test. | `Mingla_Artifacts/PRIORITY_BOARD.md`; ORCH-0754 close evidence | Dispatch implementor | 2026-05-08 |
| `FEAT-0002` | ORCH-0754 | Business Home no fabricated events | Closed conditional PASS under DEC-132 | Home dashboard now derives real event truth. | Can become "dashboard now shows real brand events" after ORCH-0755 polish. | `Mingla_Artifacts/DECISION_LOG.md`; `Mingla_Artifacts/PRIORITY_BOARD.md` | Keep as closed evidence; no PMM launch yet | 2026-05-08 |
| `FEAT-0016` | ORCH-0757 | Place intel failed retry and city coverage | Closed PASS; operational monitoring ongoing | Consumer discovery quality/coverage improved for city seeding operations. | Internal ops/product quality note; not consumer-facing yet. | `Mingla_Artifacts/PRIORITY_BOARD.md` | Monitor Raleigh retry terminal state | 2026-05-08 |

## PMM Read

The live work is concentrated around **trust before growth**:

- make event publish durable and server-authoritative;
- save organiser work reliably;
- stop fake or stale dashboard claims;
- make public URLs actually work;
- make event presentation rich without data-integrity regressions.

Marketing Hub, Brain, and broad organiser GTM should wait until these foundational trust blockers are closed or explicitly accepted.
