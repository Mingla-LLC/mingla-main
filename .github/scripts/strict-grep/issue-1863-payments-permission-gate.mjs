#!/usr/bin/env node
/**
 * #1863 [error-toast-covers-bank-field] — brand payments permission gate,
 * terminal 403s, and the balances twin.
 *
 * Guards the SHAPE of the fix so it cannot be undone silently:
 *   - the client predicate stays a ROLE-SET MEMBERSHIP test and never becomes a
 *     rank threshold (`event_manager` at 40 outranks `finance_manager` at 30
 *     and is still denied, so no `rank >= N` reproduces the table);
 *   - a permission denial stays TERMINAL, as a GLOBAL React Query default;
 *   - the balances TWIN keeps routing through the same classification;
 *   - both regression suites stay present, non-skipped, and wired.
 *
 * `readFiles()` uses readFileSync, so a missing file THROWS — that is the
 * empty-scan-fails property, and it is free.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PATHS = {
  authGate: "mingla-business/src/hooks/brandStripeStatusAuthGate.ts",
  statusHook: "mingla-business/src/hooks/useBrandStripeStatus.ts",
  balancesHook: "mingla-business/src/hooks/useBrandStripeBalances.ts",
  queryClient: "mingla-business/src/config/queryClient.ts",
  permissionGates: "mingla-business/src/utils/permissionGates.ts",
  predicate: "mingla-business/src/utils/brandPaymentsPermission.ts",
  serverAuth: "supabase/functions/_shared/stripeEdgeAuth.ts",
  routeIndex: "mingla-business/app/brand/[id]/payments/index.tsx",
  routeOnboard: "mingla-business/app/brand/[id]/payments/onboard.tsx",
  routeReports: "mingla-business/app/brand/[id]/payments/reports.tsx",
  statusService: "mingla-business/src/services/brandStripeService.ts",
  balancesService: "mingla-business/src/services/brandStripeBalancesService.ts",
  onboardView: "mingla-business/src/components/brand/BrandOnboardView.tsx",
  invariant: "docs/INVARIANT_REGISTRY.md",
  renderTest:
    "mingla-business/src/components/brand/__tests__/issue_1863_payments_permission_gate.render.test.tsx",
  adversarialTest:
    "mingla-business/src/config/__tests__/issue_1863_permission_denied_terminal.tester_adversarial.test.ts",
  renderWorkflow: ".github/workflows/issue-1486-dormant-render-suites.yml",
};

const MANAGER_ROLES = ["brand_owner", "brand_admin", "finance_manager"];

function need(source, token, label, failures) {
  if (!source.includes(token)) failures.push(`${label}: missing ${token}`);
}

function forbid(source, token, label, failures) {
  if (source.includes(token)) failures.push(`${label}: forbidden ${token}`);
}

function needMatch(source, pattern, label, failures) {
  if (!pattern.test(source)) failures.push(`${label}: no match for ${pattern}`);
}

/** Comments are never wiring — a commented-out step is not a workflow step. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function stripYamlComments(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

/** The body of `canManageBrandPayments`, so comments cannot trip the forbids. */
function predicateBody(source) {
  const start = source.indexOf("export function canManageBrandPayments(");
  if (start < 0) return null;
  const end = source.indexOf("\n}", start);
  if (end < 0) return null;
  return source.slice(start, end);
}

