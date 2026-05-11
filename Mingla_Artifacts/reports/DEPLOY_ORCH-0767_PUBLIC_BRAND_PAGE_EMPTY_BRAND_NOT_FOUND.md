# DEPLOY ORCH-0767 — Public Brand Page Empty-Brand Repair

## Verdict

Deployment gate cleared for tester dispatch.

## Operator Confirmation

Operator reported `supabase db push` was run.

Codex verified the linked remote migration list contains:

```text
20260515000008 | 20260515000008 | 2026-05-15 00:00:08
```

Migration now remote-applied:

- `supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql`

## Business Web Deploy

Local export command:

```bash
cd mingla-business
npx expo export -p web
```

Result:

- Export succeeded.
- Web bundle: `entry-5b71362373d8182d624664108373ae98.js`
- Static route list included `/b/[brandSlug]`, `/e/[brandSlug]/[eventSlug]`, `/checkout/[eventId]`, and `/stripe-onboarding-return`.

Production deploy was run through the Vercel `mingla-business` project from a clean staging directory:

```bash
PATH="/opt/homebrew/bin:$PATH" \
VERCEL_PROJECT_ID="prj_UW5gLA7bTGokcBS58cUVI5BWMsSs" \
VERCEL_ORG_ID="team_o5qomeuRsSoNmHsazAK5jQvm" \
npx vercel deploy --prod --yes --local-config mingla-business/vercel.json
```

Vercel result:

```text
Deployment completed
Aliased: https://business.usemingla.com
id: dpl_3VF7k3XSuqXbEBHAJZnYBzK2UeFT
url: https://mingla-business-1zv95bbyy-seth-ogievas-projects.vercel.app
readyState: READY
target: production
```

Inspector:

```text
https://vercel.com/seth-ogievas-projects/mingla-business/3VF7k3XSuqXbEBHAJZnYBzK2UeFT
```

Build notes:

- Vercel build completed in about 2 minutes.
- Build emitted the known Stripe ConnectJS SSR warning. This was previously documented as non-blocking by the build output: ConnectJS loads only in browser.
- `npm install` reported existing audit warnings: 8 vulnerabilities, 6 moderate and 2 high. This deploy did not address dependency audit posture.

## DB Smoke

Anon REST against the new public brand view:

```text
business_public_brands_view?slug=eq.brand3&select=id,slug,name
=> [{"id":"304f90b2-e97e-4365-b221-6f9d161a23ec","slug":"brand3","name":"Brand 3"}]
```

Anon REST against public events for the same brand:

```text
business_public_events_view?brand_slug=eq.brand3&select=id,brand_slug,title,slug,status,visibility
=> []
```

This proves the exact ORCH-0767 target fixture exists as a real empty public brand profile.

Control fixtures:

```text
business_public_brands_view?slug=eq.teststripe
=> Test Stripe

business_public_events_view?brand_slug=eq.teststripe
=> public scheduled event rows present
```

```text
business_public_brands_view?slug=eq.leggothis
=> Leggo This

business_public_events_view?brand_slug=eq.leggothis
=> public scheduled event rows present
```

## Production Smoke

### Human App Shell Routes

```text
https://business.usemingla.com/b/brand3?orch0767_smoke=1
HTTP/2 200
content-disposition: inline; filename="[brandSlug]"
```

```text
https://business.usemingla.com/b/__definitely_missing_orch_0767__?orch0767_smoke=1
HTTP/2 200
content-disposition: inline; filename="[brandSlug]"
```

Note: human app-shell routes return the Expo app shell. The actual missing-brand UI is client-rendered, so crawler/API routes below are the stronger server-visible proof. Tester should still check browser UI.

### Crawler Brand Route

Command shape:

```bash
curl -A 'Twitterbot/1.0' https://business.usemingla.com/b/brand3?orch0767_smoke=1
```

Observed snippets:

```text
<title>Brand 3 on Mingla</title>
property="og:title" content="Brand 3 on Mingla"
property="og:url" content="https://business.usemingla.com/b/brand3"
No upcoming events yet
```

No `Brand not found` or `We couldn't find that brand` copy was observed in the crawler response.

### Crawler Missing Brand Route

```text
https://business.usemingla.com/b/__definitely_missing_orch_0767__?orch0767_smoke=1
HTTP/2 404
```

Observed snippets:

```text
<title>Brand not found</title>
Brand not found
```

### Direct Public Brand API

```text
https://business.usemingla.com/api/public-brand?brandSlug=brand3&orch0767_smoke=1
HTTP/2 200
```

Observed snippets:

```text
<title>Brand 3 on Mingla</title>
property="og:title" content="Brand 3 on Mingla"
No upcoming events yet
```

### Brand OG Route

```text
https://business.usemingla.com/og/brand/brand3.png?orch0767_smoke=1
HTTP/2 200
content-type: image/png
```

### Deployed Bundle Check

Current deployed root bundle:

```text
/_expo/static/js/web/entry-4655dbe433b829799665c30a4f4cc10b.js
```

Bundle scan:

```text
business_public_brands_view     present
business_public_events_view     present
No upcoming events yet          present
```

## Next Gate

Dispatch:

- `Mingla_Artifacts/prompts/TESTER_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`

Tester should verify:

1. Remote migration `20260515000008` remains present.
2. Private/signed-out browser UI for `https://business.usemingla.com/b/brand3` renders Brand 3 and a zero-event state.
3. Missing slug remains not-found in the app UI and crawler route.
4. Populated brand still renders public event cards.
5. Public-brand crawler HTML and OG route remain brand-specific.
6. New public view does not expose private brand fields.
