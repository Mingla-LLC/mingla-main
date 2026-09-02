import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

const evaluateCommonJs = (file, resolveModule) => {
  const module = { exports: {} };
  const source = read(file);
  const execute = new Function("require", "module", "exports", source);
  execute(resolveModule, module, module.exports);
  return module.exports;
};

const responseRecorder = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(name, value) { this.headers[name] = String(value); },
  end(value = "") { this.body = String(value); },
});

const publicSearchWithResolution = (resolution) => evaluateCommonJs(
  "mingla-business/server/publicSearchDocument.js",
  (specifier) => {
    if (specifier === "./supabaseRpc") {
      return {
        requestRpcJson: async () => {
          if (resolution instanceof Error) throw resolution;
          return resolution;
        },
      };
    }
    if (specifier === "./publicSearchBrowserRuntime") {
      return { browserRuntimeScript: () => "" };
    }
    throw new Error(`unexpected module ${specifier}`);
  },
);

const invokeExperience = async (resolution) => {
  const shared = publicSearchWithResolution(resolution);
  const response = responseRecorder();
  await shared.handlePublicSearchDocument({
    req: { method: "GET", url: "/exp/art-roost/collectors-preview" },
    res: response,
    kind: "experience",
    slugs: ["art-roost", "collectors-preview"],
  });
  return response;
};

const visibleExperience = () => ({
  valid: true,
  kind: "experience",
  state: "search_ready",
  integrityOk: true,
  facts: {
    kind: "experience",
    id: "experience-1",
    title: "Collectors Preview",
    brandName: "Art Roost",
    brandSlug: "art-roost",
    actionAvailable: false,
  },
});

test("custom sharing remains confined to native public pages and management surfaces", () => {
  const helper = read(
    "mingla-business/src/utils/shareCanonicalPublicPageOnWeb.ts",
  );
  assert.match(helper, /Platform\.OS !== "web"/);
  assert.match(helper, /throw new Error\("canonical_public_web_share_requires_web"\)/);
  assert.match(helper, /if \(isShareCancellation\(error\)\) return "cancelled"/);
  assert.match(helper, /return "failed"/);

  const managementSurfaces = [
    "mingla-business/app/event/[id]/index.tsx",
    "mingla-business/app/rsvp/[id]/index.tsx",
    "mingla-business/app/trip/[id]/index.tsx",
    "mingla-business/app/experience/[id]/index.tsx",
  ];
  for (const file of managementSurfaces) {
    const source = read(file);
    assert.match(source, /<ShareModal/, file);
    assert.doesNotMatch(source, /shareCanonicalPublicPageOnWeb/, file);
  }
});

test("experience handler delegates the exact slug tuple with no route-local authority", async () => {
  const handler = read("mingla-business/api/public-experience.js");
  assert.doesNotMatch(handler, /renderNotFoundHtml|renderExperienceHtml|socialPreview|user-agent/i);

  const calls = [];
  const loaded = evaluateCommonJs(
    "mingla-business/api/public-experience.js",
    (specifier) => {
      assert.equal(specifier, "../server/publicSearchDocument");
      return {
        firstQueryValue: (value) => Array.isArray(value) ? value[0] : value,
        handlePublicSearchDocument: async (input) => { calls.push(input); },
      };
    },
  );
  const req = {
    query: {
      brandSlug: ["art-roost", "ignored-brand"],
      experienceSlug: ["collectors-preview", "ignored-experience"],
    },
  };
  const res = {};
  await loaded(req, res);
  assert.deepEqual(calls, [{
    req,
    res,
    kind: "experience",
    slugs: ["art-roost", "collectors-preview"],
  }]);
});

test("shared experience truth fails closed on kind collisions, invalid, missing, and error states", async () => {
  const good = await invokeExperience(visibleExperience());
  assert.equal(good.statusCode, 200);

  const wrongResolutionKind = visibleExperience();
  wrongResolutionKind.kind = "trip";
  const wrongFactsKind = visibleExperience();
  wrongFactsKind.facts.kind = "trip";
  const invalid = visibleExperience();
  invalid.valid = false;
  const missingFacts = visibleExperience();
  missingFacts.facts = null;

  for (const resolution of [wrongResolutionKind, wrongFactsKind, invalid, missingFacts, null, new Error("upstream")]) {
    const response = await invokeExperience(resolution);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /Temporarily unavailable/);
    assert.equal(response.headers["x-robots-tag"], "noindex");
  }
});

test("canonical and Explorer snippet URLs cannot be accidentally conflated", () => {
  const social = read("mingla-business/server/socialPreview.js");
  assert.match(
    social,
    /const experiencePublicPath = \(row\) =>\s*`\/exp\/\$\{encodeURIComponent\(row\.brand_slug\)\}\/\$\{encodeURIComponent\(row\.slug\)\}`/,
  );
  assert.match(
    social,
    /const canonicalUrl = `\$\{EXPLORER_PUBLIC_ORIGIN\}\/s\/\$\{encodeURIComponent\(code\)\}`/,
  );
  assert.doesNotMatch(
    read("mingla-business/src/utils/shareCanonicalPublicPageOnWeb.ts"),
    /EXPLORER_PUBLIC_ORIGIN|\/s\/|contentShare/,
  );
});