export function violations(files) {
  const failures = [];
  const authGate = files.authGate ?? "";
  const statusHook = files.statusHook ?? "";
  const balancesHook = files.balancesHook ?? "";
  const queryClient = files.queryClient ?? "";
  const permissionGates = files.permissionGates ?? "";
  const predicate = files.predicate ?? "";
  const serverAuth = files.serverAuth ?? "";
  const statusService = files.statusService ?? "";
  const balancesService = files.balancesService ?? "";
  const onboardView = files.onboardView ?? "";
  const invariant = files.invariant ?? "";
  const renderTest = files.renderTest ?? "";
  const adversarialTest = files.adversarialTest ?? "";

  // ── C-1 — the structural lock: a REQUIRED field, so omission is a tsc error.
  need(authGate, "canManagePayments: boolean;", "C-1 auth gate", failures);
  forbid(authGate, "canManagePayments?:", "C-1 auth gate", failures);
  need(authGate, "canManagePayments === true", "C-1 auth gate", failures);

  // ── C-2 — BOTH hooks evaluate the predicate and feed it into the gate.
  for (const [label, source] of [
    ["C-2 status hook", statusHook],
    ["C-2 balances hook", balancesHook],
  ]) {
    need(source, "useCanManageBrandPayments(", label, failures);
    const call = source.indexOf("shouldEnableBrandStripeStatusQuery({");
    const passed = call < 0 ? -1 : source.indexOf("canManagePayments", call);
    if (call < 0 || passed < 0) {
      failures.push(`${label}: canManagePayments is not passed into the auth gate`);
    }
  }

  // ── C-3 — the retry policy is a FUNCTION, global, with the exact budget.
  needMatch(
    queryClient,
    /retry:\s*\(failureCount,\s*error\)\s*=>/,
    "C-3 query client",
    failures,
  );
  need(queryClient, "isPermissionDeniedError(error)", "C-3 query client", failures);
  need(queryClient, "DEFAULT_QUERY_RETRY_COUNT = 2", "C-3 query client", failures);
  // `<`, never `<=`: query-core calls retry() with the PRE-INCREMENT 0-based
  // counter, so `<= 2` silently adds a fourth attempt to every query in the app.
  need(
    queryClient,
    "failureCount < DEFAULT_QUERY_RETRY_COUNT",
    "C-3 query client",
    failures,
  );
  forbid(queryClient, "retry: 2,", "C-3 query client", failures);

  // ── C-4 — the WRONG shape must never be added. A rank threshold cannot
  // express this predicate in either direction, and this is a money surface.
  forbid(permissionGates, "MANAGE_PAYMENTS", "C-4 permission gates", failures);

  // ── C-5 — the predicate is role-set membership; no threshold smuggled back in.
  for (const role of MANAGER_ROLES) {
    need(predicate, `"${role}"`, "C-5 predicate", failures);
  }
  need(predicate, "BRAND_PAYMENTS_MANAGER_ROLES", "C-5 predicate", failures);
  const body = predicateBody(predicate);
  if (body === null) {
    failures.push("C-5 predicate: canManageBrandPayments is missing");
  } else {
    for (const token of ["rank >=", ">= 50", ">= 30", "BRAND_ROLE_RANK."]) {
      forbid(body, token, "C-5 predicate body", failures);
    }
    need(body, ".includes(role)", "C-5 predicate body", failures);
    need(body, "accepted", "C-5 predicate body", failures);
  }

  // ── C-6 — parity with the REAL server file, checked literal by literal.
  for (const role of MANAGER_ROLES) {
    need(serverAuth, `"${role}"`, "C-6 server parity", failures);
  }
  need(serverAuth, "BRAND_PAYMENTS_ROLES", "C-6 server parity", failures);

  // ── C-7 — all three routes import AND render the gate.
  for (const [label, source] of [
    ["C-7 payments route", files.routeIndex ?? ""],
    ["C-7 onboard route", files.routeOnboard ?? ""],
    ["C-7 reports route", files.routeReports ?? ""],
  ]) {
    const stripped = stripComments(source);
    need(stripped, "BrandPaymentsPermissionGate", label, failures);
    needMatch(stripped, /<BrandPaymentsPermissionGate/, label, failures);
  }

  // ── C-8 — the TWIN routes through the shared classification, not a raw throw.
  forbid(balancesService, "if (error) throw error;", "C-8 balances twin", failures);
  need(balancesService, "unwrapFunctionError", "C-8 balances twin", failures);
  need(statusService, "export async function unwrapFunctionError", "C-8 balances twin", failures);

  // ── C-9 — the __DEV__ diagnostic: a handled 403 uses console.log (which
  // raises no LogBox notification) and the discriminator precedes the generic
  // console.error. console.warn is NOT a substitute — it raises a yellow box.
  need(statusService, "EdgeFunctionPermissionDeniedError", "C-9 diagnostic", failures);
  const diag = statusService.indexOf("function logEdgeFunctionDiagnostic(");
  const discriminator = diag < 0 ? -1 : statusService.indexOf("status === 403", diag);
  const permLog = diag < 0 ? -1 : statusService.indexOf("console.log(", diag);
  const genericError = diag < 0 ? -1 : statusService.indexOf("console.error(", diag);
  if (diag < 0 || discriminator < 0 || permLog < 0 || genericError < 0) {
    failures.push("C-9 diagnostic: the split 403/non-403 diagnostic is missing");
  } else if (!(discriminator < permLog && permLog < genericError)) {
    failures.push(
      "C-9 diagnostic: the 403 discriminator + console.log must precede the generic console.error",
    );
  }

  // ── C-10 — the dead ViewState is WIRED, and failed-network is no longer the
  // unconditional answer to statusQuery.isError.
  need(onboardView, "mapStripeStatusErrorToViewState(", "C-10 onboard view", failures);
  need(onboardView, 'setViewState("permission-denied")', "C-10 onboard view", failures);
  const isErrorBranch = onboardView.indexOf("if (statusQuery.isError) {");
  const denied = isErrorBranch < 0
    ? -1
    : onboardView.indexOf('setViewState("permission-denied")', isErrorBranch);
  const network = isErrorBranch < 0
    ? -1
    : onboardView.indexOf('setViewState("failed-network")', isErrorBranch);
  if (isErrorBranch < 0 || denied < 0 || network < 0) {
    failures.push("C-10 onboard view: the checking-status error branch is missing a case");
  } else if (!(denied < network)) {
    failures.push(
      "C-10 onboard view: permission-denied must be decided BEFORE falling back to failed-network",
    );
  }

  // ── C-11 — the invariant is registered.
  need(
    invariant,
    "I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY (DRAFT)",
    "C-11 invariant",
    failures,
  );

  // ── C-12 — a guard that can be deleted with its subject is not a guard.
  for (const [label, source, anchors] of [
    [
      "C-12 render suite",
      renderTest,
      [
        "PAYMENT_CONTROL_MATCHERS",
        "toHaveBeenCalledTimes(0)",
        "BRAND_PAYMENTS_DENIED_TITLE",
        "app/brand/[id]/payments/index",
      ],
    ],
    [
      "C-12 adversarial suite",
      adversarialTest,
      [
        "getDefaultOptions()",
        "fetchBrandStripeBalances",
        "mapStripeStatusErrorToViewState",
        "toHaveBeenCalledTimes(3)",
      ],
    ],
  ]) {
    if (source.trim().length === 0) {
      failures.push(`${label}: file is empty`);
      continue;
    }
    for (const anchor of anchors) need(source, anchor, label, failures);
    for (const skip of ["it.skip(", "describe.skip(", "xit(", "test.todo("]) {
      forbid(source, skip, label, failures);
    }
  }

  // ── C-13 — the render config is actually invoked by a workflow.
  const workflow = stripYamlComments(files.renderWorkflow ?? "");
  need(workflow, "jest.issue1863.render.cjs", "C-13 workflow wiring", failures);

  return failures;
}

