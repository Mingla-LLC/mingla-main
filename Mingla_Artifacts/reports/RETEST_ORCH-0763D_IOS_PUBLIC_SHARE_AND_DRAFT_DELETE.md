# Retest: ORCH-0763D iOS Public Share + Draft Delete

> Date: 2026-05-09  
> Role: TESTER / RETEST  
> Verdict: FAIL  
> Dispatch: `Mingla_Artifacts/prompts/TESTER_RETEST_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`

## Plain-English Verdict

The code-level fix is in good shape, and the normal in-app `Copy link` button now copies the correct public URL. But the user-critical `Share via... -> iOS Copy` path still does not copy the URL in runtime, and the deployed public web page is still serving an old bundle that does not contain the new share fix.

This cannot close.

## P1 Blockers

### P1-1: Native app `Share via... -> Copy` does not update the pasteboard

Runtime path tested on the correct simulator:

- Device: `iPhone 17 Pro`, UDID `17091E60-C3B6-4167-980D-60C348E177F6`
- App: `com.sethogieva.minglabusiness`
- Brand: `Test Stripe`
- Event: `The ripe`
- Share modal displayed URL: `https://business.usemingla.com/e/teststripe/the-ripe`

Evidence:

1. Set simulator pasteboard to sentinel:

   ```bash
   printf 'sentinel-before-share-via' | xcrun simctl pbcopy 17091E60-C3B6-4167-980D-60C348E177F6
   ```

2. Opened event manage menu with Maestro.
3. Tapped `Share event`.
4. Tapped `Share via...`.
5. iOS share sheet preview showed `business.usemingla.com`.
6. Tapped iOS share sheet `Copy`.
7. Checked pasteboards:

   ```text
   HOST_PASTEBOARD=sentinel-before-share-via
   SIM_PASTEBOARD=sentinel-before-share-via
   ```

Expected:

```text
https://business.usemingla.com/e/teststripe/the-ripe
```

Actual:

```text
sentinel-before-share-via
```

Why this blocks:

The retest prompt explicitly fails paths that copy nothing. The share sheet visibly opened with the right host, but the iOS Copy action did not put the URL onto the simulator or host pasteboard.

### P1-2: Deployed public web is stale, so Safari public-page share is not launch-proven

Checked deployed public event page:

```bash
curl -I -L https://business.usemingla.com/e/leggothis/test-event
```

Evidence:

```text
HTTP/2 200
server: Vercel
x-vercel-cache: HIT
last-modified: Fri, 08 May 2026 18:48:51 GMT
```

Downloaded deployed JS:

```bash
curl -L https://business.usemingla.com/_expo/static/js/web/entry-3b52cf79f260b02be9191e789b2db99f.js -o /tmp/orch0763d-entry.js
```

The deployed bundle still contains old share code:

```text
await e.share({title:v,url:f,text:I})
```

and the public event page direct share path still contains:

```text
await n.share({title:e.name,url:t})
```

Current source uses `sharePublicUrl(...)` and `buildPublicShareText(...)`, but deployed public web does not. Therefore Safari public-page `Share via... -> Copy` is `BLOCKED_WEB_DEPLOY`, not verified.

## Verified Passing

### Migration remote-applied

Command:

```bash
/Users/sethogieva/bin/supabase migration list --linked
```

Evidence:

```text
20260515000006 | 20260515000006 | 2026-05-15 00:00:06
```

Migration `20260515000006_orch_0763d_draft_discard_rpc.sql` is applied on both Local and Remote.

### Static source verification passed

Verified:

- `mingla-business/src/utils/sharePublicUrl.ts`
  - `buildPublicShareText(...)` appends the URL to text.
  - Web `navigator.share(...)` includes both `url` and URL-bearing `text`.
  - Native `Share.share(...)` includes URL in `message` and `url`.
- `mingla-business/src/services/eventDrafts.ts`
  - `discardServerDraft(...)` calls `business_discard_event_draft`.
