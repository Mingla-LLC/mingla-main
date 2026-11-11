// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4381 — "Been here" did nothing on an expanded card. The control opens
// the review prompt through placeReviewRequestStore, and the one
// PostExperienceModal (an RN Modal in app/index.tsx) presents it. iOS will not
// present that modal while the expanded card's own RN Modal holds the
// presentation slot (ORCH-1022).
//
// The first fix lowered the sheet and raised the prompt in the SAME commit;
// on device iOS refused the present ("already presenting"), the request stayed
// open and every card tap was dead until restart. The handoff is now sequenced
// on native acknowledgements, like the share handoff:
//
//   1. the sheet holds the slot from its native show to its native dismiss;
//   2. the prompt is presentable only when a request is open and no host holds
//      the slot;
//   3. the sheet stays down until the prompt has natively dismissed, and the
//      prompt stays mounted until then (ORCH-1063);
//   4. a request that never shows within a bound is cancelled with a toast.
//
// FAILS-ON-REVERT: on fe43221285 every test below except the close guard fails.

const root = new URL("../../", import.meta.url);
const appRoot = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const readApp = (path: string) => Deno.readTextFile(new URL(path, appRoot));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function statement(source: string, start: RegExp): string {
  const match = start.exec(source);
  assert(match, `missing ${start}`);
  const end = source.indexOf(";", match.index);
  assert(end > match.index, `unterminated ${start}`);
  return source.slice(match.index, end + 1);
}

function callbackBody(source: string, name: string): { body: string; deps: string } {
  const head = new RegExp(`const ${name} = useCallback\\(\\(\\)(?:: void)? => \\{`).exec(source);
  assert(head, `missing ${name}`);
  const start = source.indexOf("{", head.index + head[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const deps = /^\s*,\s*\[([^\]]*)\]\s*\)/.exec(source.slice(i + 1));
        assert(deps, `${name} has no dependency list`);
        return { body: source.slice(start, i + 1), deps: deps[1] };
      }
    }
  }
  throw new Error(`unterminated ${name}`);
}

Deno.test("#4381 the expanded card steps aside while the review prompt is open or still on screen", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  assert(
    /const placeReviewOpen = usePlaceReviewSuspendsHost\(\);/.test(sheet),
    "the sheet is suspended by the store's request-open-or-prompt-on-screen selector",
  );
  const any = statement(sheet, /const anyChildModalOpen =/);
  assert(/\bplaceReviewOpen\b/.test(any), "placeReviewOpen suspends the sheet like any other child surface");
  assert(/\bisReserveSheetOpen\b/.test(any) && /\brootSuspendedForShare\b/.test(any), "anyChildModalOpen keeps the existing surfaces and the share handoff");
  assert(
    /visible=\{visible && !anyChildModalOpen\}\s*onClose=\{handleRootSheetClose\}\s*onNativeShow=\{handleRootNativeShow\}\s*onNativeDismiss=\{handleRootNativeDismiss\}/.test(sheet),
    "the root sheet is gated on anyChildModalOpen and reports its native show/dismiss",
  );
});

