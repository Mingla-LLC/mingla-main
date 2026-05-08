# Retest Report: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Mode: RETEST  
> Verdict: CONDITIONAL PASS  
> Findings: P0:0 P1:0 P2:2 P3:1 P4:3

## 1. Layman Summary

The prior blocker is fixed. The organiser share buttons that previously produced the dead `https://business.mingla.com/e/...` links now use the central Mingla public URL builder, which points at the correct public host:

```text
https://business.usemingla.com
```

The regression gate is also fixed. It now self-tests the exact false-green shape from the prior failure: an active bad-domain URL with a nearby `platform-web-url-historical` allowlist comment must fail the scan.

This can move forward to deploy/runtime smoke, but ORCH-0759 should not be closed yet because I did not verify a current Vercel deployment/cold public URL in production. The two prior P2 follow-ons are still open.

## 2. Inputs Reviewed

- Retest prompt: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Rework report: `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Prior tester fail: `Mingla_Artifacts/reports/TEST_REPORT_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- Primary code: organiser event share surfaces, `publicUrls.ts`, strict-grep gate, public event/brand pages, public event service, draft publish service, ORCH-0759 migration.

## 3. P1-001 Retest: Organiser Share URLs

**Result: PASS**

| Required check | Evidence | Result |
|---|---|---|
| Events tab imports `eventPublicUrl` | `mingla-business/app/(tabs)/events.tsx:71` | PASS |
| Events tab ShareModal uses canonical event builder | `mingla-business/app/(tabs)/events.tsx:647-655` calls `eventPublicUrl({ brandSlug: shareEvent.brandSlug, eventSlug: shareEvent.eventSlug })` | PASS |
| Events tab no longer has local hardcoded `canonicalEventUrl` helper | `rg "canonicalEventUrl|canonicalUrl" mingla-business/app/(tabs)/events.tsx` found no local helper | PASS |
| Event Detail imports `eventPublicUrl` | `mingla-business/app/event/[id]/index.tsx:50` | PASS |
| Event Detail ShareModal uses canonical event builder | `mingla-business/app/event/[id]/index.tsx:682-690` calls `eventPublicUrl({ brandSlug: event.brandSlug, eventSlug: event.eventSlug })` | PASS |
| Event Detail no longer has local hardcoded `canonicalUrl` helper | `rg "canonicalEventUrl|canonicalUrl" mingla-business/app/event/[id]/index.tsx` found no local helper | PASS |
| Both rely on canonical encoding/origin | `mingla-business/src/constants/publicUrls.ts:30-46` uses `MINGLA_BUSINESS_WEB_URL`, trims trailing slash, requires non-empty segments, and `encodeURIComponent`s path segments | PASS |

## 4. P1-002 Retest: Strict Gate

**Result: PASS**

The strict gate now ignores historical allowlists in active scan roots and reports them as violations when the line is an active URL emitter.

Evidence:

- `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs:12` states active app/source URL emitters cannot be allowlisted as historical.
- `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs:186-203` detects nearby historical allowlist context but still reports the forbidden runtime line.
- `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs:253-292` self-tests both sides:
  - active bad-domain emitter with historical allowlist fails,
  - test fixture remains exempt.
- `mingla-business/package.json:22` includes `node ../.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs --self-test` inside `test:orch-0759`.

Self-test command result:

```text
/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs --self-test
Exit 0
Intentional violation printed for temp active-bad.tsx:
Forbidden: https://business.mingla.com URL literal hidden by active-code historical allowlist
I-PROPOSED-Y self-test: PASS
```

Real repo scan result:

```text
/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs
Exit 0
I-PROPOSED-Y gate: scanned 364 .ts/.tsx files · 0 violations · 0 read failures
```

## 5. Dead-Domain Sweep

**Active event share sweep: PASS**

```text
rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src
Exit 1 / no matches
```

Remaining broad references to old/wrong domains are not active public event share emitters:

