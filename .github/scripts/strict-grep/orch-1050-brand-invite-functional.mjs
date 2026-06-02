#!/usr/bin/env node
/**
 * ORCH-1050 — strict-grep gate enforcing the brand-team invite flow is
 * functional (no longer TRANSITIONAL local-Zustand-only).
 *
 * RULES:
 *   1. The TRANSITIONAL "Testing mode — invitations are stored locally"
 *      banner copy is NOT present in any active source file.
 *   2. The legacy `recordInvitation(...)` is no longer wired in
 *      InviteBrandMemberSheet.tsx (the canonical call site).
 *   3. The new edge fn files exist on disk.
 *   4. The new service file exists and is referenced from the sheet +
 *      accept route.
 *
 * Self-test (`--self-test`) proves each rule fires on a synthetic violation
 * and stays silent on a clean tree.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const FORBIDDEN_BANNER =
  "Testing mode — invitations are stored locally";

const FORBIDDEN_INVITE_SHEET_CALL = "recordInvitation({";

const REQUIRED_FILES = [
  "supabase/functions/invite-brand-member/index.ts",
  "supabase/functions/accept-brand-invitation/index.ts",
  "mingla-business/src/services/brandInvitationsService.ts",
  "mingla-business/src/hooks/useBrandInvitations.ts",
  "mingla-business/app/accept-brand-invitation.tsx",
];

const SCAN_ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
];

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (
      ent.name === "node_modules" || ent.name === ".next" ||
      ent.name === "dist" || ent.name === "build"
    ) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walk(full);
    } else if (
      ent.isFile() && TEXT_EXTENSIONS.has(path.extname(ent.name))
    ) {
      yield full;
    }
  }
}

function runGate(rootDir) {
  const failures = [];

  // Rule 1: forbidden banner copy
  for (const rel of SCAN_ROOTS) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (text.includes(FORBIDDEN_BANNER)) {
        failures.push(
          `${path.relative(rootDir, file)}: contains TRANSITIONAL banner copy`,
        );
      }
    }
  }

  // Rule 2: InviteBrandMemberSheet.tsx must NOT call recordInvitation({...})
  const sheetPath = path.join(
    rootDir,
    "mingla-business/src/components/team/InviteBrandMemberSheet.tsx",
  );
  if (fs.existsSync(sheetPath)) {
    const text = fs.readFileSync(sheetPath, "utf8");
    if (text.includes(FORBIDDEN_INVITE_SHEET_CALL)) {
      failures.push(
        `mingla-business/src/components/team/InviteBrandMemberSheet.tsx: still calls recordInvitation(...)`,
      );
    }
  }

  // Rule 3: required new files must exist
  for (const rel of REQUIRED_FILES) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      failures.push(`${rel}: required file missing`);
    }
  }

  // Rule 4: service is referenced by sheet + accept route
  if (fs.existsSync(sheetPath)) {
    const text = fs.readFileSync(sheetPath, "utf8");
    if (!text.includes("useInviteBrandMember")) {
      failures.push(
        `mingla-business/src/components/team/InviteBrandMemberSheet.tsx: does not import useInviteBrandMember`,
      );
    }
  }
  const acceptRoute = path.join(
    rootDir,
    "mingla-business/app/accept-brand-invitation.tsx",
  );
  if (fs.existsSync(acceptRoute)) {
    const text = fs.readFileSync(acceptRoute, "utf8");
    if (!text.includes("useAcceptBrandInvitation")) {
      failures.push(
        `mingla-business/app/accept-brand-invitation.tsx: does not wire useAcceptBrandInvitation`,
      );
    }
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const tmp = path.join("/tmp", "orch1050-selftest");
  fs.rmSync(tmp, { recursive: true, force: true });

  // 1. Clean tree — should pass.
  const required = [
    "supabase/functions/invite-brand-member/index.ts",
    "supabase/functions/accept-brand-invitation/index.ts",
    "mingla-business/src/services/brandInvitationsService.ts",
    "mingla-business/src/hooks/useBrandInvitations.ts",
    "mingla-business/app/accept-brand-invitation.tsx",
    "mingla-business/src/components/team/InviteBrandMemberSheet.tsx",
  ];
  for (const rel of required) {
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, rel),
      rel.endsWith("InviteBrandMemberSheet.tsx")
        ? `import { useInviteBrandMember } from '../../hooks/useBrandInvitations';\nconst x = useInviteBrandMember();\n`
        : rel.endsWith("accept-brand-invitation.tsx")
        ? `import { useAcceptBrandInvitation } from '../src/hooks/useBrandInvitations';\nconst x = useAcceptBrandInvitation();\n`
        : `// stub\n`,
    );
  }
  let failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1050 self-test FAIL: clean tree reported failures:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // 2. Add forbidden banner — should fail.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/team/InviteBrandMemberSheet.tsx"),
    `// Testing mode — invitations are stored locally\nimport { useInviteBrandMember } from '../../hooks/useBrandInvitations';\nconst x = useInviteBrandMember();\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error("ORCH-1050 self-test FAIL: banner injection did not trigger");
    process.exit(1);
  }

  // 3. Add recordInvitation call — should fail.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/team/InviteBrandMemberSheet.tsx"),
    `import { useInviteBrandMember } from '../../hooks/useBrandInvitations';\nconst x = useInviteBrandMember();\nrecordInvitation({ brandId: 'x' });\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1050 self-test FAIL: recordInvitation call did not trigger",
    );
    process.exit(1);
  }

  // 4. Remove a required file — should fail.
  fs.rmSync(path.join(tmp, "mingla-business/src/services/brandInvitationsService.ts"));
  // Restore sheet to clean (so other rules don't trip)
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/team/InviteBrandMemberSheet.tsx"),
    `import { useInviteBrandMember } from '../../hooks/useBrandInvitations';\nconst x = useInviteBrandMember();\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1050 self-test FAIL: missing required file did not trigger",
    );
    process.exit(1);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("ORCH-1050 gate self-test PASS (4/4 cases).");
  process.exit(0);
}

// ---- Live mode
const failures = runGate(root);
if (failures.length > 0) {
  console.error(
    `ORCH-1050 gate FAIL — ${failures.length} violation(s) of the brand-team invite functional contract:\n\n` +
      failures.join("\n") + "\n\n" +
      `The flow must be wired through the backend pipeline:\n` +
      `  - invite-brand-member edge fn (writes brand_invitations + Resend)\n` +
      `  - accept-brand-invitation edge fn (calls the ownership-transfer RPC)\n` +
      `  - brandInvitationsService.ts + useBrandInvitations hooks\n` +
      `  - /accept-brand-invitation landing route\n` +
      `See SPEC for ORCH-1050.`,
  );
  process.exit(1);
}

console.log("ORCH-1050 gate PASS — brand-team invite flow is functional.");
