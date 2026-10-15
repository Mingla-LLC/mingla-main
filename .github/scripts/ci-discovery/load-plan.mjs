import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");
export const BASELINE_PATH = path.join(HERE, "legacy-baseline.json");
export const BASELINE_SHA256 = "a706648509b0d0f2c8616eb73c3c5b8987f591c897abef483bd7b08cb2242106";
export const DESCRIPTOR_SUFFIX = ".ci-suite.json";
export const EXCLUSION_SUFFIX = ".ci-exclude.json";

const KNOWN_LANES = new Set([
  "migrations",
  "stripe-deno",
  "notification-deno",
  "deno2-discovered",
]);
export const LANE_PROFILES = Object.freeze({
  migrations: "psql-pg17-post-replay",
  "stripe-deno": "deno-1.46-stripe",
  "notification-deno": "deno-1.46-notification",
  "deno2-discovered": "deno-2-unit",
});

function fail(code, detail = "") {
  throw new Error(`ci-discovery:${code}${detail ? `:${detail}` : ""}`);
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const entries = fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

function patternRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function matches(pattern, candidate) {
  return pattern.includes("*") ? patternRegex(pattern).test(candidate) : pattern === candidate;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function concreteMigrationPath(root, value) {
  return typeof value === "string" &&
    /^supabase\/migrations\/[^/*?\[\]{}]+\.sql$/.test(value) &&
    !path.isAbsolute(value) && !value.includes("\\") &&
    !value.split("/").some((part) => !part || part === "." || part === "..") &&
    fs.existsSync(path.join(root, value));
}

export function readSealedBaseline({ baselinePath = BASELINE_PATH, expectedSha = BASELINE_SHA256 } = {}) {
  const raw = fs.readFileSync(baselinePath);
  const actual = sha256(raw);
  if (actual !== expectedSha) fail("baseline_seal_mismatch", `${actual}:expected=${expectedSha}`);
  const baseline = JSON.parse(raw.toString("utf8"));
  if (baseline?.schemaVersion !== 1 || baseline?.immutable !== true) fail("baseline_malformed");
  return baseline;
}

function candidateFiles(root, allFiles) {
  return {
    sql: allFiles.filter((file) => /^supabase\/migrations\/__tests__\/.*\.test\.sql$/.test(file)),
    deno: allFiles.filter((file) =>
      /^supabase\/.*\.test\.ts$/.test(file) ||
      /^packages\/.*\.test\.ts$/.test(file) ||
      /^mingla-business\/.*\.deno\.test\.ts$/.test(file)
    ),
  };
}

function readDescriptors(root, allFiles) {
  const descriptors = [];
  for (const descriptorPath of allFiles.filter((file) =>
    file.endsWith(DESCRIPTOR_SUFFIX) || file.endsWith(EXCLUSION_SUFFIX)
  )) {
    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(path.join(root, descriptorPath), "utf8"));
    } catch (error) {
      fail("malformed_declaration", `${descriptorPath}:${error.message}`);
    }
    if (!declaration || declaration.schemaVersion !== 1 || typeof declaration !== "object") {
      fail("malformed_declaration", descriptorPath);
    }
    descriptors.push({ descriptorPath, declaration });
  }
  return descriptors;
}

function validateLocalDeclaration({ root, descriptorPath, declaration, baseline, profiles }) {
  const kind = declaration.kind;
  if (kind !== "suite" && kind !== "exclude") fail("malformed_declaration", descriptorPath);
  const suitePath = declaration.path;
  if (typeof suitePath !== "string" || suitePath.includes("*") || path.isAbsolute(suitePath)) {
    fail("malformed_declaration", `${descriptorPath}:path`);
  }
  if (path.posix.dirname(descriptorPath) !== path.posix.dirname(suitePath)) {
    fail("declaration_not_local", `${descriptorPath}:${suitePath}`);
  }
  if (!fs.existsSync(path.join(root, suitePath))) fail("stale_local_path", `${descriptorPath}:${suitePath}`);
  const legacyRows = Object.values(baseline.lanes).flat();
  if (legacyRows.some((row) => matches(row.path, suitePath))) fail("legacy_shadow", suitePath);
  if (kind === "exclude") {
    if (typeof declaration.reason !== "string" || declaration.reason.trim().length < 12) {
      fail("malformed_exclusion_reason", descriptorPath);
    }
    return { kind, path: suitePath, descriptorPath };
  }
  if (!KNOWN_LANES.has(declaration.lane)) fail("unknown_lane", `${descriptorPath}:${declaration.lane}`);
  if (!Object.hasOwn(profiles, declaration.profile)) {
    fail("unknown_profile", `${descriptorPath}:${declaration.profile}`);
  }
  if (declaration.profile !== LANE_PROFILES[declaration.lane]) {
    fail("lane_profile_mismatch", `${descriptorPath}:${declaration.lane}:${declaration.profile}`);
  }
  if (typeof declaration.orderKey !== "string" || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(declaration.orderKey)) {
    fail("malformed_order_key", descriptorPath);
  }
  if (declaration.lane === "migrations") {
    const database = declaration.database;
    if (!exactKeys(database, ["database", "user", "reset"]) || database.user !== "postgres" ||
        database.database !== "postgres" || database.reset !== "isolated-per-suite") {
      fail("malformed_database_profile", descriptorPath);
    }
    if (!exactKeys(declaration.setup, ["migration"])) fail("malformed_sql_setup", descriptorPath);
    if (!concreteMigrationPath(root, declaration.setup.migration)) {
      fail("invalid_sql_setup_path", `${descriptorPath}:${declaration.setup.migration ?? "<missing>"}`);
    }
  } else if (Object.hasOwn(declaration, "setup") || Object.hasOwn(declaration, "database")) {
    fail("unsupported_deno_setup", descriptorPath);
  }
  return {
    kind,
    descriptorPath,
    row: {
      orderKey: declaration.orderKey,
      path: suitePath,
      profile: declaration.profile,
      ...(declaration.database ? { database: declaration.database } : {}),
      ...(declaration.setup ? { setup: declaration.setup } : {}),
      localDescriptor: descriptorPath,
    },
    lane: declaration.lane,
  };
}

function expandRows(root, rows) {
  const files = walk(root);
  const expanded = [];
  for (const row of rows) {
    const paths = row.path.includes("*")
      ? files.filter((file) => matches(row.path, file)).sort()
      : [row.path];
    if (paths.length === 0) fail("missing_declared_file", row.path);
    for (const suitePath of paths) {
      if (!fs.existsSync(path.join(root, suitePath))) fail("missing_declared_file", suitePath);
      expanded.push({ ...row, path: suitePath, ...(row.path.includes("*") ? { legacyPattern: row.path } : {}) });
    }
  }
  return expanded;
}

export function compilePlans({
  root = REPO_ROOT,
  baseline = null,
  baselinePath = BASELINE_PATH,
  expectedSha = BASELINE_SHA256,
} = {}) {
  const source = baseline ?? readSealedBaseline({ baselinePath, expectedSha });
  if (!source?.lanes || !source?.profiles || !source?.candidateSnapshot) fail("baseline_malformed");
  const allFiles = walk(root);
  const local = readDescriptors(root, allFiles).map(({ descriptorPath, declaration }) =>
    validateLocalDeclaration({ root, descriptorPath, declaration, baseline: source, profiles: source.profiles })
  );
  const exclusions = new Set(local.filter((item) => item.kind === "exclude").map((item) => item.path));
  const plans = Object.fromEntries([...KNOWN_LANES].map((lane) => [lane, [...(source.lanes[lane] ?? [])]]));
  for (const item of local.filter((entry) => entry.kind === "suite")) plans[item.lane].push(item.row);

  const seenPaths = new Map();
  for (const [lane, rows] of Object.entries(plans)) {
    const orderKeys = new Map();
    for (const row of rows) {
      if (!row || typeof row.path !== "string" || typeof row.orderKey !== "string" ||
          !Object.hasOwn(source.profiles, row.profile)) fail("malformed_declaration", `${lane}:row`);
      if (row.profile !== LANE_PROFILES[lane]) {
        fail("lane_profile_mismatch", `${lane}:${row.path}:${row.profile}`);
      }
      if (lane === "migrations" && !row.localDescriptor) {
        if (!exactKeys(row.database, ["database", "user", "reset"]) || row.database.database !== "postgres" ||
            !["postgres", "supabase_admin"].includes(row.database.user) || row.database.reset !== "suite-owned" ||
            Object.hasOwn(row, "setup")) fail("legacy_sql_contract_drift", row.path);
      }
      if (lane !== "migrations" && (Object.hasOwn(row, "database") || Object.hasOwn(row, "setup"))) {
        fail("unsupported_deno_setup", row.path);
      }
      if (orderKeys.has(row.orderKey)) fail("duplicate_order_key", `${lane}:${row.orderKey}`);
      orderKeys.set(row.orderKey, row.path);
      for (const prior of Object.values(plans).flat()) {
        if (prior === row) break;
      }
    }
    rows.sort((left, right) => left.orderKey.localeCompare(right.orderKey));
    const expanded = expandRows(root, rows);
    for (const row of expanded) {
      if (seenPaths.has(row.path)) fail("duplicate_path", `${row.path}:${seenPaths.get(row.path)}:${lane}`);
      seenPaths.set(row.path, lane);
    }
    plans[lane] = expanded;
  }

  const candidates = candidateFiles(root, allFiles);
  for (const [kind, paths] of Object.entries(candidates)) {
    const grandfathered = new Set(source.candidateSnapshot[kind] ?? []);
    for (const candidate of paths) {
      if (grandfathered.has(candidate) || seenPaths.has(candidate) || exclusions.has(candidate)) continue;
      fail("undeclared_candidate", candidate);
    }
  }
  return { baseline: source, plans, exclusions: [...exclusions].sort() };
}

export function listLane(lane, options = {}) {
  if (!KNOWN_LANES.has(lane)) fail("unknown_lane", lane);
  const compiled = compilePlans(options);
  return compiled.plans[lane];
}
