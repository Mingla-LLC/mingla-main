# Source Summary: Mingla Brain Strategy

> Source path: `Mingla_Artifacts/MINGLA_BRAIN_AGENT_STRATEGY.md`
> Source date: registered 2026-05-06
> Summary date: 2026-05-08
> Owner: `$pmm-mingla`
> Confidence: Medium for strategy; low for readiness because it is explicitly pre-spec.

## Staleness

This is a brainstorm lock-in, not implementation authority. It explicitly says no implementation dispatched.

## Decision Overrides

- AI cannot ship before mechanical capabilities exist.
- Ads phase requires the B5 mechanical ads workflow and optimizer to be Grade A.
- Agent must use existing/backend source-of-truth tools, not invent state.

## Extracted Product Claims

- One Claude-powered agent spans consumer, business, and admin personas.
- Six required capabilities: query/generate deck cards, create events/experiences, compile ticket details, support intake, run ads, accept payment.
- Architecture: one chat layer, persona switch, many small tools over Supabase.
- Phases: P1 foundation, P2 business/payments, P3 ads, P4 memory/polish.

## Extracted GTM / Positioning Claims

- AI is a productivity layer, not the foundation.
- Business monetization hypothesis includes Mingla Business subscription and ad orchestration.
- Consumer agent can support Mingla+ monetization if cost controls and turn caps work.

## Affected Feature IDs

`FEAT-0015`, `FEAT-0014`, `FEAT-0016`, `FEAT-0017`.

## Open Questions

- Which phase ships first.
- Where the chat sheet lives in consumer UI.
- Whether voice/image generation needs a higher tier.
- What spend cap belongs in the business tier.
