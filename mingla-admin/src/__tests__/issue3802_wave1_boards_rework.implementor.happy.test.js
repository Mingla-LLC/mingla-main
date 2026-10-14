// Issue #3802 (Wave 1, boards rework) — regression tests for the seven
// findings in the tester's verdict on the Hosts and Creators boards.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job").
// Changed here, and only this: R-8 "the breadcrumb root is the role's own
// home" pinned the old header markup (a clickable root crumb). The approved
// breadcrumb is "Group › Page" in plain words. See the note on that test.
//
//   R-1  F-1  every unsent field is remembered; never "Saved" while one is;
//             Try again sends all of them
//   R-2  F-2  a card with unsent edits is not let go quietly
//   R-3  F-3  a token is never shown: every token maps to plain words
//   R-4  F-4  a failed Lost/Passed move keeps the question and the reason
//   R-5  F-5  toasts are solid, clear of the card's footer, never block a tap
//   R-6  F-6  keyboard: delete confirm focus, toast actions inside the trap
//   R-7  F-7  the board refreshes by itself; a stale card is never moved
//   R-8       the smaller items taken in the same pass
//
// Fails-on-revert is recorded on the issue for R-1, R-2, R-3, R-4, R-5, R-6
// and R-7.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// [TEST-MOD-APPROVED ISSUE-3802] the breadcrumb is now a pure function (see R-8).
import { breadcrumbFor } from "../lib/shellNav.js";
import { NAV_GROUPS } from "../lib/constants.js";
import {
  BOARD_REFRESH_MS,
  TEXT_FIELDS,
  editsToSend,
  errorCopy,
  errorWords,
  fieldLabel,
  freshnessVerdict,
  hasUnsavedEdits,
  loadErrorWords,
  normalizeTyped,
  pendingTextEdits,
  saveLine,
  shouldHoldCard,
  unsentEdits,
} from "../lib/crmModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const PAGE = read("pages/PipelinePage.jsx");
const DRAWER = read("components/crm/RecordDrawer.jsx");
const UI_DRAWER = read("components/ui/Drawer.jsx");
const TOAST = read("components/ui/Toast.jsx");
const TOAST_CONTEXT = read("context/ToastContext.jsx");
const SERVICE = read("services/crmService.js");
const PROMPT = read("components/crm/ReasonPrompt.jsx");
const BOARD = read("components/crm/PipelineBoard.jsx");
const LIST = read("components/crm/PipelineList.jsx");
const HOOK = read("hooks/useCrmPipeline.js");
const HEADER = read("components/layout/Header.jsx");
const MIGRATION = fs.readFileSync(
  path.resolve(SRC, "../../supabase/migrations/20270820003802_issue_3802_wave1_crm_pipelines.sql"),
  "utf8"
);

const RECORD = { id: "r1", name: "Palm Court Kitchen", stage: "prospect", contact: "Old contact", next_action: null, rate: null };
const HOSTS = {
  id: "hosts",
  stages: [
    { id: "prospect", label: "Prospect" },
    { id: "contacted", label: "Contacted" },
    { id: "replied", label: "Replied" },
    { id: "meeting", label: "Meeting" },
    { id: "onboarded", label: "Onboarded" },
    { id: "live", label: "Live", auto: true },
    { id: "lost", label: "Lost", terminal: true },
  ],
};

