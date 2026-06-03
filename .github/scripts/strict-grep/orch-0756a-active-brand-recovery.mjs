#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relPath) => {
  const absPath = path.join(repoRoot, relPath);
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(`ORCH-0756A ERROR: could not read ${relPath}: ${error.message}`);
    process.exit(2);
  }
};

const checks = [];
const violations = [];

const expectIncludes = (relPath, source, signature, message) => {
  checks.push(message);
  if (!source.includes(signature)) {
    violations.push(`${relPath}: missing ${message}`);
  }
};

const expectNotIncludes = (relPath, source, signature, message) => {
  checks.push(message);
  if (source.includes(signature)) {
    violations.push(`${relPath}: forbidden ${message}`);
  }
};

const homePath = "mingla-business/app/(tabs)/home.tsx";
const home = read(homePath);
expectNotIncludes(
  homePath,
  home,
  "brands.length === 0 || currentBrand === null",
  "old false-empty condition",
);
// ORCH-1038: the four active-brand states moved out of home.tsx into the shared
// useBusinessTodos hook (derivations) + buildBusinessTodos (the create/select-brand
// to-do rows). The recovery invariant is preserved — now shared by Home AND Hub —
// just relocated. home.tsx must still RENDER the toggle that surfaces those rows.
expectIncludes(
  homePath,
  home,
  "<BusinessTodoToggle",
  "home renders the to-do toggle (surfaces the brand-recovery rows)",
);
const todosHookPath = "mingla-business/src/hooks/useBusinessTodos.ts";
const todosHook = read(todosHookPath);
const todosUtilPath = "mingla-business/src/utils/businessTodos.ts";
const todosUtil = read(todosUtilPath);
expectIncludes(todosHookPath, todosHook, "const hasNoBrands =", "true no-brands state");
expectIncludes(
  todosHookPath,
  todosHook,
  "const hasBrandsButNoSelection =",
  "brands-exist/no-selection state",
);
expectIncludes(
  todosHookPath,
  todosHook,
  "brandResolving: isBrandResolving",
  "resolving/loading state",
);
expectIncludes(todosUtilPath, todosUtil, '"Select a brand"', "brand-selection state");
expectIncludes(
  homePath,
  home,
  "onDefaultBrandSaveError={handleDefaultBrandSaveError}",
  "default-brand write failure toast wiring",
);

const creatorAccountHookPath = "mingla-business/src/hooks/useCreatorAccount.ts";
const creatorAccountHook = read(creatorAccountHookPath);
expectIncludes(
  creatorAccountHookPath,
  creatorAccountHook,
  "default_brand_id: string | null",
  "creator account default_brand_id type",
);
expectIncludes(
  creatorAccountHookPath,
  creatorAccountHook,
  "default_brand_id, deleted_at",
  "creator account default_brand_id select",
);
expectIncludes(
  creatorAccountHookPath,
  creatorAccountHook,
  "updateCreatorAccount(user.id, patch)",
  "creator account mutation delegates to verified service",
);

const creatorAccountServicePath = "mingla-business/src/services/creatorAccount.ts";
const creatorAccountService = read(creatorAccountServicePath);
expectIncludes(
  creatorAccountServicePath,
  creatorAccountService,
  "default_brand_id?: string | null",
  "creator account update patch accepts default_brand_id",
);
expectIncludes(
  creatorAccountServicePath,
  creatorAccountService,
  ".select(\"id\")",
  "creator account update verifies returned row",
);
expectIncludes(
  creatorAccountServicePath,
  creatorAccountService,
  "no creator account row updated",
  "creator account update throws on zero-row update",
);

const recoveryHookPath = "mingla-business/src/hooks/useCurrentBrandRecovery.ts";
const recoveryHook = read(recoveryHookPath);
expectIncludes(
  recoveryHookPath,
  recoveryHook,
  "resolveCurrentBrandId",
  "current brand resolver hook wiring",
);
expectIncludes(
  recoveryHookPath,
  recoveryHook,
  "Brand selected for now. Couldn't save it as your default.",
  "visible fallback persistence error",
);
expectIncludes(
  recoveryHookPath,
  recoveryHook,
  "appliedKeyRef",
  "loop prevention key",
);
expectIncludes(
  recoveryHookPath,
  recoveryHook,
  "setCreatorDefaultBrand",
  "fallback default persistence",
);

const layoutPath = "mingla-business/app/_layout.tsx";
const layout = read(layoutPath);
expectIncludes(
  layoutPath,
  layout,
  "useCurrentBrandRecovery()",
  "app-wide current brand recovery wiring",
);
expectNotIncludes(
  layoutPath,
  layout,
  "currentBrandId === null ||",
  "old null-brand splash ready shortcut",
);

const switcherPath = "mingla-business/src/components/brand/BrandSwitcherSheet.tsx";
const switcher = read(switcherPath);
expectIncludes(
  switcherPath,
  switcher,
  "default_brand_id: brand.id",
  "brand pick persists default brand",
);
expectIncludes(
  switcherPath,
  switcher,
  "default_brand_id: newBrand.id",
  "brand create persists default brand",
);
expectIncludes(
  switcherPath,
  switcher,
  "onDefaultBrandSaveError",
  "brand switcher surfaces default persistence failure",
);

const storePath = "mingla-business/src/store/currentBrandStore.ts";
const store = read(storePath);
const partializeMatch = store.match(/partialize:\s*\(state\)\s*=>\s*\(\{([\s\S]*?)\}\),/);
checks.push("currentBrandStore persisted shape remains ID-only");
if (partializeMatch === null) {
  violations.push(`${storePath}: could not inspect partialize block`);
} else {
  const partializeBody = partializeMatch[1];
  if (!partializeBody.includes("currentBrandId: state.currentBrandId")) {
    violations.push(`${storePath}: partialize does not persist currentBrandId`);
  }
  if (/\bcurrentBrand\s*:|\bbrands\s*:/.test(partializeBody)) {
    violations.push(
      `${storePath}: partialize must not persist currentBrand or brands`,
    );
  }
}

if (violations.length > 0) {
  console.error("ORCH-0756A active-brand recovery guard failed.");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(
  `ORCH-0756A PASS: active-brand recovery guard passed (${checks.length} checks).`,
);