Deno.test("#4381 the sheet holds the presentation slot from native show to native dismiss", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  const show = callbackBody(sheet, "handleRootNativeShow").body;
  const dismiss = callbackBody(sheet, "handleRootNativeDismiss").body;
  assert(/holdPlaceReviewSlot\(\)/.test(show), "native show takes the slot");
  assert(/if \(!holdsPresentationSlot\.current\)/.test(show), "at most one hold per sheet");
  assert(/rootShownAcknowledgement\.current\?\.resolve\(\)/.test(show), "the share handoff ack is kept");
  assert(/releasePlaceReviewSlot\(\)/.test(dismiss), "native dismiss gives the slot back");
  assert(/rootDismissedAcknowledgement\.current\?\.resolve\(\)/.test(dismiss), "the share handoff ack is kept");
  assert(
    /useEffect\(\(\) => \(\) => \{\s*if \(holdsPresentationSlot\.current\) \{\s*holdsPresentationSlot\.current = false;\s*releasePlaceReviewSlot\(\);/.test(sheet),
    "unmounting never strands a hold",
  );
});

Deno.test("#4381 closing the card (card cleared, sheet unmounted, no native dismiss) gives the slot back", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  const mounted = statement(sheet, /const rootSheetMounted =/);
  assert(/\bvisible\b/.test(mounted) && /\bcard !== null\b/.test(mounted), "keyed on the visible prop and the card");
  assert(/\bbusinessEvent === null\b/.test(mounted), "the business-event and experience-route branches count as not mounted");
  assert(!/anyChildModalOpen|placeReviewOpen|rootSuspendedForShare/.test(mounted), "a suspended sheet is still mounted: no early release");
  assert(
    /useEffect\(\(\) => \{\s*if \(rootSheetMounted \|\| !holdsPresentationSlot\.current\) return;\s*holdsPresentationSlot\.current = false;\s*releasePlaceReviewSlot\(\);\s*\}, \[rootSheetMounted\]\);/.test(sheet),
    "the ref-guarded single hold is released once when the root sheet can no longer present",
  );
  const effect = sheet.indexOf("}, [rootSheetMounted]);");
  assert(effect > 0 && effect < sheet.indexOf("if (!card) {"), "the effect runs above the early returns (rules of hooks)");
});

Deno.test("#4381 lowering the sheet for the review prompt is not a close", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  const { body, deps } = callbackBody(sheet, "handleRootSheetClose");
  const guard = /if \(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*\{\s*return;\s*\}/.exec(body);
  assert(guard, "handleRootSheetClose has an early-return guard");
  assert(/\bplaceReviewOpen\b/.test(guard[1]), "the guard swallows close while the review prompt holds the sheet down");
  assert(/\bisReserveSheetOpen\b/.test(guard[1]), "the guard still swallows close for the existing child surfaces");
  assert(/shareHandoffPhaseRef\.current !== 'idle'/.test(guard[1]), "the guard still covers the share handoff");
  assert(body.indexOf("return;") < body.indexOf("onClose()"), "onClose runs only after the guard");
  assert(/\bplaceReviewOpen\b/.test(deps), "the callback re-binds when the review request opens or closes");
});

Deno.test("#4381 the single prompt presents only when no host holds the slot, and reports its native show/dismiss", async () => {
  const index = strip(await readApp("app/index.tsx"));
  assert(/const voluntaryPlaceReview = usePlaceReviewDisplayRequest\(\);/.test(index), "the mount renders the display request");
  assert(/const voluntaryPromptPresentable = usePlaceReviewPromptPresentable\(\);/.test(index), "and reads presentability");
  assert(
    /visible=\{voluntaryPlaceReview \? voluntaryPromptPresentable : showReviewModal\}/.test(index),
    "the voluntary prompt is visible only while presentable; the scheduled path is unchanged",
  );
  assert(/onNativeShow=\{markPlaceReviewPromptShown\}/.test(index), "the prompt's native show is reported");
  assert(/onNativeDismiss=\{markPlaceReviewPromptDismissed\}/.test(index), "the prompt's native dismiss is reported");
  assert(
    /watchPlaceReviewPresentation\(\(\) => \{\s*toastManager\.error\(i18n\.t\('modals:post_experience\.open_failed_toast'\)\);/.test(index),
    "the safety net is armed and tells the user",
  );
  assert((index.match(/<PostExperienceModal\b/g) ?? []).length === 1, "still exactly one mount (ORCH-1063)");
});

Deno.test("#4381 the prompt's RN Modal reports native show/dismiss through the shared adapter", async () => {
  const modal = strip(await read("components/PostExperienceModal.tsx"));
  assert(/import \{ NativeModalLifecycleAdapter \} from "\.\/ui\/BaseBottomSheet";/.test(modal), "reuses BaseBottomSheet's adapter");
  assert(/<NativeModalLifecycleAdapter\s+visible=\{visible\}\s+onNativeShow=\{onNativeShow\}\s+onNativeDismiss=\{onNativeDismiss\}/.test(modal), "adapter wired to the props");
  assert(/onShow=\{nativeLifecycle\.onNativeShow\}\s+onDismiss=\{nativeLifecycle\.onNativeDismiss\}/.test(modal), "Modal onShow/onDismiss go through the adapter");
  const sheet = strip(await read("components/ui/BaseBottomSheet.tsx"));
  assert(/export function NativeModalLifecycleAdapter\(/.test(sheet), "the one adapter is exported from BaseBottomSheet");
  assert(!/function NativeModalLifecycleAdapter|Platform\.OS === 'android'/.test(modal), "no second copy of the lifecycle logic in the prompt");
});

Deno.test("#4381 the failure toast has copy in every locale", async () => {
  for await (const entry of Deno.readDir(new URL("i18n/locales/", root))) {
    if (!entry.isDirectory) continue;
    const json = JSON.parse(await read(`i18n/locales/${entry.name}/modals.json`));
    const copy = json.post_experience?.open_failed_toast;
    assert(typeof copy === "string" && copy.length > 0, `${entry.name} has post_experience.open_failed_toast`);
  }
  const en = JSON.parse(await read("i18n/locales/en/modals.json"));
  assert(en.post_experience.open_failed_toast === "Couldn't open the rating. Try again.", "en copy");
});
