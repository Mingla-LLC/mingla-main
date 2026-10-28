#!/usr/bin/env node

// MINGLA-INVARIANT: I-3682-NO-FAKE-FOLLOWER-COUNT | issue #3682 | User-visible follower totals must come from persisted relationship reads, never fixture or presentation defaults
// Followers on host surfaces must come from the follower-count hooks; BrandStats
// has no followers field. The gate fails closed on unreadable required inputs.
// [TEST-MOD-APPROVED #4037] BusinessPulsePanel now owns the Home follower zone.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const F = {
  home: "mingla-business/app/(tabs)/home.tsx",
  account: "mingla-business/app/(tabs)/account.tsx",
  switcher: "mingla-business/src/components/brand/BrandSwitcherSheet.tsx",
  publicBrand: "mingla-business/src/components/brand/PublicBrandPage.tsx",
  profileTile: "mingla-business/src/components/brand/FollowersKpiTile.tsx",
  homePulse: "mingla-business/src/components/home/BusinessPulsePanel.tsx",
  brandsService: "mingla-business/src/services/brandsService.ts",
  brandTypes: "mingla-business/src/types/brand.ts",
};

const SOURCE_EXT = /\.(?:js|jsx|ts|tsx)$/;
const TEST_PATH = /(?:^|\/)__tests__(?:\/|$)|\.test\./;

function read(root, relPath, violations) {
  try {
    return fs.readFileSync(path.join(root, relPath), "utf8");
  } catch (error) {
    violations.push(`${relPath}: could not read (${error.message})`);
    return "";
  }
}

function walk(root, relDir, violations) {
  const absolute = path.join(root, relDir);
  let entries;
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true });
  } catch (error) {
    violations.push(`${relDir}: could not inspect (${error.message})`);
    return [];
  }
  return entries.flatMap((entry) => {
    const relPath = path.join(relDir, entry.name);
    if (entry.isDirectory()) return walk(root, relPath, violations);
    return SOURCE_EXT.test(entry.name) && !TEST_PATH.test(relPath) ? [relPath] : [];
  });
}

function verify(root) {
  const violations = [];
  const source = Object.fromEntries(
    Object.entries(F).map(([key, relPath]) => [key, read(root, relPath, violations)]),
  );
  const requireText = (key, text, reason) => {
    if (!source[key].includes(text)) violations.push(`${F[key]}: missing ${reason}`);
  };
  const banText = (key, text, reason) => {
    if (source[key].includes(text)) violations.push(`${F[key]}: forbidden ${reason}`);
  };

  requireText("home", "<BusinessPulsePanel", "real Home Pulse follower surface");
  banText("home", "currentBrand.stats.followers", "fabricated Home followers");

  requireText("account", "Your brands", "Your brands list");
  requireText(
    "account",
    "formatBrandEventCount(brand.stats.events)",
    "server-derived event count",
  );
  requireText("account", "useBrandFollowerCounts(", "real Account follower hook");
  for (const token of ["brand.stats.followers", "brand.stats.rev", "brand.stats.attendees"]) {
    banText("account", token, `Account metric ${token}`);
  }

  requireText("switcher", "useBrandFollowerCounts(", "real switcher follower hook");
  banText("switcher", "brand.stats.events", "switcher event count");
  banText("switcher", "brand.stats.followers", "switcher fabricated follower count");

  requireText("profileTile", "useBrandFollowerSummary(", "profile summary hook");
  requireText("homePulse", "useBrandFollowerSummary(", "Home Pulse summary hook");
  requireText("brandsService", '.from("events")', "brand event-count read");

  for (const token of [
    "`@${brand.slug}`",
    "@${brand.slug}",
    "`@${",
    "brand.stats.followers",
    "brand.stats.attendees",
    "brand.stats.events",
  ]) {
    banText("publicBrand", token, `public brand identity/metric token ${token}`);
  }

  const productionFiles = [
    ...walk(root, "mingla-business/src", violations),
    ...walk(root, "mingla-business/app", violations),
  ];
  for (const relPath of productionFiles) {
    const text = read(root, relPath, violations);
    if (/stats\??\.followers/.test(text)) {
      violations.push(`${relPath}: stats.followers is forbidden`);
    }
    if (/stats\s*:\s*\{[^}]*\bfollowers\s*:/s.test(text)) {
      violations.push(`${relPath}: followers key in a stats literal is forbidden`);
    }
  }
  if (/interface\s+BrandStats\s*\{[^}]*\bfollowers\s*[?:]/s.test(source.brandTypes)) {
    violations.push(`${F.brandTypes}: BrandStats.followers is forbidden`);
  }

  return violations;
}

const violations = verify(REPO_ROOT);
if (violations.length > 0) {
  console.error(
    "ORCH-0768 violation: Followers on host surfaces must come from the follower-count hooks; BrandStats has no followers field.",
  );
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}
console.log("ORCH-0768 PASS: host follower counts are real and BrandStats stays honest.");
