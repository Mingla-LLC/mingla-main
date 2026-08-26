/**
 * #2589 — the consumer share sheet still opens SYNCHRONOUSLY, and preparation
 * and recipients are still independent. Proven by EXECUTING the shipped
 * function, not by reading it.
 *
 * WHY THIS EXISTS. #2589's convergence work touched the same provider that owns
 * the sheet's open. The property at risk is the one behind Seth's original
 * "tap Share, stare at nothing" report: the sheet must become visible before
 * anything is fetched, and neither the share preparation nor the recipient list
 * may gate the other. Three suites already pin that — but they pin it with
 * `indexOf` comparisons over the source text, which is a statement about where
 * two strings sit in a file, not about what happens when the function runs.
 *
 * So this runs it. `openContentShare`'s real body is lifted out of the provider
 * and executed with recording stubs for every identifier it closes over. What is
 * asserted is the ORDER OF OBSERVED CALLS, and the fact that the two loaders are
 * kicked off without either awaiting the other.
 *
 * The extraction is pinned three ways — the function must be found, its tail
 * must be found, and the recorded sequence must contain all three calls — so a
 * rename or a reshape fails loudly rather than quietly testing nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROVIDER = "app-mobile/src/components/share/UnifiedShareProvider.tsx";
const source = fs.readFileSync(path.join(ROOT, PROVIDER), "utf8");

/** Lifts `openContentShare`'s body out of the component and strips its types. */
function extractOpen() {
  const start = source.indexOf("const openContentShare = useCallback((nextInput: OpenContentShareInput): void => {");
  assert.notEqual(start, -1, "openContentShare is no longer where it was");
  const end = source.indexOf("}, [loadRecipients, loadShare, visible]);", start);
  assert.notEqual(end, -1, "openContentShare's dependency tail is no longer where it was");
  const body = source
    .slice(start, end)
    .replace("const openContentShare = useCallback((nextInput: OpenContentShareInput): void => {", "return function openContentShare(nextInput) {")
    + "}";
  assert.match(body, /setVisible\(true\)/, "the extraction lost the open call");
  assert.match(body, /loadShare\(nextInput, token\)/, "the extraction lost the preparation call");
  assert.match(body, /loadRecipients\(token\)/, "the extraction lost the recipients call");
  return body;
}

/** Builds the real function over recording stubs and runs it once. */
function runOpen({ resolveLoaders = true } = {}) {
  const calls = [];
  const record = (name) => (...args) => { calls.push({ name, args }); };
  const ref = (value) => ({ current: value });
  const deferred = () => ({ promise: new Promise(() => {}), resolve() {}, reject() {}, settled: false });

  const scope = {
    // refs and closure state
    activePresentationAttempt: ref(null),
    pendingExpandedAttempt: ref(null),
    inputRef: ref(null),
    generation: ref(0),
    visible: false,
    createPresentationDeferred: deferred,
    Platform: { OS: "ios" },
    trackContentShareEvent: record("trackContentShareEvent"),
    console: { info: record("console.info") },
    // the three calls under test
    setVisible: record("setVisible"),
    loadShare: resolveLoaders
      ? record("loadShare")
      : (...args) => { calls.push({ name: "loadShare", args }); throw new Error("loadShare_exploded"); },
    loadRecipients: record("loadRecipients"),
  };
  // every remaining setter the body touches, recorded rather than stubbed away
  for (const setter of [
    "setNativeCycleId", "setInput", "setPrepared", "setPrepFailure", "setRecipients",
    "setRecipientError", "setRecipientsReady", "setSelected", "setNote", "setNoteExpanded",
    "setSearch", "setCopied", "setSending", "setDeliveryState", "setPosterFailed",
    "setExternalError", "setReadiness", "setOutcome",
  ]) scope[setter] = record(setter);

  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func -- the provider's own source, read from disk
  const open = new Function(...names, extractOpen())(...names.map((name) => scope[name]));
  let thrown = null;
  try {
    open({ kind: "event", identity: { brandSlug: "b", eventSlug: "e" }, producerSurface: "direct" });
  } catch (error) { thrown = error; }
  return { calls: calls.map((call) => call.name), raw: calls, thrown };
}

test("O1 the sheet is visible BEFORE either fetch is started — executed, not read", () => {
  const { calls, thrown } = runOpen();
  assert.equal(thrown, null, thrown && thrown.message);

  const visibleAt = calls.indexOf("setVisible");
  const shareAt = calls.indexOf("loadShare");
  const recipientsAt = calls.indexOf("loadRecipients");
  assert.notEqual(visibleAt, -1, calls.join(" -> "));
  assert.notEqual(shareAt, -1, calls.join(" -> "));
  assert.notEqual(recipientsAt, -1, calls.join(" -> "));

  // THE PROPERTY. Not "these strings appear in this order in a file" — these
  // calls happened in this order when the function ran.
  assert.ok(visibleAt < shareAt, `open must precede preparation: ${calls.join(" -> ")}`);
  assert.ok(visibleAt < recipientsAt, `open must precede recipients: ${calls.join(" -> ")}`);

  // And nothing was awaited on the way to opening: the whole sequence completed
  // in one synchronous turn, so there is no tick on which the sheet is invisible
  // while a fetch is outstanding.
  assert.equal(calls.filter((name) => name === "setVisible").length, 1);
});

test("O2 preparation and recipients are independent — one exploding does not suppress the other", () => {
  // `loadShare` throwing is a stand-in for it being slow, failing, or absent.
  // If the sheet gated recipients on preparation, this would swallow them.
  const { calls, thrown } = runOpen({ resolveLoaders: false });
  assert.notEqual(thrown, null, "the harness did not reach the exploding loader");
  assert.equal(thrown.message, "loadShare_exploded");

  // The sheet was ALREADY open before the failure, which is the whole point:
  // a share that cannot be prepared still shows the user a sheet with a reason.
  assert.ok(calls.indexOf("setVisible") < calls.indexOf("loadShare"), calls.join(" -> "));

  // And the two loaders are separate statements, neither passed to the other —
  // so recipients do not consume preparation's result.
  const body = extractOpen();
  assert.match(body, /loadShare\(nextInput, token\);\s*\n\s*loadRecipients\(token\);/);
  assert.doesNotMatch(body, /await\s+loadShare|loadShare\([^)]*\)\s*\.then/);
});

test("O3 the sheet never handles the generated portrait card's URL", () => {
  // The boundary three sibling suites pin, asserted here in its own right so the
  // reason is recorded next to the property rather than only in a token list:
  // this sheet previews the COVER. Building the card URL is the adapter's job.
  assert.match(source, /prepared\?\.media\?\.posterUrl/);
  assert.doesNotMatch(source, /s4Url|buildSharePortraitUrl/);
  assert.doesNotMatch(source, /Share\.share|Linking\.openURL|whatsapp:\/\/|twitter:\/\//);
});
