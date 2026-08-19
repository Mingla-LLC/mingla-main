// @ts-nocheck — Deno-runtime suite (Deno globals + deno.land import); the app-mobile
// tsc sweep has no Deno types (house convention — see issue_2242_*.test.ts).
//
// #2321 [explorer account deletion never deleted] — implementor happy-path suite,
// client half. SPEC §7 T-2, T-3, T-8 and SC-6, SC-7, SC-8.
//
// THIS IS NOT A SOURCE GREP. app-mobile has no jest and no react-test-renderer, so
// the executable half of this suite lifts the REAL production expressions out of
// AccountSettings.tsx and RUNS them with `new Function` across every reachable
// response shape — the pattern the #2242 invariant records. What the render would
// show is then derived from the branch the executed expression selects, and the
// keys that branch actually contains.
//
// The defect being pinned: for the entire life of dual-sided deletion the consumer
// app called `setDeleteStep("success")` unconditionally and rendered "Account
// Deleted" over a login that was still alive and a profile that was still intact.
// The server had reported `authRetained` since #668; this client threw it away.
//
// FAILS-ON-REVERT (proven by true line deletion in the implementation report):
//   - `setDeleteStep(data?.authRetained === true ? "retained" : "success")`
//      reverted to `setDeleteStep("success")`  → T-2 fails (no branch to extract).
//   - the `deleteStep === "retained"` render branch deleted → T-2 fails.
//   - `retained_title` removed from any locale → T-8 fails, naming that locale.
//
// Run: deno test --allow-read app-mobile/src/components/profile/__tests__/issue_2321_retained_branch_cannot_claim_deleted.implementor.happy.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

/** Comments stripped so a commented-out fix can never satisfy an assertion. */
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const rawSettings = await read("../AccountSettings.tsx");
const settings = strip(rawSettings);

const LOCALES = [
  "ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig",
  "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk",
  "vi", "yo", "zh",
];

const SUCCESS_KEYS = ["success_title", "success_body", "success_sub"] as const;
const RETAINED_KEYS = ["retained_title", "retained_body", "retained_sub"] as const;