describe("#3802 R-1 (F-1): every unsent field is remembered", () => {
  // The tester's steps: Contact fails, then Next action fails.
  const unsent = {
    contact: { value: "Ngozi, manager", message: "x" },
    next_action: { value: "Call on Friday", message: "x" },
  };
  const drafts = { contact: "Ngozi, manager", next_action: "Call on Friday" };

  it("both failed fields are listed, in the order the card shows them", () => {
    assert.deepEqual(unsentEdits(unsent).map((e) => e.key), ["contact", "next_action"]);
    assert.deepEqual(unsentEdits({ next_action: unsent.next_action, contact: unsent.contact }).map((e) => e.key), ["contact", "next_action"]);
  });

  it("Try again sends BOTH, with the values that were typed", () => {
    assert.deepEqual(editsToSend(drafts, RECORD, unsent), [
      { key: "contact", value: "Ngozi, manager", local: false },
      { key: "next_action", value: "Call on Friday", local: false },
    ]);
  });

  it("the header never says Saved while any field is unsent, even right after another field saved", () => {
    const line = saveLine({ saving: 0, drafts, record: RECORD, unsent, savedAt: "3:42 pm" });
    assert.deepEqual(line, { kind: "unsent", keys: ["contact", "next_action"] });
    const oneLeft = saveLine({ saving: 0, drafts: { contact: "Ngozi, manager" }, record: RECORD, unsent: { contact: unsent.contact }, savedAt: "3:42 pm" });
    assert.equal(oneLeft.kind, "unsent");
    assert.deepEqual(oneLeft.keys, ["contact"]);
  });

  it("Saved appears only when nothing is unsent, typed-but-not-sent, or in flight", () => {
    assert.equal(saveLine({ savedAt: "3:42 pm", record: RECORD }).kind, "saved");
    assert.equal(saveLine({ record: RECORD }).kind, "idle");
    assert.equal(saveLine({ saving: 1, unsent, record: RECORD, savedAt: "3:42 pm" }).kind, "saving");
    const typed = saveLine({ drafts: { rate: "200 per post" }, record: RECORD, savedAt: "3:42 pm" });
    assert.deepEqual(typed, { kind: "pending", keys: ["rate"] });
  });

  it("typed text that equals what is saved is not an edit; spacing is tidied first", () => {
    assert.deepEqual(pendingTextEdits({ contact: "  Old contact " }, RECORD, {}), []);
    assert.deepEqual(pendingTextEdits({ contact: "New" }, RECORD, {}), [{ key: "contact", value: "New" }]);
    assert.deepEqual(pendingTextEdits({ contact: "New" }, RECORD, { contact: { value: "New" } }), [], "a failed field is not counted twice");
    assert.equal(normalizeTyped("name", "  Palm   Court  "), "Palm Court");
    assert.equal(normalizeTyped("contact", "  a   b "), "a   b");
    assert.equal(normalizeTyped("rate", null), "");
  });

  it("a value the screen itself refused (not a number) is listed but not re-sent as it is", () => {
    const local = { followers: { value: "lots", message: "x", local: true } };
    assert.deepEqual(unsentEdits(local), [{ key: "followers", value: "lots", local: true }]);
    assert.equal(saveLine({ unsent: local, record: RECORD, savedAt: "1" }).kind, "unsent");
  });

  it("the fields have plain names for the 'Not saved' line", () => {
    assert.equal(fieldLabel("contact", "hosts"), "Contact");
    assert.equal(fieldLabel("contact", "creators"), "Handle and reach");
    assert.equal(fieldLabel("next_action"), "Next action");
    assert.equal(fieldLabel("brand_id"), "Brand link");
    assert.equal(fieldLabel("__proto__"), "A field");
    for (const key of TEXT_FIELDS) assert.notEqual(fieldLabel(key), "A field", key);
  });

  it("the card is wired to that model, not to a single remembered failure", () => {
    assert.ok(!/const \[failed, setFailed\]/.test(DRAWER), "the single-failure state is back");
    assert.match(DRAWER, /const line = saveLine\(\{ saving: savingCount, drafts, record, unsent, savedAt \}\);/);
    assert.match(DRAWER, /for \(const edit of editsToSend\(d, rec, u\)\)/);
    assert.match(DRAWER, /Not saved: \{names\}/);
    // Both Try again buttons send everything.
    assert.equal((DRAWER.match(/onClick=\{sendAll\}/g) || []).length, 2);
    assert.match(DRAWER, /line\.kind === "saved" \? \(\s*<span[^>]*>Saved/);
  });
});

describe("#3802 R-2 (F-2): a card with unsent edits is not let go quietly", () => {
  it("anything unsent, typed or in flight counts as unsaved", () => {
    assert.equal(hasUnsavedEdits({ record: RECORD }), false);
    assert.equal(hasUnsavedEdits({ record: RECORD, savedAt: "1" }), false);
    assert.equal(hasUnsavedEdits({ record: RECORD, drafts: { contact: "New" } }), true);
    assert.equal(hasUnsavedEdits({ record: RECORD, unsent: { icp: { value: "x" } } }), true);
    assert.equal(hasUnsavedEdits({ record: RECORD, saving: 1 }), true);
  });

  it("the page holds such a card on screen when the address lets go of it", () => {
    assert.equal(shouldHoldCard("a", "", "a"), true, "Close, Escape or Back");
    assert.equal(shouldHoldCard("a", "b", "a"), true, "another card was asked for");
    assert.equal(shouldHoldCard("a", "", ""), false, "nothing unsaved: it closes");
    assert.equal(shouldHoldCard("a", "", "b"), false);
    assert.equal(shouldHoldCard("a", "a", "a"), false, "still the card in the address");
    assert.equal(shouldHoldCard("", "", ""), false);
  });

  it("a held card is asked to send its edits, and stays if they cannot be sent", () => {
    assert.match(PAGE, /const holding = shouldHoldCard\(shownCard, urlCard, dirtyCard\);/);
    assert.match(PAGE, /const openId = holding \? shownCard : urlCard;/);
    assert.match(PAGE, /Promise\.resolve\(guard \? guard\.flush\(\) : true\)\.then\(\(ok\) => \{\s*if \(!live \|\| ok\) return;/);
    assert.match(PAGE, /setSearch\(buildCrmSearch\(\{ \.\.\.stateRef\.current, card: shownCard \}\), \{ replace: true \}\);/);
    assert.match(DRAWER, /flush: async \(\) => \{\s*const ok = await sendAll\(\);\s*if \(mounted\.current\) setCloseBlocked\(!ok\);\s*return ok;/);
    assert.match(DRAWER, /The card stayed open because/);
    assert.match(DRAWER, /Close without saving/);
  });

  it("a save that fails after the card left the screen keeps the text and says so", () => {
    assert.match(DRAWER, /if \(!mounted\.current\) \{[\s\S]{0,160}keepForLater\(\[\{ key, value \}\], before\.name\);/);
    assert.match(DRAWER, /if \(left\.length > 0\) keepForLater\(left, rec\.name\);/);
    // ...and only when the card really is gone (not on a development-mode re-run).
    assert.match(DRAWER, /setTimeout\(\(\) => \{\s*if \(mounted\.current\) return;/);
    assert.match(DRAWER, /title: `Changes to \$\{name\} weren't saved`/);
    assert.match(DRAWER, /label: "Open the card"/);
    assert.match(DRAWER, /useState\(\(\) => restoreLeftUnsent\(recordId\)\)/);
  });

  it("the kept text is the person's own typing, in memory only", () => {
    assert.ok(!/localStorage|sessionStorage|indexedDB/.test(DRAWER));
    assert.match(DRAWER, /const leftUnsent = new Map\(\);/);
  });
});

describe("#3802 R-3 (F-3): a token is never shown", () => {
  // Every refusal token the merged migration can raise, read from the SQL.
  const tokens = [...new Set([...MIGRATION.matchAll(/RAISE EXCEPTION '(?:%', format\(')?([a-z_]+)(?::|')/g)].map((m) => m[1]))].filter(
    (t) => !t.startsWith("issue")
  );

  it("the reader finds the migration's tokens", () => {
    assert.ok(tokens.length >= 30, `only ${tokens.length} tokens found`);
    for (const t of ["forbidden", "not_found", "try_again", "undo_not_live", "agreement_required", "reason_required"]) {
      assert.ok(tokens.includes(t), t);
    }
  });

  it("with no sentence from the server, every token still reads as a sentence", () => {
    for (const token of [...tokens, "network", "signed_out", "not_ready", "unknown", "a_token_from_next_year"]) {
      for (const message of ["", undefined, null, token, "  " + token + " ", "forbidden", "x"]) {
        const words = errorCopy(token, message);
        assert.ok(words.includes(" ") && words.length > 15, `${token} / ${String(message)} -> ${words}`);
        assert.notEqual(words.trim(), token);
        assert.ok(!/^[a-z_]+$/.test(words.trim()), `${token} shown as a bare word`);
        assert.ok(!/\b[a-z]+_[a-z_]+\b/.test(words), `${token} -> "${words}" carries a token`);
      }
    }
  });

  it("the tester's case: a refusal that arrives as just 'forbidden'", () => {
    assert.equal(errorCopy("forbidden", "forbidden"), "Your account can't use Hosts and Creators. Ask the owner to give you team access.");
    assert.equal(errorWords({ token: "forbidden", message: "forbidden" }), errorCopy("forbidden", ""));
    assert.equal(errorWords({ code: "42501", message: "forbidden" }), errorCopy("forbidden", ""));
    assert.equal(errorWords({ code: "42501", message: "permission denied for function crm_record_delete" }), errorCopy("forbidden", ""));
  });

  it("a real sentence from the server is still used where it is written for the person", () => {
    assert.equal(errorCopy("forbidden", "Only an owner or admin can delete. Mark it as lost instead."), "Only an owner or admin can delete. Mark it as lost instead.");
    assert.equal(errorCopy("reason_required", "Keep the reason to one line of 300 characters or fewer."), "Keep the reason to one line of 300 characters or fewer.");
  });

  it("the error object never puts the token where the words belong", () => {
    assert.ok(!/super\(message \|\| token\)/.test(SERVICE));
    assert.match(SERVICE, /super\(typeof message === "string" \? message : ""\);/);
  });

  it("something that failed to load does not say it failed to save", () => {
    for (const err of [{ token: "unknown", message: "" }, { message: "upstream down" }, new TypeError("Failed to fetch"), { token: "try_again", message: "x y" }]) {
      const words = loadErrorWords(err);
      assert.ok(/load/.test(words), words);
      assert.ok(!/save/.test(words), words);
    }
    assert.equal(loadErrorWords({ token: "not_ready", message: "" }), errorCopy("not_ready", ""));
    assert.match(PAGE, /\{loadErrorWords\(loadError\)\}/);
    assert.ok(!/\{errorWords\(loadError\)\}/.test(PAGE));
  });
});

describe("#3802 R-4 (F-4): a failed Lost or Passed move keeps the question open", () => {
  it("the page closes the question only when the move went through", () => {
    assert.match(PAGE, /if \(ok \|\| !failure\) setReasonFor\(null\);\s*else setReasonError\(failure\);/);
    assert.match(PAGE, /moveErrorSink\.current = \(words\) => \{\s*failure = words;\s*\};/);
    assert.match(PAGE, /if \(moveErrorSink\.current && err\?\.token !== "not_found"\) \{\s*moveErrorSink\.current\(errorWords\(err\)\);\s*return false;/);
    assert.match(PAGE, /error=\{reasonError\}/);
  });

  it("the question shows why it failed, keeps the text, and offers Try again", () => {
    assert.match(PROMPT, /error = ""/);
    assert.match(PROMPT, /The card didn&apos;t move\. \{error\} Your reason is still here\./);
    assert.match(PROMPT, /\{error \? "Try again" : copy\.confirm\}/);
    // The text box is only emptied by a fresh question (a new key), never by a failure.
    assert.equal((PROMPT.match(/setReason\(/g) || []).length, 1);
    assert.match(PAGE, /key=\{reasonFor \? `\$\{reasonFor\.record\.id\}:\$\{reasonFor\.to\}` : "closed"\}/);
  });
});

describe("#3802 R-5 (F-5): toasts are solid, clear of the card footer, and never block a tap", () => {
  it("every toast sits on the theme's solid surface, in both themes", () => {
    assert.match(TOAST, /className="pointer-events-auto [^"]*bg-\[var\(--color-background-primary\)\]/);
    // The tint is a separate layer inside it.
    assert.match(TOAST, /<div className=\{\["p-3 px-4 border-l-4", config\.bg, config\.border\]\.join\(" "\)\}>/);
  });

  it("the stack takes no clicks itself and is lifted by the open drawer's footer", () => {
    assert.match(TOAST, /data-toast-region=""/);
    assert.match(TOAST, /className="pointer-events-none fixed inset-x-4 /);
    assert.match(TOAST, /bottom: "calc\(1\.5rem \+ var\(--toast-lift, 0px\)\)"/);
    assert.match(UI_DRAWER, /root\.style\.setProperty\("--toast-lift", `\$\{h\}px`\);/);
    assert.match(UI_DRAWER, /root\.style\.removeProperty\("--toast-lift"\);/);
    assert.match(UI_DRAWER, /<div ref=\{footerRef\}/);
  });

  it("a toast fits a phone and its buttons are big enough to hit", () => {
    assert.match(TOAST, /w-full sm:w-auto sm:min-w-\[320px\] max-w-\[480px\]/);
    assert.ok(!/"min-w-\[320px\] max-w-\[480px\]/.test(TOAST), "the fixed 320px minimum is back");
    assert.match(TOAST, /min-h-10 items-center rounded-md text-sm font-semibold underline/);
    assert.match(TOAST, /flex h-10 w-10 shrink-0 items-center justify-center/);
  });

  it("every toast, an error too, can be dismissed, and one being read does not vanish", () => {
    assert.match(TOAST, /aria-label="Dismiss"/);
    assert.match(TOAST, /onMouseEnter=\{\(\) => onHold\?\.\(toast\.id\)\}/);
    assert.match(TOAST, /onFocus=\{\(\) => onHold\?\.\(toast\.id\)\}/);
    assert.match(TOAST_CONTEXT, /const holdToast = useCallback/);
    assert.match(TOAST_CONTEXT, /timersRef\.current\[id\] = setTimeout\(\(\) => removeToast\(id\), RELEASE_MS\);/);
    assert.match(TOAST_CONTEXT, /value=\{\{ toasts, addToast, removeToast, holdToast, releaseToast \}\}/);
  });

  it("existing callers are untouched: same arguments, same lifetimes", () => {
    assert.match(TOAST_CONTEXT, /success: 5000,\s*info: 5000,\s*warning: 8000,\s*error: null,/);
    assert.ok(TOAST_CONTEXT.includes('{ variant = "info", title, description, action, duration }'));
  });
});

describe("#3802 R-6 (F-6): keyboard", () => {
  it("focus goes into the delete question and back to Delete after Keep", () => {
    assert.match(DRAWER, /if \(confirmDelete\) \{\s*askedRef\.current = true;\s*keepRef\.current\?\.focus\(\);/);
    assert.match(DRAWER, /askedRef\.current = false;\s*askDeleteRef\.current\?\.focus\(\);/);
    assert.match(DRAWER, /<Button ref=\{keepRef\}/);
    assert.match(DRAWER, /<Button ref=\{askDeleteRef\}/);
  });

  it("after a delete, focus lands on a real control on the page", () => {
    assert.match(PAGE, /setTimeout\(\(\) => addButtonRef\.current\?\.focus\(\), \d+\);/);
    assert.match(PAGE, /addButton\("primary", "md", addButtonRef\)/);
  });

  it("Tab inside an open card also reaches a toast's Undo or Open", () => {
    assert.match(UI_DRAWER, /const toasts = document\.querySelector\("\[data-toast-region\]"\);/);
    assert.match(UI_DRAWER, /\.\.\.panel\.querySelectorAll\(FOCUSABLE_SELECTOR\),\s*\.\.\.\(toasts \? toasts\.querySelectorAll\(FOCUSABLE_SELECTOR\) : \[\]\),/);
    assert.match(UI_DRAWER, /const inside = panel\.contains\(active\) \|\| \(!!toasts && toasts\.contains\(active\)\);/);
  });

  it("a closed card gets focus back even when it changed column while open", () => {
    assert.match(PAGE, /el\.getAttribute\("data-record-id"\) === closed\);\s*\(card \|\| addButtonRef\.current\)\?\.focus\(\);/);
  });

  it("Escape still closes the card and focus still returns to where it was", () => {
    assert.match(UI_DRAWER, /onCloseRef\.current\?\.\(\);/);
    assert.match(UI_DRAWER, /if \(previousFocusRef\.current\?\.focus\) previousFocusRef\.current\.focus\(\);/);
  });
});

describe("#3802 R-7 (F-7): a stale board", () => {
  const shown = { id: "r1", name: "Lagos Eats", stage: "prospect" };
  const now = Date.parse("2026-10-13T12:00:00Z");
  const colleague = {
    kind: "stage_move",
    actor_email: "maya@test.local",
    actor_name: "Maya",
    from_stage: "prospect",
    to_stage: "meeting",
    occurred_at: "2026-10-13T11:57:00Z",
  };

  it("nothing changed: the move goes ahead", () => {
    assert.deepEqual(freshnessVerdict(HOSTS, shown, { ...shown }, "contacted", [], now), { kind: "go" });
    assert.deepEqual(freshnessVerdict(HOSTS, shown, null, "contacted", [], now), { kind: "go" });
  });

  it("the tester's case: a colleague moved it to Meeting, my arrow says Contacted", () => {
    const v = freshnessVerdict(HOSTS, shown, { ...shown, stage: "meeting" }, "contacted", [colleague], now);
    assert.equal(v.kind, "moved");
    assert.equal(v.title, "Lagos Eats is no longer in Prospect");
    assert.ok(v.description.startsWith("Maya moved it from Prospect to Meeting 3m ago."), v.description);
    assert.ok(v.description.includes("Your move was not made."));
  });

  it("two people making the same move: the second is told, plainly", () => {
    const v = freshnessVerdict(HOSTS, shown, { ...shown, stage: "contacted" }, "contacted", [{ ...colleague, to_stage: "contacted" }], now);
    assert.equal(v.kind, "already");
    assert.equal(v.title, "Lagos Eats is already in Contacted");
    assert.ok(v.description.startsWith("Maya moved it there 3m ago."));
  });

  it("a move the system made, or one with no history to hand, still gets words and no token", () => {
    const system = { kind: "stage_move", actor_email: null, to_stage: "live", occurred_at: "2026-10-13T11:59:30Z" };
    const bySystem = freshnessVerdict(HOSTS, { ...shown, stage: "onboarded" }, { ...shown, stage: "live" }, "lost", [system], now);
    assert.ok(bySystem.description.includes("by itself"), bySystem.description);
    const unknown = freshnessVerdict(HOSTS, shown, { ...shown, stage: "meeting" }, "contacted", undefined, now);
    assert.ok(unknown.description.startsWith("It is in Meeting now, not Prospect."));
    for (const v of [bySystem, unknown]) assert.ok(!/undefined|null|_/.test(v.title + v.description));
  });

  it("the page asks the server where the card is before every move, and stops on a difference", () => {
    const at = PAGE.indexOf("const requestMove = useCallback(");
    const body = PAGE.slice(at, PAGE.indexOf("// A failed move to Lost or Passed", at));
    const order = ["pipe.checkFresh(shown.id)", "freshnessVerdict(def, shown, record, to, fresh.activity)", 'if (verdict.kind !== "go")', "moveBlocker(def, record, to)", "performMove(record, to);"];
    let last = -1;
    for (const step of order) {
      const i = body.indexOf(step);
      assert.ok(i > last, `"${step}" is missing or out of order`);
      last = i;
    }
    assert.match(body, /if \(verdict\.kind !== "go"\) \{[\s\S]{0,260}return;\s*\}/);
    // Drag, the arrow and the stage menu all go through this one function.
    assert.match(PAGE, /onMove=\{requestMove\}/);
    assert.match(PAGE, /onRequestMove=\{requestMove\}/);
  });

  it("a move the server reports as already made is confirmed, not silent", () => {
    assert.match(PAGE, /if \(!res\.changed\) \{\s*addToast\(\{\s*variant: "info",\s*title: `\$\{record\.name\} is already in/);
  });

  it("the board refreshes on a quiet timer, only while visible, online and not being typed in", () => {
    assert.ok(BOARD_REFRESH_MS >= 15_000 && BOARD_REFRESH_MS <= 60_000);
    assert.match(HOOK, /setInterval\(\(\) => \{\s*if \(pausedRef\.current\) return;\s*if \(document\.visibilityState !== "visible"\) return;\s*if \(navigator\.onLine === false\) return;\s*refetch\(\{ quiet: true \}\);\s*\}, BOARD_REFRESH_MS\);/);
    assert.match(HOOK, /return \(\) => clearInterval\(timer\);/);
    assert.match(PAGE, /useCrmPipeline\(pipeline, \{ enabled: !!def, paused: !!dirtyCard \|\| !!reasonFor \}\);/);
  });

  it("every move names the stage it saw", () => {
    // The server's move function takes the stage the caller last saw the card
    // in, and refuses the move if the card has moved since. The screen sends
    // it on every move.
    const NEXT_MIGRATION = fs.readFileSync(
      path.resolve(SRC, "../../supabase/migrations/20270823003802_issue_3802_wave1_homes_targets_beta.sql"),
      "utf8"
    );
    assert.match(NEXT_MIGRATION, /p_expected_from text DEFAULT NULL/);
    assert.match(SERVICE, /p_expected_from: expectedFrom/);
  });
});

describe("#3802 R-8: the smaller items", () => {
  it("closing a card opened from the page goes back, so Back does not reopen it", () => {
    assert.match(PAGE, /if \(cardEntryPushed\.current\) \{\s*cardEntryPushed\.current = false;\s*window\.history\.back\(\);\s*\} else \{\s*patch\(\{ card: "" \}, \{ replace: true \}\);/);
  });

  it("a column that will not take the card does not look like a drop target", () => {
    assert.match(BOARD, /const isOver = over && !refused;/);
    assert.match(BOARD, /if \(refusal\(stage\.id\)\) \{\s*e\.dataTransfer\.dropEffect = "none";\s*return;\s*\}\s*e\.preventDefault\(\);/);
    assert.match(BOARD, /block\.token === "stage_sets_itself" \|\| block\.token === "stage_is_live"/);
    assert.match(BOARD, /Can&apos;t drop here\. \{refused\.message\}/);
  });

  it("a column is capped and scrolls inside itself", () => {
    assert.match(BOARD, /max-h-\[min\(72vh,760px\)\]/);
    assert.match(BOARD, /flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto/);
  });

  it("the board scrolls sideways while a card is dragged near its edge", () => {
    assert.match(BOARD, /onDragOver=\{canDrag && !disabled \? steerScroll : undefined\}/);
    assert.match(BOARD, /if \(e\.clientX < box\.left \+ EDGE_PX\) speed = -EDGE_SPEED;/);
    assert.match(BOARD, /else if \(e\.clientX > box\.right - EDGE_PX\) speed = EDGE_SPEED;/);
    assert.match(BOARD, /const endDrag = \(\) => \{\s*stopScrolling\(\);/);
  });

  it("a name in the list is a comfortable tap target", () => {
    assert.match(LIST, /className="flex min-h-11 w-full /);
  });

  it("the breadcrumb never reads 'Admin' for the two non-admin roles, and names their own home", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: a root crumb labelled with the role's
    // home (or "Admin") that went there when clicked. The approved shell has no
    // root crumb: the breadcrumb is "Group › Page" in plain words, built from
    // the page title the shell resolved for this person. So "Admin" is never
    // written, and a role home reads its own name.
    assert.ok(HEADER.includes("items={breadcrumbFor(activeTab, title, NAV_GROUPS)}"));
    assert.equal(/["']Admin["']/.test(HEADER), false);
    assert.deepEqual(breadcrumbFor("home", "My day", NAV_GROUPS), [{ label: "My day" }]);
    assert.deepEqual(breadcrumbFor("hosts", "Hosts", NAV_GROUPS), [{ label: "Pipeline" }, { label: "Hosts" }]);
  });

  it("both keys in the key factory are used", () => {
    assert.match(HOOK, /const key = crmKeys\.records\(access\?\.email, pipeline\);/);
    assert.match(HOOK, /const current = state\.key === key;/);
  });
});
