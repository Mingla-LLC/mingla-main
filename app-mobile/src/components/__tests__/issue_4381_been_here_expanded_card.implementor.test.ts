// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4381 — "Been here" did nothing on an expanded card. The control opens
// the review prompt through placeReviewRequestStore, and the one
// PostExperienceModal (an RN Modal in app/index.tsx) presents it. iOS will not
// present that modal over the expanded card's own RN Modal (ORCH-1022), so the
// sheet must step aside while a review request is open, and must not treat
// stepping aside as the user closing the card.
//
// FAILS-ON-REVERT: drop the usePlaceReviewRequest() subscription, drop it from
// the child-surface condition, or let handleRootSheetClose call onClose while
// a review request is open — each fails here.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
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

function callbackBody(source: string, name: string): string {
  const head = new RegExp(`const ${name} = useCallback\\(\\(\\) => \\{`).exec(source);
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

Deno.test("#4381 the expanded card subscribes to the open review request", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  assert(
    /import \{[^}]*\busePlaceReviewRequest\b[^}]*\} from "\.\.\/store\/placeReviewRequestStore";/.test(sheet),
    "imports the existing usePlaceReviewRequest selector",
  );
  assert(
    /const placeReviewOpen = usePlaceReviewRequest\(\) !== null;/.test(sheet),
    "derives placeReviewOpen from the open request",
  );
});

Deno.test("#4381 an open review request lowers the sheet (feeds anyChildModalOpen)", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  const child = statement(sheet, /const childSurfaceOpen =/);
  assert(/\bplaceReviewOpen\b/.test(child), "placeReviewOpen is a child surface");
  const any = statement(sheet, /const anyChildModalOpen =/);
  assert(/\bchildSurfaceOpen\b/.test(any), "anyChildModalOpen includes every child surface");
  assert(/\brootSuspendedForShare\b/.test(any), "anyChildModalOpen still includes the share handoff");
  assert(
    /visible=\{visible && !anyChildModalOpen\}\s*onClose=\{handleRootSheetClose\}/.test(sheet),
    "the root sheet is gated on anyChildModalOpen and closes through handleRootSheetClose",
  );
});

Deno.test("#4381 lowering the sheet for the review prompt is not a close", async () => {
  const sheet = strip(await read("components/ExpandedCardModal.tsx"));
  const { body, deps } = callbackBody(sheet, "handleRootSheetClose");
  const guard = /if \(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*\{\s*return;\s*\}/.exec(body);
  assert(guard, "handleRootSheetClose has an early-return guard");
  assert(/\bchildSurfaceOpen\b/.test(guard[1]), "the guard swallows close while any child surface, including the review prompt, is open");
  assert(/shareHandoffPhaseRef\.current !== 'idle'/.test(guard[1]), "the guard still covers the share handoff");
  assert(body.indexOf("return;") < body.indexOf("onClose()"), "onClose runs only after the guard");
  assert(/\bchildSurfaceOpen\b/.test(deps), "the callback re-binds when the review request opens or closes");
});