/** Slice the JSX guarded by `deleteStep === "<step>" && (` up to its balanced `)}`. */
function sliceStepBranch(source: string, step: string): string | null {
  const marker = `deleteStep === "${step}" && (`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start + marker.length - 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Lift the REAL step-selection expression out of the handler and make it callable.
 * If the conditional is reverted to `setDeleteStep("success")` this returns null and
 * every behavioural test below fails — which is the point.
 */
function extractStepSelector(): ((data: unknown) => string) | null {
  const m = /setDeleteStep\(\s*(data\?\.authRetained[^;]*?)\s*\);/.exec(settings);
  if (m === null) return null;
  return new Function("data", `return (${m[1]});`) as (data: unknown) => string;
}

const selectStep = extractStepSelector();

/** What the delete dialog would render for a given server payload. */
function renderedKeysFor(data: unknown): string[] {
  assert(selectStep !== null, "the handler must select its terminal step from the response");
  const step = selectStep(data);
  const branch = sliceStepBranch(settings, step);
  assert(branch !== null, `no render branch exists for deleteStep === "${step}"`);
  return [...branch.matchAll(/settings:delete\.(\w+)/g)].map((x) => x[1]);
}

// ── T-2 / SC-6 — authRetained:true can NEVER reach the "Account Deleted" copy ──

Deno.test("#2321 T-2 · an authRetained:true response renders the retained copy and NONE of the success copy", () => {
  const payloads = [
    { success: true, authRetained: true, retainedReason: "business_side_active" },
    { success: true, authRetained: true, retainedReason: "explorer_side_active" },
    { success: true, authRetained: true },
    { success: true, authDeleted: false, authRetained: true, message: "anything at all" },
  ];

  for (const data of payloads) {
    assertEquals(
      selectStep!(data),
      "retained",
      `authRetained:true must select the retained step (${JSON.stringify(data)})`,
    );
    const keys = renderedKeysFor(data);
    for (const forbidden of SUCCESS_KEYS) {
      assert(
        !keys.includes(forbidden),
        `a retained deletion rendered settings:delete.${forbidden} — that is the #2321 lie`,
      );
    }
    for (const required of RETAINED_KEYS) {
      assert(keys.includes(required), `the retained branch must render settings:delete.${required}`);
    }
  }
});

// ── T-3 / SC-7 — the real-deletion path is unchanged ─────────────────────────

Deno.test("#2321 T-3 · an authRetained:false response still renders the original success copy", () => {
  const payloads: unknown[] = [
    { success: true, authDeleted: true, authRetained: false },
    { success: true, authDeleted: true },
    { success: true },
    null,
    undefined,
  ];

  for (const data of payloads) {
    assertEquals(
      selectStep!(data),
      "success",
      `a non-retained response must select the success step (${JSON.stringify(data)})`,
    );
    const keys = renderedKeysFor(data);
    for (const required of SUCCESS_KEYS) {
      assert(keys.includes(required), `the success branch must still render settings:delete.${required}`);
    }
    for (const forbidden of RETAINED_KEYS) {
      assert(
        !keys.includes(forbidden),
        `the success branch must not borrow settings:delete.${forbidden}`,
      );
    }
  }
});

Deno.test("#2321 · the two terminal branches are genuinely distinct components", () => {
  const retained = sliceStepBranch(settings, "retained");
  const success = sliceStepBranch(settings, "success");
  assert(retained !== null, "the retained branch must exist");
  assert(success !== null, "the success branch must exist");
  assert(retained !== success, "the two outcomes must not be the same JSX");
  // The retained outcome is deliberately not a green checkmark.
  assertStringIncludes(retained!, "information-circle");
  assert(
    !retained!.includes("deleteIconSuccess"),
    "a retained login must not wear the success affordance",
  );
  assertStringIncludes(success!, "checkmark-circle");
});

Deno.test("#2321 · the step union carries a distinct \"retained\" state", () => {
  assertStringIncludes(
    settings,
    '"confirm" | "deleting" | "success" | "retained" | "error"',
  );
});

// ── T-8 / SC-8 — every shipped locale carries honest, distinct copy ──────────

Deno.test("#2321 T-8 · all 29 locales define retained_title/body/sub, non-empty and != success", async () => {
  const seenTitles = new Set<string>();
  const englishBody =
    "Your Explorer profile is gone. Your Business login still works.";

  for (const locale of LOCALES) {
    const json = JSON.parse(await read(`../../../i18n/locales/${locale}/settings.json`));
    const del = json.delete;
    assert(del !== undefined, `${locale}: settings.json has no "delete" object`);

    for (const key of RETAINED_KEYS) {
      const value = del[key];
      assert(
        typeof value === "string" && value.trim() !== "",
        `${locale}: delete.${key} is missing or empty`,
      );
    }
    assert(
      del.retained_title !== del.success_title,
      `${locale}: retained_title is identical to success_title — the retained outcome would read as a completed deletion`,
    );
    if (locale !== "en") {
      assert(
        del.retained_body !== englishBody,
        `${locale}: retained_body is still the untranslated English string`,
      );
    }
    // The product names stay in Latin script in every locale.
    assertStringIncludes(del.retained_title, "Explorer");
    assertStringIncludes(del.retained_sub, "Mingla for Business");
    seenTitles.add(del.retained_title);
  }

  // Vacuity guard: 29 locales that all resolved to the same string would mean the
  // loop read one file 29 times.
  assert(seenTitles.size > 20, `expected distinct per-locale titles, saw ${seenTitles.size}`);
});

Deno.test("#2321 · the locale list this suite asserts over is the one on disk", async () => {
  const found: string[] = [];
  for await (const entry of Deno.readDir(new URL("../../../i18n/locales", import.meta.url))) {
    if (entry.isDirectory) found.push(entry.name);
  }
  assertEquals(found.sort(), [...LOCALES].sort());
});
