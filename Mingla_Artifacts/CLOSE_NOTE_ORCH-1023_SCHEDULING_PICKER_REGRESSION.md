# CLOSE_NOTE_ORCH-1023_SCHEDULING_PICKER_REGRESSION

## Verdict

CLOSED PASS, Grade A.

## User Impact

Saved-card scheduling is usable again after the decisive availability fix. Today opens the time picker, This Weekend plus a chosen day opens the time picker, and Pick a Date opens the date picker for both single cards and curated cards.

## Evidence

- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1023_SCHEDULING_PICKER_REGRESSION.md`
- QA: `Mingla_Artifacts/reports/QA_ORCH-1023_SCHEDULING_PICKER_REGRESSION.md`
- Seth runtime receipt: "works now, schedule is fixed."

## Gates

- [TEST-MOD-APPROVED ORCH-1023] `WaveBBatch4.test.mjs` intentionally replaces the old nested-RNModal picker assertions with the corrected inline-picker contract. The deleted assertions encoded the broken picker presentation shape that caused this regression.
- PASS: `node app-mobile/src/components/ui/__tests__/WaveBBatch4.test.mjs`
- PASS: `/Users/sethogieva/.deno/bin/deno test --allow-read --sloppy-imports app-mobile/src/utils/__tests__/schedulingSourceContract.test.ts app-mobile/src/utils/__tests__/singleCardAvailability.test.ts app-mobile/src/utils/__tests__/curatedStopsAvailability.test.ts`
- PASS: `npx expo lint src/components/activity/ProposeDateTimeModal.tsx`
- PASS: `git diff --check`
- PASS: zero `[ORCH-1023-DIAG]` markers
- Residual: broad `npx tsc --noEmit --pretty false` still fails on unrelated existing repo-wide debt, with no scoped reference to `ProposeDateTimeModal` in the captured first 50 errors.

## Deploy Notes

No migration, no edge function, and no Vercel `[deploy]` tag.

This is a JS-only `app-mobile` fix. If current production policy allows OTA for this branch, publish after merge with:

```bash
cd app-mobile && eas update --branch production --platform ios --message "ORCH-1023: scheduling picker regression"
cd app-mobile && eas update --branch production --platform android --message "ORCH-1023: scheduling picker regression"
```

Verify with `eas update:list` after publishing.

## Close Commit Message

```text
Close ORCH-1023: scheduling picker regression

Closes ORCH-1023 after PASS QA and Seth runtime smoke.
Updates the seven Mingla close artifacts plus close note.
No migration, edge deploy, or Vercel deploy tag.
```