| Reference class | Evidence | Classification |
|---|---|---|
| Canonical warning comment | `mingla-business/src/constants/platformUrl.ts:11-14` says production canonical is `https://business.usemingla.com` and warns not to hardcode old domains | Helpful comment |
| Test fixtures | `mingla-business/src/utils/__tests__/onboardReactivation.test.ts` and `mingla-business/src/constants/__tests__/publicUrls.test.ts` | Exempt tests |
| Historical implementation comments | `supabase/functions/brand-stripe-onboard/index.ts:23,39-42,77-79`, `supabase/functions/_shared/stripe.ts:42` | Historical comments |
| Active source doc comment drift | `mingla-business/src/services/brandStripeService.ts:35-41` still says return URL must start with `https://business.mingla.com/` | P3 doc/comment drift, not runtime emission |
| Route comments | `mingla-business/app/+not-found.tsx:9`, `mingla-business/app/connect-onboarding.tsx:6` | Historical/example route comments |
| Public page local `canonicalUrl` helpers | `PublicEventPage.tsx:171-172`, `PublicBrandPage.tsx:92-93` | Acceptable wrappers over `eventPublicUrl` / `brandPublicUrl`; not hardcoded |

## 6. Required Commands

| Command | Result | Notes |
|---|---|---|
| `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs --self-test` | PASS | Exit 0; intentionally prints one temp violation to prove active allowlisted bad-domain code fails. |
| `/opt/homebrew/bin/node .github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs` | PASS | Exit 0; 364 files scanned, 0 violations, 0 read failures. |
| `rg "https://business\\.mingla\\.com/e/" mingla-business/app mingla-business/src` | PASS | Exit 1/no matches. |
| `cd mingla-business && /opt/homebrew/bin/npm run test:orch-0759` | PASS | 4 suites passed, 23 tests passed. Watchman recrawl warning only. |
| `cd mingla-business && /opt/homebrew/bin/npm exec -- tsc --noEmit` | PASS | Exit 0. |
| `cd mingla-business && /opt/homebrew/bin/npm exec -- expo export -p web` | PASS | Exported `dist`; Sentry config fallback and Stripe ConnectJS SSR warning only. |
| `find mingla-business/dist -maxdepth 4 -type f \| sort \| rg 'dist/(e\|b\|checkout)'` | PASS | Found `dist/e/[brandSlug]/[eventSlug].html`, `dist/b/[brandSlug].html`, and checkout route files. |
| `/Users/sethogieva/bin/supabase migration list --linked` | PASS | `20260515000003` appears on both Local and Remote. |

Note: shell PATH did not expose `node`/`npm` in the earlier implementation context, so I used `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` for parity with that verification path.

## 7. Migration / Deploy Classification

**Migration ledger: PASS / APPLIED**

`/Users/sethogieva/bin/supabase migration list --linked` shows:

```text
20260515000003 | 20260515000003 | 2026-05-15 00:00:03
```

The ORCH-0759 migration is present on both Local and Remote. I did not run `supabase db push`.

Migration file spot-check:

- `supabase/migrations/20260515000003_orch_0759_public_event_contract.sql:1-2` creates `business_public_events_view` with `security_invoker = true`.
- `supabase/migrations/20260515000003_orch_0759_public_event_contract.sql:29` strips `theme.business_draft`.
- `supabase/migrations/20260515000003_orch_0759_public_event_contract.sql:38` grants SELECT to `anon`, `authenticated`, and `service_role`.

**New migration added by rework: NO**

Latest local migration remains `20260515000003_orch_0759_public_event_contract.sql`; the rework did not add a new migration.

**Vercel/runtime smoke: BLOCKED / NOT RUN**

I did not have a confirmed current Mingla Business Vercel deployment tied to this exact build, and I did not have a safe real event/brand fixture URL to smoke without ambiguity. These remain required before close:

