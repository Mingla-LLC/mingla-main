# REVIEW - ORCH-1093 Business Web Signed-In Route OOM Rework

Date: 2026-06-06
Reviewer: orchestrator-mingla / Codex
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1093-[business-web-signedin-route-oom]`
Branch: `ORCH-1093-business-web-signedin-route-oom`
Reviewed implementation commit: `f7cb68472`

## Verdict

FAIL - rework required. The implementation improves fail-closed behavior for protected routes, but it does not solve signed-in approved-route OOM on physical Android Chrome.

The current guard reports `eager=0` because Expo boot scripts are moved from static `<script src>` tags into the ORCH-1093 deferred loader. That is not sufficient proof: approved routes still load the same deferred Expo boot payload (`__common` about 1.88 MB raw + `index` about 999 KB raw + runtime), and the physical phone still hits V8 OOM when a real business session is present.

## What Passed

- `npm run test:orch-1093` passed locally.
- `npx expo export -p web` passed.
- `node scripts/inject-mobile-blur-css.mjs` passed.
- `node scripts/ci/orch-1093-signedin-route-oom.mjs` passed.
- `/hub/trips` on Android Chrome rendered the ORCH-1093 protected recovery and loaded zero Expo resources.
- `/event/create` on Android Chrome with Seth's real production business session seeded into the local origin reached the actual event creator edit wizard.

## What Failed

Physical device: Samsung Galaxy A72 `R58R54YV7JT`, Chrome `148.0.7778.215`.

Procedure:

1. Served the ORCH-1093 exported + injected build locally on `http://127.0.0.1:56815`.
2. Confirmed Seth's production business session existed on `https://business.usemingla.com/home`.
3. Copied the `sb-gqnoajqerqhnvulmnyvv-auth-token` value into local origin storage for `http://127.0.0.1:56815`.
4. Opened the ORCH-1093 approved routes on Android Chrome:
   - `/hub/events`
   - `/marketing`
   - `/marketing/campaigns/compose`
   - `/account`
   - `/event/create`
   - `/hub/trips`

Observed:

- `/hub/events` timed out under DevTools page evaluation and logcat later showed `V8 javascript OOM`.
- `/marketing` timed out under DevTools page evaluation and logcat later showed `V8 javascript OOM`.
- `/marketing/campaigns/compose` timed out under DevTools page evaluation and logcat later showed `V8 javascript OOM`.
- `/account` timed out under DevTools page evaluation and logcat later showed `V8 javascript OOM`.
- `/event/create` loaded the real wizard and did not produce the same failure in this pass.
- `/hub/trips` rendered protected recovery with no Expo scripts/resources because the injector blocked it before boot.

Logcat evidence excerpt:

```text
E chromium: V8 javascript OOM (Ineffective mark-compacts near heap limit).
F DEBUG   : pid: 29382, tid: 29394, name: CrRendererMain  >>> com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:67 <<<
E chromium: V8 javascript OOM (Ineffective mark-compacts near heap limit).
F DEBUG   : pid: 29435, tid: 29447, name: CrRendererMain  >>> com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:68 <<<
E chromium: V8 javascript OOM (Ineffective mark-compacts near heap limit).
F DEBUG   : pid: 29490, tid: 29502, name: CrRendererMain  >>> com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:69 <<<
E chromium: V8 javascript OOM (Ineffective mark-compacts near heap limit).
F DEBUG   : pid: 29538, tid: 29551, name: CrRendererMain  >>> com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:70 <<<
W cr_ChildProcessConn: onServiceDisconnected (crash or killed by oom): pid=29538 bindings:W  S
```

## Root Cause Of The Failed Implementation

The implementation moved the Expo boot scripts behind a deferred loader, but approved phone routes still load the same heavy boot payload. The new CI budget interprets "no static scripts" as `eager=0`, which hides the real physical behavior: the deferred scripts still execute on approved routes, and Android Chrome still runs out of V8 heap.

The fix cannot pass by only deferring the same payload or by marking risky routes "approved" while they still load that payload. Either the approved signed-in route path must genuinely reduce the executable boot payload below the phone-safe threshold, or the route must stay fail-closed until deeper code-splitting/static route ownership is implemented.

## Required Rework

1. Fix `scripts/ci/orch-1093-signedin-route-oom.mjs` so deferred boot scripts count against the approved-route phone budget. The guard must fail when approved routes still load the current deferred `__common` + `index` payload.
2. Do not report `eager=0` as success for approved routes unless no Expo boot payload is loaded for that route.
3. Reclassify approved mobile-phone routes that still load the oversized deferred boot payload as `pending-proof` or reduce their boot payload enough to pass physical Android Chrome.
4. Preserve `/event/create` if it is the only route with proven signed-in Android survival, but do not generalize that pass to Events/Marketing/Account.
5. Keep `/hub/trips` protected until real first-screen proof exists.
6. Produce new implementation evidence that includes a signed-in Android Chrome route pass using the real session seed method above.
7. Do not route to tester until Android Chrome has no `V8 javascript OOM`, no `CrRendererMain` crash, and no DevTools timeout for every route labeled approved.

## Rework Acceptance Bar

- Automated guard fails against the current false-pass shape.
- Android Chrome seeded-session test passes for every `approved` route.
- Any route that cannot pass Android Chrome remains fail-closed and is not claimed restored.
- Implementation report is amended with honest before/after deferred payload numbers and physical route results.
