# Feature Guide upkeep

The Feature Guide is Mingla's evidence-backed answer for what the product can do now. Admins maintain it in **Mingla Admin → Community & Support → Feature Guide**. Support can read and search it; only Owner/Admin users can change entries or apply evidence.

An entry is **Live** only when its claim is `live`, its review date is current, and every required evidence kind has current verified proof. Missing, expired, or conflicting proof displays **Needs review**. Do not work around that result or infer an answer from an empty search.

## Add or change an entry

1. Search the Feature Guide for the capability and adjacent wording. Reuse the stable `capability_key`; do not create a synonym entry.
2. In the same pull request as the capability change, add a forward-only migration that inserts or updates:
   - the customer outcome, eligible people and surfaces;
   - the exact path a user follows;
   - limitations and approved Support wording;
   - the claim (`planned`, `live`, or `retired`), required evidence kinds, and review date.
3. A code change must invalidate evidence that no longer proves the capability. Mark the replaced evidence non-current or clear the review date so the entry fails closed to **Needs review** until post-merge proof is applied.
4. Add an append-only content test. It must reject duplicate keys, empty or vague instructions, unsupported status language, unpinned source URLs, and sensitive implementation detail.
5. Cite each source as a full GitHub blob URL pinned to a 40-character commit and the exact file path. Static source and test citations explain the implementation; they do not replace a production live check.

Never edit an applied migration. If an entry is wrong, add a new migration and record the correction on the tracked issue.

## Run a live check

Live checks are read-only. Do not buy, refund, publish, send, invite, or change a production setting to manufacture proof.

1. Start from the entry's required evidence kinds and stated surfaces.
2. Confirm the deployed commit, migration receipt, app/store/OTA version, or production flag that governs the capability.
3. Follow the documented user path only as far as a read-only check allows. Record each surface separately when web, iOS, and Android can differ.
4. Capture the observed UTC time, actor role, surface and version, expected result, actual result, and any limitation. Redact customer data.
5. Post the evidence on the tracked GitHub issue. If a check fails or conflicts with the entry, use verdict `conflict`; do not soften the wording or mark the entry Live.

## Write and apply an evidence packet

The packet is JSON. Every URL must be a pinned Mingla source URL, pull request, or issue-comment anchor. A typical entry is:

```json
{
  "entries": [
    {
      "capability_key": "host-payouts",
      "evidence": [
        {
          "kind": "source",
          "url": "https://github.com/Mingla-LLC/mingla-main/blob/0123456789abcdef0123456789abcdef01234567/path/to/source.ts",
          "verdict": "verified",
          "details": "The pinned implementation enforces the documented Host path.",
          "observed_at": "2026-10-19T16:00:00Z"
        },
        {
          "kind": "live_check",
          "url": "https://github.com/Mingla-LLC/mingla-main/issues/3720#issuecomment-1234567890",
          "verdict": "verified",
          "details": "Read-only production check passed on the named surfaces and versions.",
          "observed_at": "2026-10-19T16:15:00Z",
          "expires_at": "2027-01-17T16:15:00Z"
        }
      ]
    }
  ]
}
```

To apply it:

1. Open **Feature Guide → Apply evidence packet** as an Owner/Admin.
2. Paste the packet and choose **Review packet**.
3. Open every cited link and compare the preview's before/after status with the issue evidence.
4. Choose **Apply packet**. The audited write path records each item and recalculates truth after every write.
5. Refresh the entry and confirm its effective status, evidence list, last verified time, and next review date. Post the result on the tracked issue.

An expiring check needs a deliberate `expires_at`. Use the shortest honest window for flags, deployments, and other changeable runtime facts.

## Weekly drift note

The existing Product Inbox ↔ Mingla Avengers sync worker posts one idempotent note to issue #3720 per ISO week. It lists:

- reviews due in the next 14 days;
- entries whose effective status is now **Needs review**;
- entries whose pinned source blob differs from the same path on `main`.

Review the note in Admin, run the required checks, and apply a current evidence packet. A missing note is an operations failure: inspect the `product-avengers-sync` run and `feature_guide_drift_runs` state, repair the existing path, and let its retry reclaim the week. Do not add a second scheduler or a separate GitHub-writing credential.

## Migration and release record

Use the repository's safe-migration sequence: compare remote migration history, run read-only prechecks, apply each pending migration once in order, capture the migration receipt, and run read-only postchecks. The shipping issue's release record must name the pull request, merge commit, migrations, deployments, live checks, and any native OTA result or `pending` value.
