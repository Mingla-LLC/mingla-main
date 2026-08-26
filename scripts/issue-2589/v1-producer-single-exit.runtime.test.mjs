/**
 * #2589 — a V1 share failure has exactly ONE honest exit and cannot reach the
 * legacy producer. Proven by EXECUTING the shipped producer, not by reading it.
 *
 * WHY THIS EXISTS. #2589 changed what `prepareContentShare` throws: three
 * unrelated server outcomes (an unpublished offering, a signed-out session, a
 * real outage) were arriving at the sheet as one string beside a Retry that
 * could not help two of them, so the throw now carries a typed reason. The
 * property that change must not disturb is older and more important than the
 * copy: when the current producer fails it must fail VISIBLY, exactly once, and
 * must never quietly fall back to the pre-#1615 `/p` producer — because a silent
 * downgrade is how a failure stops being visible and starts shipping subtly
 * wrong artwork instead. That regression was found on a physical Samsung and is
 * what `device-acceptance-rework` D2 exists to prevent.
 *
 * D2 pins it with two regexes over the source. Those are statements about text.
 * This suite runs the real function over the full matrix of failure shapes and
 * asserts what actually happens: every shape throws, none returns, none reaches
 * the legacy producer, and the legacy producer is not even wired to a caller.
 *
 * The extraction is pinned — the four declarations must be found, and the
 * executed function must exhibit both exits — so a rename or reshape fails
 * loudly rather than quietly testing nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharing from "../../packages/sharing/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const ADAPTER = "app-mobile/src/services/contentShareAdapter.ts";
const source = read(ADAPTER);

/**
 * Lifts the real producer and its real status→reason mapping out of the adapter
 * and strips only the type annotations. The bodies are otherwise byte-identical
 * to what ships, so what runs below is the shipped control flow.
 */