- `supabase/migrations/20260515000006_orch_0763d_draft_discard_rpc.sql`
  - RPC is `SECURITY DEFINER`.
  - Uses `auth.uid()`.
  - Locks row `FOR UPDATE`.
  - Allows only `status = 'draft'`.
  - Enforces `event_manager` rank.
  - Soft-deletes with `deleted_at`.
  - Grants execute to `authenticated` and `service_role`.
- `mingla-business/app/(tabs)/events.tsx`
  - local-only drafts delete locally.
  - server-backed drafts call RPC mutation.
  - delete modal carries pending state and inline `errorMessage`.

### Automated gates passed

Commands run:

```bash
cd mingla-business
npx jest sharePublicUrl.test serverDraftLifecycleGuards.test publicUrls.test
```

Result:

```text
3 suites passed, 26 tests passed
```

```bash
cd mingla-business
npm run test:orch-0763
```

Result:

```text
7 suites passed, 46 tests passed
```

```bash
cd mingla-business
npm run test:orch-0759
```

Result:

```text
I-PROPOSED-Y real scan: 0 violations
4 suites passed, 29 tests passed
```

Note: the printed `active-bad.tsx` wrong-domain violation is the expected strict-grep self-test.

```bash
cd mingla-business
npm run test:orch-0756b
```

Result:

```text
2 suites passed, 24 tests passed
```

```bash
cd mingla-business
npx tsc --noEmit
```

Result: passed.

```bash
cd mingla-business
npx eslint src/utils/sharePublicUrl.ts src/utils/__tests__/sharePublicUrl.test.ts src/services/eventDrafts.ts src/hooks/useServerDraftEvents.ts src/hooks/useBusinessEvents.ts 'app/(tabs)/events.tsx' src/components/event/EventCreatorWizard.tsx 'app/event/[id]/edit.tsx' src/components/ui/ConfirmDialog.tsx src/utils/__tests__/serverDraftLifecycleGuards.test.ts
```

Result: passed.

```bash
git diff --check
```

Result: passed.

### Native app `Copy link` passed

Runtime path:

1. Opened Events screen in the right simulator.
2. Opened `The ripe` manage menu.
3. Tapped `Share event`.
4. Tapped in-app `Copy link`.
5. Read simulator pasteboard.

Actual pasteboard:

```text
https://business.usemingla.com/e/teststripe/the-ripe
```

This passes the canonical-domain requirement for the direct Copy button.

## Not Fully Verified

### Draft delete UI runtime

Status: `BLOCKED_FIXTURE`

Evidence:

- Events screen showed `Drafts 0`.
- Attempted to create a disposable draft through the UI.
- App switched to `Create brand` / `Loading brands`, then surfaced:

```text
[useCreateServerDraft] Operation failed: Au...
```

No safe server-backed draft was available to delete through the UI. Static and DB gates for the new RPC passed, but runtime draft deletion remains unverified.

### Fresh free-event publish/share smoke

Status: `BLOCKED_BY_RUNTIME_FAIL_AND_FIXTURE_SAFETY`

Reason:

The test already found a P1 share failure. Creating and publishing another event would not change that verdict, and fixture/auth state was unstable after the create-draft attempt.

### Public brand page share parity

Status: `BLOCKED_WEB_DEPLOY`

Reason:

The deployed web bundle is stale and still contains old `ShareModal` web code. Brand-page Safari share cannot be accepted until the current web bundle is deployed.

## Required Rework

1. Fix native app `Share via... -> iOS Copy` so selecting Copy from the iOS share sheet actually places the canonical URL onto the pasteboard, or replace/augment that path with a proven native flow that cannot silently copy nothing.
2. Deploy the current `mingla-business` web bundle to `business.usemingla.com`.
3. Re-run this tester prompt after deploy with exact pasteboard evidence for:
   - public event page `Copy link`;
   - public event page `Share via... -> iOS Copy`;
   - public brand page share parity;
   - business app `Copy link`;
   - business app `Share via... -> iOS Copy`;
   - server-backed draft delete through UI.

## Residual Risk

The current source-level contract is much better than before, but runtime proves one official share path still fails from the user perspective. Until this passes on-device/simulator, users can still tap a share button, choose Copy, and end up with no usable link.

