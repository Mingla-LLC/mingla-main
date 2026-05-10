# Runtime QA ORCH-0773B Draft Autosave Stale Local Draft Lifecycle

Date: 2026-05-09
Tester: Codex `$tester`
Verdict: **BLOCKED - AUTHENTICATED STALE/FRESH DRAFT RUNTIME FIXTURE NOT AVAILABLE**

## Summary

The requested operator-assisted runtime retest could not be executed because the visible Mingla Business simulator container is still unauthenticated and contains no local drafts. This means there is no stale local draft to route through edit/preview and no authenticated session for creating a fresh server-backed draft.

This report does not change the prior static/code verdict: ORCH-0773B remains **static/code conditional pass** from `reports/RETEST_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`. It only records that the missing runtime proof is still blocked.

## Prompt Followed

- `prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

## Runtime Environment Probe

Booted simulator:

```text
== Devices ==
-- iOS 26.4 --
    iPhone 17 Pro (17091E60-C3B6-4167-980D-60C348E177F6) (Booted)
```

Mingla Business data container:

```text
/Users/sethogieva/Library/Developer/CoreSimulator/Devices/17091E60-C3B6-4167-980D-60C348E177F6/data/Containers/Data/Application/C509364A-577E-42EE-8306-10422F6BD63B
```

Read-only AsyncStorage evidence from:

```text
Library/Application Support/com.sethogieva.minglabusiness/RCTAsyncLocalStorage_V1/manifest.json
```

Relevant persisted values:

```json
"sb-gqnoajqerqhnvulmnyvv-auth-token": null
```

```json
"mingla-business.draftEvent.v1": "{\"state\":{\"drafts\":[]},\"version\":9}"
```

## Fixture Evidence

Searched the app container for:

- `98e880f3-43ef-47ab-a530-deaa117b21a7`
- `PGRST116`
- `Cannot coerce`
- `useServerDraftAutosave`
- `Draft retired`

The stale id was found only in cached public/server data:

```text
Library/Caches/com.sethogieva.minglabusiness/fsCachedData/A15D0D24-F4F0-4D00-8583-5782B44D4E3B
```

That cached row is remote-shaped and already scheduled:

```json
{
  "id": "98e880f3-43ef-47ab-a530-deaa117b21a7",
  "status": "scheduled",
  "visibility": "public",
  "currency": "USD"
}
```

No stale local `DraftEvent` for that id exists in `mingla-business.draftEvent.v1`.

## Runtime Tests Not Executed

Blocked because no authenticated stale/fresh draft fixture exists:

- Stale edit route:
  - `/event/98e880f3-43ef-47ab-a530-deaa117b21a7/edit`
- Stale preview route:
  - `/event/98e880f3-43ef-47ab-a530-deaa117b21a7/preview`
- Fresh server-backed draft autosave regression.

Running those routes from this container would test signed-out/missing-local-state behavior, not ORCH-0773B's intended stale local draft lifecycle.

## Findings

No new code blocker found.

### BLOCKED - Required runtime fixture absent

The app is signed out and has no local drafts:

- Auth token is null.
- Draft store is empty.
- Original stale id is present only in cache as scheduled/public data.

The prompt's PASS criteria require an authenticated session and either the original stale local draft fixture or a controlled stale local draft fixture. Neither is present.

## Required Next Step

Return to `$orchestrator`.

To complete this runtime gate, the operator must:

1. Sign into Mingla Business on the visible simulator/phone; and
2. Provide either:
   - the original stale local draft fixture in `mingla-business.draftEvent.v1`; or
   - a controlled stale local draft fixture whose local draft id maps to a server row that is missing, deleted, or no longer `status = draft`.

Then rerun:

`prompts/TESTER_OPERATOR_ASSISTED_RUNTIME_ORCH-0773B_DRAFT_AUTOSAVE_STALE_LOCAL_DRAFT_LIFECYCLE.md`

---

## Rerun After Operator Sign-In Attempt

Date: 2026-05-09
Verdict remains: **BLOCKED - STALE LOCAL DRAFT FIXTURE STILL NOT AVAILABLE**

The operator reported signing into the simulator. The simulator and Mingla Business data container were checked again.

### Updated AsyncStorage Evidence

The visible Mingla Business container still reports:

```json
"sb-gqnoajqerqhnvulmnyvv-auth-token": null
```

The draft store now contains one server-backed local draft:

```json
{
  "id": "09b4ece6-eabc-4734-8ce3-3a25d90417e4",
  "brandId": "22a18413-bfbf-4087-9ba7-45f70deba0f3",
  "serverSlug": "draft-ijqw",
  "name": "Vibes and Stuff",
  "status": "draft",
  "clientRevision": 42
}
```

This proves local draft state exists now, but it does **not** prove the required stale condition. A valid ORCH-0773B stale fixture requires a local non-`d_` draft whose server row is missing, deleted, or no longer `status = draft`.

### Server Visibility Probe

Read-only anonymous REST probe:

```text
GET /rest/v1/events?id=eq.09b4ece6-eabc-4734-8ce3-3a25d90417e4&select=id,status,visibility,deleted_at,updated_at
```

returned:

```json
[]
```

This is consistent with the row being non-public / draft-protected by RLS, but it does not prove stale lifecycle.

The original stale id remains readable anonymously as scheduled/public:

```text
GET /rest/v1/events?id=eq.98e880f3-43ef-47ab-a530-deaa117b21a7&select=id,status,visibility,deleted_at,updated_at
```

returned:

```json
[
  {
    "id": "98e880f3-43ef-47ab-a530-deaa117b21a7",
    "status": "scheduled",
    "visibility": "public",
    "deleted_at": null,
    "updated_at": "2026-05-09T17:08:32.381124+00:00"
  }
]
```

But that original stale id is **not** present in the local draft store, so it still cannot exercise stale local draft recovery.

### Rerun Conclusion

Runtime ORCH-0773B remains blocked:

- There is a local draft now, but it is not proven stale.
- The original stale id is server scheduled/public, but not local.
- The persisted auth token is still null in the visible AsyncStorage container.
- Testing the original stale route now would test missing-local-draft routing, not stale-local-draft retirement.

### What Is Still Needed

To complete this gate, provide one of:

1. Original fixture restored locally:
   - `mingla-business.draftEvent.v1` contains id `98e880f3-43ef-47ab-a530-deaa117b21a7`; or
2. Controlled stale fixture:
   - local draft id exists in `mingla-business.draftEvent.v1`;
   - the corresponding server row is known/proven missing, deleted, or not `status = draft`.

Then rerun the same tester prompt.
