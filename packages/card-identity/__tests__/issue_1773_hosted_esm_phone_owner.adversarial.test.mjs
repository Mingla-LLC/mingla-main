import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ownerPath = path.join(repositoryRoot, "packages/card-identity/phone.mjs");
const approvedLogicHash = "6c3a054d92c93e9bcebc001a188fa4c2eebe711dbc98c68d65d2006956c2ec35";

function sourceFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(absolute));
    else if (/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(entry.name)) found.push(absolute);
  }
  return found;
}

test("#1773 has one hosted-compatible phone implementation and no fallback path", async () => {
  assert.equal(fs.existsSync(path.join(repositoryRoot, "packages/card-identity/phone.js")), false);
  assert.equal(fs.existsSync(path.join(repositoryRoot, "packages/card-identity/phone.cjs")), false);

  const owner = fs.readFileSync(ownerPath, "utf8");
  const logicStart = owner.indexOf("'use strict';");
  const footerStart = owner.lastIndexOf("\nexport {");
  assert.ok(logicStart >= 0 && footerStart > logicStart, "logic/footer boundary is explicit");
  assert.equal(
    createHash("sha256").update(owner.slice(logicStart, footerStart)).digest("hex"),
    approvedLogicHash,
    "the approved plan and converter bodies drifted",
  );
  assert.doesNotMatch(owner, /module\.exports|createRequire|globalThis|export\s+default/);

  const phoneImplementationOwners = sourceFiles(repositoryRoot).filter((file) => {
    const relative = path.relative(repositoryRoot, file);
    if (relative === "packages/card-identity/phone.mjs") return true;
    const source = fs.readFileSync(file, "utf8");
    return /function\s+(?:dialablePhone|resolveUserPhoneE164)\s*\([^)]*\)\s*\{/.test(source) ||
      /const\s+PLANS\s*=\s*\{\s*\n\s*US:/.test(source);
  });
  assert.deepEqual(phoneImplementationOwners.map((file) => path.relative(repositoryRoot, file)), [
    "packages/card-identity/phone.mjs",
  ]);

  const consumerPaths = [
    "app-mobile/src/components/ExpandedCardModal.tsx",
    "app-mobile/src/components/expandedCard/ActionButtons.tsx",
    "app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx",
    "app-mobile/src/components/stay/ConsumerStayGuestExperience.tsx",
    "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    "mingla-business/src/components/event/useBusinessRsvpPhoneField.tsx",
    "mingla-business/src/components/stay/BuyerStayGuestExperience.tsx",
    "supabase/functions/brand-person-ingest-worker/index.ts",
  ];
  const phoneScoped = consumerPaths
    .map((file) => fs.readFileSync(path.join(repositoryRoot, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(phoneScoped, /phone\.(?:js|cjs)|card-identity\/phone["']/);
  assert.doesNotMatch(phoneScoped, /unstable[^\n]*cjs|createRequire|module\.exports|globalThis/i);

  const phone = await import("../phone.mjs");
  assert.deepEqual(Object.keys(phone).sort(), [
    "PHONE_PLANS",
    "dialablePhone",
    "resolveUserPhoneE164",
    "supportedDialCountries",
  ]);
  assert.equal(phone.resolveUserPhoneE164("0803 482 1689", "NG"), "+2348034821689");
});
