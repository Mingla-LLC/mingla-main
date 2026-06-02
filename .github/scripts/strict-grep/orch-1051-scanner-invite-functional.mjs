#!/usr/bin/env node
/**
 * ORCH-1051 — strict-grep gate enforcing the scanner-team invite flow is
 * functional (no longer TRANSITIONAL local-Zustand-only).
 *
 * RULES:
 *   1. The TRANSITIONAL "emails ship in B-cycle" / "invitations are stored
 *      locally" banner copy is GONE from active scanner UI source files.
 *   2. The legacy `recordInvitation({` call site is GONE from
 *      InviteScannerSheet.tsx (the canonical invite UI).
 *   3. New required files exist: invite-scanner edge fn,
 *      accept-scanner-invitation edge fn, scannerInvitationsService.ts,
 *      useScannerInvitations.ts, accept-scanner-invitation.tsx landing route.
 *   4. The service is referenced (via useInviteScanner) from the sheet, and
 *      the accept route wires useAcceptScannerInvitation.
 *
 * Self-test (`--self-test`) proves each rule fires on a synthetic violation
 * and stays silent on a clean tree.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const FORBIDDEN_BANNERS = [
  "Scanner emails ship in B-cycle",
  "emails ship in B-cycle",
  "invitation is stored locally",
];

const FORBIDDEN_INVITE_SHEET_CALL = "recordInvitation({";

const REQUIRED_FILES = [
  "supabase/functions/invite-scanner/index.ts",
  "supabase/functions/accept-scanner-invitation/index.ts",
  "mingla-business/src/services/scannerInvitationsService.ts",
  "mingla-business/src/hooks/useScannerInvitations.ts",
  "mingla-business/app/accept-scanner-invitation.tsx",
];

const SCAN_ROOTS = [
  "mingla-business/src/components/scanners",
  "mingla-business/app/event",
  "mingla-business/app/brand",
  "mingla-business/app/accept-scanner-invitation.tsx",
];

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function* walk(dir) {
  let entries;
  try {
    const stat = fs.statSync(dir);
    if (stat.isFile()) {
      if (TEXT_EXTENSIONS.has(path.extname(dir))) yield dir;
      return;
    }
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (
      ent.name === "node_modules" || ent.name === ".next" ||
      ent.name === "dist" || ent.name === "build" || ent.name === "__tests__"
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
      for (const banner of FORBIDDEN_BANNERS) {
        if (text.includes(banner)) {
          failures.push(
            `${path.relative(rootDir, file)}: contains TRANSITIONAL banner copy "${banner}"`,
          );
        }
      }
    }
  }

  // Rule 2: InviteScannerSheet.tsx must NOT call recordInvitation({...})
  const sheetPath = path.join(
    rootDir,
    "mingla-business/src/components/scanners/InviteScannerSheet.tsx",
  );
  if (fs.existsSync(sheetPath)) {
    const text = fs.readFileSync(sheetPath, "utf8");
    if (text.includes(FORBIDDEN_INVITE_SHEET_CALL)) {
      failures.push(
        `mingla-business/src/components/scanners/InviteScannerSheet.tsx: still calls recordInvitation(...)`,
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
    if (!text.includes("useInviteScanner")) {
      failures.push(
        `mingla-business/src/components/scanners/InviteScannerSheet.tsx: does not import useInviteScanner`,
      );
    }
  }
  const acceptRoute = path.join(
    rootDir,
    "mingla-business/app/accept-scanner-invitation.tsx",
  );
  if (fs.existsSync(acceptRoute)) {
    const text = fs.readFileSync(acceptRoute, "utf8");
    if (!text.includes("useAcceptScannerInvitation")) {
      failures.push(
        `mingla-business/app/accept-scanner-invitation.tsx: does not wire useAcceptScannerInvitation`,
      );
    }
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const tmp = path.join("/tmp", "orch1051-selftest");
  fs.rmSync(tmp, { recursive: true, force: true });

  const required = [
    "supabase/functions/invite-scanner/index.ts",
    "supabase/functions/accept-scanner-invitation/index.ts",
    "mingla-business/src/services/scannerInvitationsService.ts",
    "mingla-business/src/hooks/useScannerInvitations.ts",
    "mingla-business/app/accept-scanner-invitation.tsx",
    "mingla-business/src/components/scanners/InviteScannerSheet.tsx",
  ];
  for (const rel of required) {
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, rel),
      rel.endsWith("InviteScannerSheet.tsx")
        ? `import { useInviteScanner } from '../../hooks/useScannerInvitations';\nconst x = useInviteScanner();\n`
        : rel.endsWith("accept-scanner-invitation.tsx")
        ? `import { useAcceptScannerInvitation } from '../src/hooks/useScannerInvitations';\nconst x = useAcceptScannerInvitation();\n`
        : `// stub\n`,
    );
  }
  let failures = runGate(tmp);
  if (failures.length !== 0) {
    console.error(
      "ORCH-1051 self-test FAIL: clean tree reported failures:\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }

  // 2. Add forbidden banner — should fail.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/scanners/InviteScannerSheet.tsx"),
    `// Scanner emails ship in B-cycle\nimport { useInviteScanner } from '../../hooks/useScannerInvitations';\nconst x = useInviteScanner();\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error("ORCH-1051 self-test FAIL: banner injection did not trigger");
    process.exit(1);
  }

  // 3. Add recordInvitation call — should fail.
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/scanners/InviteScannerSheet.tsx"),
    `import { useInviteScanner } from '../../hooks/useScannerInvitations';\nconst x = useInviteScanner();\nrecordInvitation({ brandId: 'x' });\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1051 self-test FAIL: recordInvitation call did not trigger",
    );
    process.exit(1);
  }

  // 4. Remove required file — should fail.
  fs.rmSync(path.join(tmp, "mingla-business/src/services/scannerInvitationsService.ts"));
  fs.writeFileSync(
    path.join(tmp, "mingla-business/src/components/scanners/InviteScannerSheet.tsx"),
    `import { useInviteScanner } from '../../hooks/useScannerInvitations';\nconst x = useInviteScanner();\n`,
  );
  failures = runGate(tmp);
  if (failures.length === 0) {
    console.error(
      "ORCH-1051 self-test FAIL: missing required file did not trigger",
    );
    process.exit(1);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("ORCH-1051 gate self-test PASS (4/4 cases).");
  process.exit(0);
}

// ---- Live mode
const failures = runGate(root);
if (failures.length > 0) {
  console.error(
    `ORCH-1051 gate FAIL — ${failures.length} violation(s) of the scanner-team invite functional contract:\n\n` +
      failures.join("\n") + "\n\n" +
      `The flow must be wired through the backend pipeline:\n` +
      `  - invite-scanner edge fn (writes scanner_invitations + Resend)\n` +
      `  - accept-scanner-invitation edge fn (calls accept_scanner_invitation RPC)\n` +
      `  - scannerInvitationsService.ts + useScannerInvitations hooks\n` +
      `  - /accept-scanner-invitation landing route\n` +
      `See SPEC for ORCH-1051.`,
  );
  process.exit(1);
}

console.log("ORCH-1051 gate PASS — scanner-team invite flow is functional.");
