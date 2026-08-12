import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const roots = ["mingla-business/app", "mingla-business/src", "packages"];
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
};

const productionSources = roots.flatMap((root) => walk(root));
const sourcesWith = (pattern) => productionSources.filter((file) => pattern.test(fs.readFileSync(file, "utf8")));

test("no Business route can switch on the dormant cover-overlay seam", () => {
  const routeOptIns = sourcesWith(/<[^>]+\suseDirectionCIdentity(?:\s|\/?>)/)
    .filter((file) => file.startsWith("mingla-business/app/"));
  assert.deepEqual(routeOptIns, []);
});

test("direct identity props do not leak into ordinary Business previews", () => {
  const directProps = sourcesWith(/directionCIdentity=\{/);
  const forbidden = directProps.filter((file) =>
    file === "mingla-business/src/components/event/FoundationEventPreview.tsx" ||
    file.startsWith("mingla-business/app/") ||
    file.includes("ExperiencePreview") ||
    file.includes("RsvpPreview"),
  );
  assert.deepEqual(forbidden, []);
});

test("share artwork remains owned by rendering primitives, not destination routes", () => {
  const shell = fs.readFileSync("packages/offering-rendering/ParallaxCoverShell.tsx", "utf8");
  assert.match(shell, /<DirectionCIdentityOverlay/);
  const legacyEvent = fs.readFileSync("packages/offering-rendering/PublicEventPage.tsx", "utf8");
  assert.match(legacyEvent, /useDirectionCIdentity = false/);
  assert.match(legacyEvent, /useDirectionCIdentity \? \(/);

  const explorer = fs.readFileSync("app-mobile/app/s/[code].tsx", "utf8");
  assert.match(explorer, /readContentShare\(code\)/);
  assert.match(explorer, /router\.replace\(path as never\)/);
  assert.match(explorer, /buildSharePortraitUrl\(share\.shortCode, share\.version\)/);
});
