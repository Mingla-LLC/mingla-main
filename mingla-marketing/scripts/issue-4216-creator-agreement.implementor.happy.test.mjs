import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const content = await import(
  pathToFileURL(new URL("lib/creatorAgreementContent.ts", root).pathname)
);
const page = readFileSync(
  new URL("app/creator-agreement/page.tsx", root),
  "utf8",
);
const source = readFileSync(
  new URL("lib/creatorAgreementContent.ts", root),
  "utf8",
);

assert.equal(content.CREATOR_AGREEMENT_VERSION, "creator-v1");
assert.equal(content.CREATOR_AGREEMENT_SECTIONS.length, 25);
assert.match(page, /Agreement fingerprint/);
assert.match(page, /robots:\s*\{\s*index:\s*true/);
assert.doesNotMatch(
  source,
  /DRAFT FOR LEGAL REVIEW|Counsel and release appendix|Publication checklist/,
);
for (const phrase of [
  "perpetual, irrevocable, worldwide",
  "paying Host",
  "paid advertising",
  "without further approval, royalties or usage fees",
  "becomes effective only when the fixed Creator fee is released",
  "fully refunded before release, the perpetual licence does not arise",
  "whitelisting or Spark Ads",
  "materially false factual claim",
  "independent contractor",
])
  assert.ok(
    source.includes(phrase),
    `missing required agreement term: ${phrase}`,
  );
const digest = createHash("sha256")
  .update(content.creatorAgreementCanonicalText())
  .digest("hex");
assert.equal(content.CREATOR_AGREEMENT_SHA256, digest);
process.stdout.write(
  `PASS #4216 complete Creator agreement ${content.CREATOR_AGREEMENT_VERSION} · ${digest}\n`,
);
