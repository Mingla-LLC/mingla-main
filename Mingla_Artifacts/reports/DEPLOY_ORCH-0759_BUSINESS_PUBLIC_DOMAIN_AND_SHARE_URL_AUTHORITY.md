# Deploy Report: Business Public Domain and Share URL Authority (ORCH-0759)

> Date: 2026-05-08  
> Mode: Production deploy + post-deploy smoke  
> Result: DEPLOYED  
> Close status: not closed; real public fixture smoke still needed

## Summary

Mingla Business web was deployed to Vercel production and aliased to:

```text
https://business.usemingla.com
```

The deployment fixed the stale-build runtime failure found in `reports/RUNTIME_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`: the deployed app shell is now current enough that `/e`, `/b`, and `/checkout` cold paths return HTTP 200 instead of Vercel `404 NOT_FOUND`, and the deployed bundle no longer contains the old wrong-domain strings.

## Deploy Evidence

Command shape used:

```bash
PATH="/opt/homebrew/bin:$PATH" \
VERCEL_PROJECT_ID="prj_UW5gLA7bTGokcBS58cUVI5BWMsSs" \
VERCEL_ORG_ID="team_o5qomeuRsSoNmHsazAK5jQvm" \
/opt/homebrew/bin/npx vercel deploy --prod --yes --local-config mingla-business/vercel.json
```

The deploy had to be run from a clean staging directory containing only the `mingla-business` project because the monorepo root is separately linked to `mingla-marketing`, and uploading the whole repo exceeded Vercel's request-body limit.

Vercel output:

```text
Deployment completed
Aliased: https://business.usemingla.com
id: dpl_CK18BBz4iRpYtz91jdDRpniCgNKm
url: https://mingla-business-5z0xxzb7a-seth-ogievas-projects.vercel.app
readyState: READY
target: production
```

`vercel inspect` confirmed aliases:

```text
https://business.usemingla.com
https://mingla-business-web.vercel.app
https://mingla-business-seth-ogievas-projects.vercel.app
https://mingla-business-sethogieva-seth-ogievas-projects.vercel.app
```

## Post-Deploy Smoke

### Root

```text
https://business.usemingla.com/?orch0759_post_deploy=1
HTTP/2 200
last-modified: Fri, 08 May 2026 11:20:43 GMT
entry bundle: /_expo/static/js/web/entry-3b52cf79f260b02be9191e789b2db99f.js
```

### Cold Dynamic Routes

```text
https://business.usemingla.com/e/__codex_probe__/__codex_probe__
HTTP/2 200
content-disposition: inline; filename="[eventSlug]"
```

```text
https://business.usemingla.com/b/__codex_probe__
HTTP/2 200
content-disposition: inline; filename="[brandSlug]"
```

```text
https://business.usemingla.com/checkout/__codex_probe__
HTTP/2 200
content-disposition: inline; filename="[eventId]"
```

This clears the prior Vercel platform 404 symptom for cold dynamic route delivery.

### Wrong-Domain Bundle Scan

Downloaded deployed bundle:

```text
/tmp/orch0759_post_entry.js
SHA-256: 57267b2624f697ce95292b72266673cb0acdfad267cf4861a4427590e213e1a4
```

Command:

```bash
rg -n "https://business\\.mingla\\.com|mingla\\.com/e/" /tmp/orch0759_post_entry.js
```

Result: no matches.

The deployed bundle now contains `eventPublicUrl(...)`, `brandPublicUrl(...)`, `checkoutPublicUrl(...)`, and `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL:"https://business.usemingla.com"`.

## Remaining Gate

The public view is currently readable but has no public fixture rows:

```text
GET business_public_events_view?select=id,brand_slug,slug,title,brand_name,status,visibility&limit=10
HTTP 200
[]
```

Because there is no safe public event fixture, I could not prove real data rendering or actual public event/brand share-copy behavior against:

- `https://business.usemingla.com/e/{brandSlug}/{eventSlug}`
- `https://business.usemingla.com/b/{brandSlug}`
- `https://business.usemingla.com/checkout/{eventId}`

## Next Step

Create or identify one safe public scheduled/live event fixture, then re-dispatch:

```text
Mingla_Artifacts/prompts/TESTER_RUNTIME_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md
```

Expected output:

```text
Mingla_Artifacts/reports/RUNTIME_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md
```

ORCH-0759 is deploy-cleared for stale bundle and route delivery, but not closeable until real fixture runtime smoke passes or is explicitly accepted as a conditional/manual deferral.
