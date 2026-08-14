import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { renderContentShareHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
const { createContentShareHandler } = require(path.join(ROOT, "mingla-business/api/content-share.js"));

const share = (kind, destination) => ({
  shortCode: "Zz9Yy8Xx7Ww6Vv5U",
  version: 4,
  facts: { schemaVersion: 1, kind, title: "Runtime destination", description: "A real snippet." },
  media: { kind: "none" },
  destination,
  publicDetails: { kind, actionEligible: true, occurrences: [], offerings: [] },
});

const executeHeadContinuation = (html) => {
  const head = html.slice(0, html.indexOf("</head>"));
  const scripts = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const calls = [];
  const location = {
    replace(value) {
      assert.equal(this, location, "replace must retain its browser receiver");
      calls.push(value);
    },
    assign() { throw new Error("history-adding assign must not run"); },
  };
  for (const script of scripts) vm.runInNewContext(script, { window: { location } });
  return calls;
};

test("the shipped head executes one history-replacing continuation, not an intermediate-page navigation", () => {
  const expected = "https://host.usemingla.com/exp/art-roost/private-view";
  const html = renderContentShareHtml(share("experience", {
    kind: "experience",
    brandSlug: "art-roost",
    eventSlug: "private-view",
    webPath: "/exp/art-roost/private-view",
  }));
  assert.deepEqual(executeHeadContinuation(html), [expected]);
  assert.doesNotMatch(html, /window\.location\.(?:assign|href)/);
  assert.doesNotMatch(html, /http-equiv=["']refresh/i);
});

test("encoded slugs cannot turn the same-origin continuation into an open redirect", () => {
  const expected = "https://host.usemingla.com/b/gallery%20lagos/v/room%231";
  const html = renderContentShareHtml(share("venue", {
    kind: "venue",
    brandSlug: "gallery lagos",
    venueSlug: "room#1",
    webPath: "/b/gallery%20lagos/v/room%231",
  }));
  assert.deepEqual(executeHeadContinuation(html), [expected]);

  const attacks = [
    { kind: "brand", brandSlug: "//evil.example", webPath: "/b///evil.example" },
    { kind: "brand", brandSlug: "https://evil.example", webPath: "/b/https://evil.example" },
    { kind: "venue", brandSlug: "safe", venueSlug: "room", webPath: "/b/safe/v/room?next=https://evil.example" },
  ];
  for (const destination of attacks) {
    assert.deepEqual(executeHeadContinuation(renderContentShareHtml(share(destination.kind, destination))), []);
  }
});

const responseRecorder = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(name, value) { this.headers[name] = value; },
  end(value) { this.body = String(value ?? ""); },
});

test("404, gone, and upstream-error receiver pages never continue anywhere", async () => {
  const previousSecret = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = "issue-2004-test-secret";
  try {
    for (const [status, contentShare] of [[404, null], [410, null], [503, null]]) {
      const handler = createContentShareHandler(async () => ({ status, contentShare }));
      const res = responseRecorder();
      await handler({ query: { code: "Zz9Yy8Xx7Ww6Vv5U" }, headers: { "x-mingla-shared-card-proxy": "issue-2004-test-secret" } }, res);
      assert.equal(res.statusCode, status);
      assert.doesNotMatch(res.body, /window\.location\.replace/);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previousSecret;
  }
});
