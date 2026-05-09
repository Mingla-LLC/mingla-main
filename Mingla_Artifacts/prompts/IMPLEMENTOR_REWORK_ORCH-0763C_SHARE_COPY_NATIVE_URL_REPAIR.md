# IMPLEMENTOR REWORK PROMPT: ORCH-0763C Share/Copy Native URL Repair

You are `$implementor` for Mingla. Fix the ORCH-0763 runtime blocker where the visible public event URL is correct, but the share/copy actions do not actually deliver that canonical public URL.

## Required Output

Write:

`Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763C_SHARE_COPY_NATIVE_URL_REPAIR.md`

## User-Visible Runtime Finding

Operator runtime check after DB push:

- Opening/copying the actual visible link works.
- Tapping **Copy link** copies nothing.
- Tapping **Share via...** opens the phone share sheet, but the payload shared is an Expo/dev app link instead of the SEO-friendly public event webpage.

Expected shared/copied URL:

`https://business.usemingla.com/e/{brandSlug}/{eventSlug}`

Never acceptable for event public sharing:

- `exp://...`
- Expo Go/dev-client URLs
- localhost/LAN URLs
- app deep links
- `business.mingla.com`
- `mingla.com/e/...`
- `draft-*` public event slugs

## Evidence Already Proven

Read before editing:

- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0763_BUSINESS_EVENT_SYSTEM_REGRESSION_REPAIR.md`
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/app/event/[id]/index.tsx`
- `mingla-business/app/(tabs)/events.tsx`
- `mingla-business/src/constants/publicUrls.ts`
- `mingla-business/src/constants/platformUrl.ts`

Observed code evidence:

- `ShareModal.tsx` native Copy path currently does not write to clipboard; it only shows the toast "Tap Share via to copy on iOS / Android."
- `mingla-business/package.json` does not currently list `expo-clipboard`.
- `ShareModal.tsx` native Share path uses React Native `Share.share({ message: ..., url })`; on the operator device this produced an Expo/dev link instead of the canonical public event webpage.
- `PublicEventPage.tsx` also has a direct native `Share.share({ message, url })` path that must be checked for the same failure class.

## Required Fix

1. Native Copy must actually copy the canonical URL.
   - Use a supported Expo/RN clipboard implementation.
   - If adding `expo-clipboard`, update dependency files correctly and report native rebuild/dev-client implications.
   - Keep web clipboard behavior intact.
   - Toast only after a real successful clipboard write; show honest failure otherwise.

2. Native Share must share the canonical public web URL, not the current app/development URL.
   - Make the native share payload deterministic and platform-safe.
   - The shared text must contain the canonical `business.usemingla.com/e/...` URL.
   - Avoid any payload shape that lets Expo Go/dev-client/current route override the intended URL.
   - Apply the fix to the reusable `ShareModal` and any direct public event share path that bypasses it.

3. Preserve the current good behavior.
   - The visible URL box stays clickable.
   - Event Detail / Events tab / Public Event Page continue to pass URLs from `eventPublicUrl`.
   - Brand sharing should not regress if it uses the same modal.

4. Add regression coverage.
   - Add tests or source guards proving native copy uses a real clipboard implementation.
   - Add tests for the native share payload builder or equivalent helper, proving it includes the canonical URL and excludes Expo/dev/local URLs.
   - Extend ORCH-0763 guard coverage so this cannot silently regress.

## Verification To Run

From `mingla-business/`:

```bash
npm run test:orch-0763
npm run test:orch-0759
npm run test:orch-0756b
npx tsc --noEmit
```

Run targeted ESLint on touched files.

From repo root:

```bash
git diff --check
```

If a new native dependency is added, explicitly state whether a dev-client/native rebuild is required before the operator can verify on device.

## Hard Guards

- Do not run `supabase db push`.
- Do not deploy.
- Do not mutate production data.
- Do not broaden into unrelated share/social redesign.
- Do not change canonical URL authority away from `eventPublicUrl` / `business.usemingla.com`.

## Report Requirements

Include:

1. Files changed.
2. Exact copy/share root cause.
3. How the native copy path now writes to clipboard.
4. How the native share payload is forced to canonical public URL.
5. Dependency/native rebuild implications.
6. Tests/gates run with results.
7. Remaining manual runtime smoke steps for tester.