function readFiles() {
  return Object.fromEntries(
    Object.entries(PATHS).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(ROOT, relative), "utf8"),
    ]),
  );
}

function selfTest() {
  const clean = readFiles();
  const baseline = violations(clean);
  if (baseline.length) throw new Error(`baseline invalid:\n${baseline.join("\n")}`);

  const mutations = [
    ["authGate", "canManagePayments: boolean;", "canManagePayments?: boolean;",
      "C-1 required field weakened to optional"],
    ["statusHook", "useCanManageBrandPayments(brandId)", "({ allowed: true })",
      "C-2 status hook stops evaluating the predicate"],
    ["balancesHook", "canManagePayments,\n    });", "});",
      "C-2 balances twin stops passing the conjunct"],
    ["queryClient", "failureCount < DEFAULT_QUERY_RETRY_COUNT",
      "failureCount <= DEFAULT_QUERY_RETRY_COUNT",
      "C-3 off-by-one adds a fourth attempt to every query"],
    ["queryClient", "isPermissionDeniedError(error)", "Boolean(undefined)",
      "C-3 403s become retryable again"],
    ["queryClient", "      retryDelay:", "      retry: 2,\n      retryDelay:",
      "C-3 the literal retry:2 returns"],
    ["permissionGates", "  EDIT_EVENT:", "  MANAGE_PAYMENTS: BRAND_ROLE_RANK.brand_admin,\n  EDIT_EVENT:",
      "C-4 the forbidden rank-threshold shape is added"],
    ["predicate", "(BRAND_PAYMENTS_MANAGER_ROLES as readonly string[]).includes(role)",
      "BRAND_ROLE_RANK.brand_admin >= 50",
      "C-5 the predicate is 'simplified' into a rank threshold"],
    ["serverAuth", '"finance_manager"', '"tax_manager"',
      "C-6 the client mirror drifts from the server role set"],
    ["routeIndex", "<BrandPaymentsPermissionGate", "<React.Fragment",
      "C-7 the payments route is unwrapped"],
    ["routeReports", "<BrandPaymentsPermissionGate", "<React.Fragment",
      "C-7 the reports route is unwrapped"],
    ["balancesService", "if (error) throw await unwrapFunctionError(",
      "if (error) throw error; if (false) await unwrapFunctionError(",
      "C-8 the twin goes back to throwing raw"],
    ["statusService", "    console.log(`[${functionName}] permission denied (expected)`,",
      "    console.error(`[${functionName}] permission denied (expected)`,",
      "C-9 a handled 403 raises a LogBox error again"],
    ["onboardView", 'setViewState("permission-denied");\n        setErrorMessage(null);',
      'setViewState("failed-network");\n        setErrorMessage(null);',
      "C-10 the dead ViewState is un-wired"],
    ["invariant", "I-PROPOSED-1863-CLIENT-PAYMENTS-PERMISSION-PARITY (DRAFT)",
      "I-PROPOSED-1863-REMOVED",
      "C-11 the invariant is deleted"],
    ["renderTest", "  it(\"0. the matcher", "  it.skip(\"0. the matcher",
      "C-12 the render suite is silently skipped"],
    ["adversarialTest", "toHaveBeenCalledTimes(3)", "toHaveBeenCalledTimes(9)",
      "C-12 the adversarial attempt-budget anchor is removed"],
    ["renderWorkflow", "npx jest --config jest.issue1863.render.cjs",
      "# npx jest --config jest.issue1863.render.cjs",
      "C-13 the render suite is commented out of the workflow"],
  ];

  for (const [key, before, after, label] of mutations) {
    if (!clean[key].includes(before)) {
      throw new Error(`self-test fixture missing: ${label} (anchor not found in ${key})`);
    }
    const broken = { ...clean, [key]: clean[key].replace(before, after) };
    if (violations(broken).length === 0) throw new Error(`mutation survived: ${label}`);
  }

  console.log(
    `#1863 payments permission gate self-test PASS (${mutations.length} true mutations)`,
  );
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = violations(readFiles());
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("#1863 payments permission gate PASS");
}
