# DEPLOY ORCH-0978 IMPLEMENT-4

Result: **SUCCESS**

Date: 2026-05-27
Operator: Claude `mingla-orchestrator` (per `feedback_orchestrator_deploys_edge_functions.md`)
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/`
Branch HEAD: `fbec6bada`
Source commits: `96695e027` (product) + `fbec6bada` (tests + allowlist)

## Edge function version bumps

| Function | Before | After | verify_jwt | Notes |
|---|---|---|---|---|
| event-cover-video-webhook | v121 | **v122** | false (preserved) | Carries `eagerDurationOrFallback` + three-code error split + `duration_fallback_to_job_trim` diagnostic |
| event-cover-video-upload-intent | v95 | **v96** | true | Eager chain now includes `du_<seconds>` defense-in-depth |
| event-cover-video-source-uploaded | v82 | **v83** | true | Rebuilt against shared lib (three-code split affects type surface) |
| event-cover-video-status | v94 | **v95** | true | Rebuilt against shared lib |
| event-cover-video-apply | v92 | **v93** | true | Rebuilt against shared lib |
| event-cover-video-cancel | v92 | **v93** | true | Rebuilt against shared lib |

All six bumped — confirms `_shared/eventCoverVideo.ts` change propagated to every function bundle.

Deploy command per function:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]"
/Users/sethogieva/bin/supabase functions deploy <slug> --project-ref gqnoajqerqhnvulmnyvv
```

## Verify-first-call probe (per `feedback_supabase_edge_deploy_verify_first_call.md`)

```bash
curl -sS -o /tmp/v122_probe.json -w "HTTP %{http_code} | time %{time_total}s\n" \
  -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Result:
```text
HTTP 403 | time 0.244336s
{"error":"forbidden","detail":"missing_signature","message":"Cloudinary signature is missing."}
```

Interpretation:
- **Non-404 confirms bundle is live** (verify-first-call gate satisfied).
- **403 missing_signature confirms `verify_jwt = false` preserved**: if Supabase gateway had enforced JWT verification, the call would have returned 401 before reaching function code. Instead, the function ran, hit `verifyCloudinaryNotificationSignature`, and returned the expected 403 error shape.
- **Signature verification path is alive**: new `eagerDurationOrFallback` branch sits downstream of signature verification — cannot be probed without the `CLOUDINARY_API_SECRET`. Live happy-path exercise belongs to tester RETEST T-AMEND6-06.

## Hard-guard recap

| Guard | Result |
|---|---|
| Six event-cover-video functions deployed | PASS — every one bumped |
| Webhook `verify_jwt = false` preserved | PASS (probe returned 403, not 401) |
| No `supabase db push` | PASS (no migrations changed) |
| No PR opened | PASS |
| No client touches | PASS (IMPLEMENT-4 commits diff already verified backend-only in REVIEW) |
| Local Supabase CLI (not MCP deploy) | PASS (used `/Users/sethogieva/bin/supabase functions deploy`) |

## Next step

Route to Codex `tester-mingla` for live-fire RETEST T-AMEND6-06 per SPEC AMENDMENT 6 §G. Tester dispatch will reference this deploy report + `REVIEW_ORCH-0978_IMPLEMENT_4.md`. After tester PASS on sim, pause for Seth's physical iPhone T-1/T-2/T-3, then CLOSE with `[deploy]` tag.