function extractProducer() {
  const start = source.indexOf("const SHARE_FAILURE_PREFIX = 'share_create_failed:';");
  assert.notEqual(start, -1, "SHARE_FAILURE_PREFIX is no longer where it was");
  const tail = source.indexOf("publicDetails: data.publicDetails ?? null,", start);
  assert.notEqual(tail, -1, "prepareContentShare's return is no longer where it was");
  const end = source.indexOf("\n}", tail) + 2;

  const slice = source.slice(start, end);
  for (const required of ["reasonForStatus", "invokeStatus", "export async function prepareContentShare"]) {
    assert.ok(slice.includes(required), `the extraction lost ${required}`);
  }
  assert.match(slice, /if \(!error && data\?\.shortCode && data\?\.facts\)/, "the extraction lost the success branch");
  assert.match(slice, /throw Object\.assign\(new Error\(/, "the extraction lost the failure branch");

  const js = slice
    .replace("const reasonForStatus = (status: number | null): ContentShareFailureReason =>", "const reasonForStatus = (status) =>")
    .replace("const invokeStatus = (error: unknown): number | null => {", "const invokeStatus = (error) => {")
    .replace("  const status = (error as { context?: { status?: unknown } } | null | undefined)?.context?.status;", "  const status = error?.context?.status;")
    .replace(
      "export async function prepareContentShare(kind: ShareEntityKind, identity: ContentShareIdentity, channel = 'generic', messageContext: ShareMessageContext = {}): Promise<PreparedContentShare> {",
      "async function prepareContentShare(kind, identity, channel = 'generic', messageContext = {}) {",
    )
    .replace("await supabase.functions.invoke<CreatedShare>('shared-card', {", "await supabase.functions.invoke('shared-card', {")
    .replace("return { contract: 'content_share_v1' as const, data };", "return { contract: 'content_share_v1', data };");
  assert.doesNotMatch(js, /: (?:number|unknown|ShareEntityKind|ContentShareIdentity)\b|<CreatedShare>|as const/, "a type annotation survived the strip");
  return `${js}\nreturn prepareContentShare;`;
}

/**
 * Builds the real producer over instrumented stubs.
 *
 * `createSharedCard` and the other legacy symbols are injected as TRAPS: if the
 * shipped code ever reached for one, the recorder fires. `singleFlight` is the
 * real one from the shared package, so the dedupe wrapper's own error handling
 * is exercised rather than bypassed.
 */
function buildProducer(invokeResult) {
  const trapped = [];
  const trap = (name) => (...args) => { trapped.push({ name, args }); return { shareId: "legacy" }; };
  const scope = {
    singleFlight: sharing.createContentShareSingleFlight(),
    supabase: { functions: { invoke: async () => (typeof invokeResult === "function" ? invokeResult() : invokeResult) } },
    buildShortShareUrl: sharing.buildShortShareUrl,
    buildSharePortraitUrl: sharing.buildSharePortraitUrl,
    // The legacy producer and its companions, live and watched.
    createSharedCard: trap("createSharedCard"),
    prepareLegacyPublicFields: trap("prepareLegacyPublicFields"),
    isLegacyRollbackEligible: trap("isLegacyRollbackEligible"),
  };
  const names = Object.keys(scope);
  // eslint-disable-next-line no-new-func -- the adapter's own source, read from disk
  const prepare = new Function(...names, extractProducer())(...names.map((name) => scope[name]));
  return { prepare, trapped };
}

/** Every shape a V1 create can fail in. */
const FAILURES = [
  ["401 signed out", { data: null, error: { context: { status: 401 } } }, "unauthorized"],
  ["403 forbidden", { data: null, error: { context: { status: 403 } } }, "unauthorized"],
  ["404 unpublished or wrong kind", { data: null, error: { context: { status: 404 } } }, "not_public"],
  ["503 outage", { data: null, error: { context: { status: 503 } } }, "unavailable"],
  ["500 server error", { data: null, error: { context: { status: 500 } } }, "unknown"],
  ["429 rate limited", { data: null, error: { context: { status: 429 } } }, "unknown"],
  ["408 timeout", { data: null, error: { context: { status: 408 } } }, "unknown"],
  ["425 too early", { data: null, error: { context: { status: 425 } } }, "unknown"],
  ["transport failure, no context", { data: null, error: { message: "Failed to fetch" } }, "unknown"],
  ["a thrown plain object, not an Error", { data: null, error: { context: null } }, "unknown"],
  ["a non-numeric status", { data: null, error: { context: { status: "503" } } }, "unknown"],
  ["200 with no shortCode", { data: { facts: { kind: "event" }, version: 1, message: "m" }, error: null }, "unknown"],
  ["200 with no facts", { data: { shortCode: "Aa0Bb1Cc2Dd3Ee4F", version: 1, message: "m" }, error: null }, "unknown"],
  ["200 with a null body", { data: null, error: null }, "unknown"],
];

test("V1 EVERY failure shape throws — there is no second exit that returns", async () => {
  for (const [label, result, expected] of FAILURES) {
    const { prepare, trapped } = buildProducer(result);
    let returned = null;
    let thrown = null;
    try { returned = await prepare("event", { brandSlug: "b", eventSlug: "e" }); }
    catch (error) { thrown = error; }

    assert.equal(returned, null, `${label}: the producer RETURNED on a failure — that is the second exit`);
    assert.notEqual(thrown, null, `${label}: the producer neither returned nor threw`);
    // One honest exit, and it is honest about which failure it was.
    assert.equal(thrown.reason, expected, label);
    assert.equal(thrown.message, `share_create_failed:${expected}`, label);
    // And it never reached for the legacy producer on the way out.
    assert.deepEqual(trapped, [], `${label}: the failure path touched ${trapped.map((call) => call.name).join(", ")}`);
  }
});

test("V2 the success path is the ONLY path that returns, and it is unchanged", async () => {
  const { prepare, trapped } = buildProducer({
    data: {
      shortCode: "Aa0Bb1Cc2Dd3Ee4F", version: 4, message: "come along",
      facts: { schemaVersion: 1, kind: "event", title: "A real event" },
      media: { kind: "photo", url: "https://usemingla.com/a.jpg", posterUrl: "https://usemingla.com/a.jpg" },
    },
    error: null,
  });
  const prepared = await prepare("event", { brandSlug: "b", eventSlug: "e" });
  assert.equal(prepared.contract, "content_share_v1");
  assert.equal(prepared.shortCode, "Aa0Bb1Cc2Dd3Ee4F");
  assert.equal(prepared.canonicalUrl, "https://usemingla.com/s/Aa0Bb1Cc2Dd3Ee4F");
  // The card URL is built here, in the adapter — the layer that owns it.
  assert.equal(prepared.s4Url, "https://usemingla.com/og/s/Aa0Bb1Cc2Dd3Ee4F/v4-r2.jpg");
  assert.deepEqual(trapped, []);

  // A cover-less success still returns, with no card and no legacy detour.
  const coverless = buildProducer({
    data: { shortCode: "Bb0Cc1Dd2Ee3Ff4G", version: 1, message: "m", facts: { schemaVersion: 1, kind: "event", title: "T" } },
    error: null,
  });
  const noCover = await coverless.prepare("event", { brandSlug: "b", eventSlug: "e" });
  assert.equal(noCover.s4Url, null);
  assert.deepEqual(coverless.trapped, []);
});

test("V3 a failure stays a failure on retry — the single-flight cache never converts it into a stale success", async () => {
  // The dedupe wrapper is real. If a rejected flight were cached, the second
  // attempt would resolve from it and a visible failure would silently become a
  // success — a different route to the same class of defect D2 guards.
  let attempts = 0;
  const { prepare, trapped } = buildProducer(() => {
    attempts += 1;
    return attempts === 1
      ? { data: null, error: { context: { status: 503 } } }
      : { data: { shortCode: "Cc0Dd1Ee2Ff3Gg4H", version: 1, message: "m", facts: { schemaVersion: 1, kind: "event", title: "T" } }, error: null };
  });

  await assert.rejects(() => prepare("event", { brandSlug: "b", eventSlug: "e" }), /share_create_failed:unavailable/);
  const recovered = await prepare("event", { brandSlug: "b", eventSlug: "e" });
  assert.equal(recovered.shortCode, "Cc0Dd1Ee2Ff3Gg4H");
  assert.equal(attempts, 2, "the retry did not perform a real second request");
  assert.deepEqual(trapped, []);
});

test("V4 the legacy producer is not merely unused by this path — nothing in the app calls it at all", () => {
  // The strongest available statement, and it is total rather than per-probe:
  // the pre-#1615 producer exists only as a declaration. Nothing invokes it.
  const legacy = read("app-mobile/src/services/sharedCardService.ts");
  assert.match(legacy, /export async function createSharedCard\(/, "createSharedCard has moved; re-derive this assertion");

  const callers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = path.relative(ROOT, absolute);
      if (relative.endsWith("app-mobile/src/services/sharedCardService.ts")) continue;
      const text = fs.readFileSync(absolute, "utf8");
      // A call, not a type-only import of its result shape.
      if (/\bcreateSharedCard\s*\(/.test(text)) callers.push(relative);
    }
  };
  walk(path.join(ROOT, "app-mobile/src"));
  assert.deepEqual(callers, [], `the legacy producer acquired a caller: ${callers.join(", ")}`);

  // And the producer module carries none of the legacy symbols D2 names.
  assert.doesNotMatch(source, /createSharedCard|legacy_shared_card|isLegacyRollbackEligible|usemingla\.com\/p\//);
});
