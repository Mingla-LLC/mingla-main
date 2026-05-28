# Implementation Report: Marketing Support Page (ORCH-0977)

> Date: 2026-05-28
> Mode: Design and Build
> Spec: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0977-[consumer-app-store-launch]/Mingla_Artifacts/IMPLEMENTOR_DISPATCH_ORCH-0977_MARKETING_SUPPORT_PAGE.md`
> Status: implemented and verified

## 1. Layman Summary

Mingla now has a real public Support page for App Store Connect and Google Play support-link requirements. The homepage hero also exposes a Support pill, so users can reach the page from the marketing entry point.

## 2. Request And Context

- **Request:** Add `/support` to `mingla-marketing` and add a Support hero footer chip.
- **Source:** ORCH-0977 consumer app store launch implementor dispatch.
- **Affected surfaces:** Mingla marketing web.
- **Related issues/artifacts:** ORCH-0977 launch checklist contact/support URL requirement.

## 3. Scope

- **In scope:** Static Support page, hero chip link, automated static regression check, local build and visual smoke check.
- **Out of scope:** Contact forms, backend ticketing, Privacy/Terms modal logic, `privacyContent.ts`, `termsContent.ts`, consumer app changes.
- **Assumptions:** The root layout title template remains `%s — Mingla`, so the page metadata title must stay `Support`.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `COMMS_LEDGER.md` | Mandatory entry check | No ORCH-0977 BLOCK; WARN context was already acknowledged and factored. |
| `mingla-marketing/app/delete-account/page.tsx` | Page pattern | Dark background, `max-w-3xl`, Back to Mingla link, warm contact box pattern. |
| `mingla-marketing/app/privacy-policy/page.tsx` | Page pattern | Same legal-page shell and card styling. |
| `mingla-marketing/app/terms-of-service/page.tsx` | Page pattern | Same legal-page shell and card styling. |
| `mingla-marketing/app/layout.tsx` | Metadata behavior | Root template appends `— Mingla`. |
| `mingla-marketing/components/sections/explorer-home/hero.tsx` | Hero chip behavior | `/privacy` and `/terms` are modal buttons; other chips render as `Link`. |

## 5. Blast Radius

- **Direct changes:** New static support route, one new SITE_CHIPS entry, one static regression script.
- **Cascade changes:** Next static route table now includes `/support`.
- **Parity surfaces:** Marketing web only.
- **Cache impact:** None.
- **State boundaries:** None.
- **Auth/RLS/security:** None.
- **Deploy path:** Vercel marketing deployment after PR merge; commit includes `[deploy]`.

## 6. Old To New Receipts

### `mingla-marketing/app/support/page.tsx`

- **Before:** No real `/support` page existed.
- **After:** Static support page with support email, quick links, account deletion note, and `title: 'Support'`.
- **Why:** App Store Connect requires a real Support URL.
- **Approx lines changed:** 96 added.

### `mingla-marketing/components/sections/explorer-home/hero.tsx`

- **Before:** Footer chips were Organiser, About, Privacy, Terms.
- **After:** Support appears between About and Privacy and renders as `<Link href="/support">`.
- **Why:** Make the support page discoverable from the marketing homepage.
- **Approx lines changed:** 1 added.

### `mingla-marketing/scripts/verify-support-page.mjs`

- **Before:** No automated check covered the Support page contract.
- **After:** Dependency-free regression script asserts page content, metadata guard, mailto, quick links, and chip order.
- **Why:** Preserve a repo-running regression gate that would fail before this feature.
- **Approx lines changed:** 43 added.

## 7. Implementation Details

- **Architecture decisions:** Static Next App Router page, matching the existing delete-account/legal page visual shell.
- **Data flow:** None.
- **Mutation/query behavior:** None.
- **State handling:** None.
- **Error handling:** Not applicable for a static page.
- **Copy/accessibility:** Internal links use `next/link`; email uses `mailto:`; Back to Mingla and focus-ring styles match existing pages.
- **Analytics/notifications/realtime:** None.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| `/support` page exists | Yes | `npm run build`; curl/dev-server smoke | Pass |
| Matches dark page pattern | Yes | Visual screenshot at 375px and source comparison | Pass |
| Metadata title is `Support` only | Yes | curl showed `Support — Mingla` rendered once | Pass |
| `mailto:support@usemingla.com` exists | Yes | Regression script and curl smoke | Pass |
| Quick links resolve to specified routes | Yes | Regression script and curl smoke | Pass |
| Account deletion in-app note exists | Yes | Regression script and curl smoke | Pass |
| Support chip between About and Privacy | Yes | Regression script and 375px screenshot | Pass |
| Build passes | Yes | `npm run build` | Pass |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| Read before writing | Yes | Yes | Read dispatch, page patterns, layout metadata, hero. |
| No new dependencies | Yes | Yes | Regression uses Node built-ins only. |
| Privacy/Terms content untouched | Yes | Yes | No edits to modal logic or content modules. |
| Scoped staging | Yes | Yes | Commit includes only support page, hero chip, regression script, and this report. |

## 10. Parity Check

- **Mobile:** 375px screenshot confirmed hero chips fit cleanly in one row.
- **Business app:** Not applicable.
- **Admin:** Not applicable.
- **Public/web:** Support page and hero link added.
- **Solo/collab:** Not applicable.
- **Gaps:** None.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** Static route only.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| UI/UX pre-flight | `python3 .codex/skills/ui-ux-mingla/scripts/search.py "marketing support page dark card accessibility links" --stack nextjs -p "Mingla marketing support page"` | Pass | Confirmed Next link guidance; local pattern controlled design. |
| Regression script | `cd mingla-marketing && node scripts/verify-support-page.mjs` | Pass | Asserts static contract and chip order. |
| Production build | `cd mingla-marketing && npm run build` | Pass | Route table includes `/support`; seven app routes listed. |
| Mobile hero screenshot | `npx playwright screenshot --browser=chromium --viewport-size=375,812 --wait-for-timeout=2500 http://127.0.0.1:3027/ /tmp/mingla-support-hero-mobile-wait.png` | Pass | Support chip fits between About and Privacy. |
| Mobile support screenshot | `npx playwright screenshot --browser=chromium --viewport-size=375,812 http://127.0.0.1:3027/support /tmp/mingla-support-page-mobile.png` | Pass | Page matches dark card pattern. |
| Metadata/content smoke | `curl -s http://127.0.0.1:3027/support` | Pass | Rendered title was `Support — Mingla`; content and links present. |

## 13. Regression Surface

1. Homepage hero chip row on narrow mobile widths.
2. Support page metadata title suffix behavior.
3. Static export/build route generation for marketing app.

## 14. Risks, Limitations, Transition Items

None.

## 15. Discoveries For Orchestrator

- None.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** None.
- **Business/admin web:** None.
- **Env vars/secrets:** None.
- **Post-deploy:** Set App Store Connect Support URL to `https://www.usemingla.com/support`; verify deployed URL returns 200 and shows support content.

## Suggested Commit Message

```text
ORCH-0977 marketing: add support page [deploy]
```

## Ready-To-Test Checklist

1. Open `/support` and confirm the page shows `How can we help?`, `support@usemingla.com`, and the quick links.
2. Open `/` at mobile width and confirm the footer chip order is About, Support, Privacy, Terms.
3. Confirm the browser title for `/support` renders `Support — Mingla`.