- Cold public event URL: `https://business.usemingla.com/e/{brandSlug}/{eventSlug}`
- Cold public brand URL: `https://business.usemingla.com/b/{brandSlug}`
- Cold checkout URL: `https://business.usemingla.com/checkout/{eventId}`
- Runtime share-modal copy/native-share behavior on the deployed build

## 8. P2 Residual Classification

### P2-001: Public Schedule Fidelity Still Open

**Status: still open follow-on**

Evidence: `mingla-business/src/services/publicEventsService.ts:181-192` still maps:

- `date: null`
- `doorsOpen: null`
- `endsAt: null`
- `multiDates: null`

Impact: cold public event/checkout pages may render `Date TBD` for scheduled events even though the event is publicly accessible.

This was not unexpectedly fixed by the rework and should stay tracked before launch, or be explicitly accepted as transitional risk.

### P2-002: Publish Ticket Sync Atomicity Still Open

**Status: still open follow-on**

Evidence:

- `mingla-business/src/services/eventDrafts.ts:42-49` soft-deletes existing `ticket_types` rows.
- `mingla-business/src/services/eventDrafts.ts:51-56` inserts replacement rows afterward.
- `mingla-business/src/services/eventDrafts.ts:171` calls ticket sync before event promotion, which blocks publish on insert failure but does not make ticket replacement atomic.

Impact: if insert fails after soft-delete, existing ticket rows can be temporarily removed for that draft event. Retry can likely recover from draft state, but the operation is not transactional.

This was not unexpectedly fixed by the rework and should stay tracked before launch, or be explicitly accepted as transitional risk with failure-path coverage.

## 9. Findings

### P2 Medium

**P2-001: Public event schedule fields are still dropped by the public mapper**

- Evidence: `publicEventsService.ts:181-192`.
- User impact: public event and checkout pages can show incomplete date/time information.
- Required next step: fix safe schedule read model or register an explicit launch follow-on/deferral.

**P2-002: Publish ticket sync is still non-atomic**

- Evidence: `eventDrafts.ts:42-56`, `eventDrafts.ts:171-190`.
- User impact: insert failure after soft-delete can leave draft ticket rows temporarily empty.
- Required next step: transactional/upsert rework or explicit accepted transitional risk with failure-path test.

### P3 Low

**P3-001: One active source doc comment still names the dead onboarding return domain**

- Evidence: `mingla-business/src/services/brandStripeService.ts:35-41`.
- What is wrong: the comment says `returnUrl` must start with `https://business.mingla.com/`.
- Why not a blocker here: runtime validation lives in the edge function and now uses env-backed `ONBOARDING_PAGE_URL`; this comment is not an active emitter and strict-grep correctly ignores comment-only historical text.
- Suggested next step: clean up in the next doc/comment drift sweep so future implementors do not copy the old host.

### P4 Notes

**P4-001:** Prior P1-001 and P1-002 are resolved.

**P4-002:** Build/test/export gates pass locally.

**P4-003:** Production close remains dependent on a deployed current build and cold-link smoke on `business.usemingla.com`.

## 10. Implementor Rework Required?

**No P1 implementor rework is required for the original blockers.**

The rework correctly fixed:

- Events tab manage-share dead-domain URL.
- Event Detail share dead-domain URL.
- Strict gate false-green historical allowlist loophole.

Follow-on work is still required or must be explicitly accepted for:

- P2 public schedule fidelity.
- P2 ticket sync atomicity.
- P3 stale source comment drift.

## 11. Release Movement

ORCH-0759 can move to:

1. **Deploy/runtime smoke:** deploy Mingla Business current build, then smoke cold `/e`, `/b`, and `/checkout` URLs on `https://business.usemingla.com`.
2. **Close review after smoke:** only after runtime share modal and cold-link checks pass.
3. **Follow-on registration:** keep the two P2s visible before launch; clean stale old-domain comments in a small hygiene pass.

ORCH-0759 should **not** be marked closed from this report alone because Vercel/cold runtime proof was not run.
