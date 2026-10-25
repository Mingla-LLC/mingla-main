#!/usr/bin/env node
// MINGLA-INVARIANT: I-4063-CLAIMS | issue #4063 | Claim proofs have one authority, never depend on discovery visibility, and never let a claim link become an ownership proof.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATION_DIR = "supabase/migrations";
const CLAIM_CONTACT = "supabase/functions/claim-contact/index.ts";
const ISSUE_MIGRATION = /_issue_4063_/;

const PROOF_TOKEN_ALLOW = new Map([
  [
    "account_claim_contacts",
    new Set([
      "account_owns_contact",
      "claim_attendance_by_verified_identity",
      "issue_4063_contact_conflict",
      "issue_4063_record_claim_contact",
      "pg_my_claim_identifiers",
      "record_verified_phone",
    ]),
  ],
  [
    "verified_phone_identities",
    new Set([
      "account_owns_contact",
      "claim_attendance_by_verified_identity",
      "issue_4063_contact_conflict",
      "phone_identity_owners",
      "record_verified_phone",
    ]),
  ],
  [
    "auth.identities",
    new Set([
      "account_owns_contact",
      "issue_4063_contact_conflict",
    ]),
  ],
  [
    "email_verified",
    new Set([
      "account_owns_contact",
      "issue_4063_contact_conflict",
    ]),
  ],
  ["auth.mfa_amr_claims", new Set(["account_owns_contact"])],
]);

const OWNER_WRITE =
  /\bSET\s+(?:buyer_user_id|matched_user_id|consumer_user_id|holder_user_id|user_id)\s*=|\bNEW\.(?:buyer_user_id|matched_user_id|consumer_user_id|holder_user_id|user_id)\s*:=/i;
const CLAIM_DEFINITION = /(?:^|_)(?:claim|arm|issue_4063|mint|redeem)(?:_|$)/i;
const CLAIM_CONTACT_FORBIDDEN = [
  "profiles",
  "updateUserById",
  "record_verified_phone",
];
const VISIBILITY_REEMITTED = new Set([
  "claim_attendance_internal_v2",
  "issue_order_attendance_claim_proof_v2",
  "mint_attendance_claim_handoff",
]);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function extractFunctions(source, relative) {
  const functions = [];
  const pattern =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\([\s\S]*?\)\s*RETURNS[\s\S]*?\bAS\s+\$([a-zA-Z0-9_]*)\$([\s\S]*?)\$\2\$\s*;/gi;
  for (const match of source.matchAll(pattern)) {
    functions.push({ name: match[1], body: stripComments(match[3]), relative });
  }
  return functions;
}

function readTree(overrides = new Map()) {
  const migrationRoot = path.join(ROOT, MIGRATION_DIR);
  const migrationFiles = fs.readdirSync(migrationRoot)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => `${MIGRATION_DIR}/${name}`);
  const issueMigrationFiles = migrationFiles.filter((relative) =>
    ISSUE_MIGRATION.test(path.basename(relative))
  );
  const read = (relative) => {
    if (overrides.has(relative)) return overrides.get(relative);
    const absolute = path.join(ROOT, relative);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
  };
  return { issueMigrationFiles, migrationFiles, read };
}

function issueFunctions(tree) {
  const issueNames = new Set(VISIBILITY_REEMITTED);
  for (const relative of tree.issueMigrationFiles) {
    const source = tree.read(relative);
    if (source === null) continue;
    for (const fn of extractFunctions(source, relative)) {
      issueNames.add(fn.name);
    }
  }

  const latest = new Map();
  for (const relative of tree.migrationFiles) {
    const source = tree.read(relative);
    if (source === null) continue;
    for (const fn of extractFunctions(source, relative)) {
      if (issueNames.has(fn.name)) latest.set(fn.name, fn);
    }
  }
  return latest;
}

export function check(tree) {
  const violations = [];
  const functions = issueFunctions(tree);
  if (functions.size === 0) {
    violations.push(`${MIGRATION_DIR}: no #4063 function definitions found`);
    return violations;
  }

  const hasVisibilityReemit = [...VISIBILITY_REEMITTED].every((name) => {
    const fn = functions.get(name);
    return fn !== undefined &&
      fn.relative.endsWith("_issue_4063_claim_core.sql") &&
      !/\bvisibility\b/i.test(fn.body);
  });
  if (!hasVisibilityReemit) {
    violations.push(
      `${MIGRATION_DIR}: missing fail-closed visibility re-emission contract`,
    );
  }

  for (const fn of functions.values()) {
    const lower = fn.body.toLowerCase();
    for (const [token, allowed] of PROOF_TOKEN_ALLOW) {
      if (lower.includes(token.toLowerCase()) && !allowed.has(fn.name)) {
        violations.push(
          `${fn.relative}:${fn.name}: proof token ${token} is outside its authority`,
        );
      }
    }

    if (
      CLAIM_DEFINITION.test(fn.name) &&
      /\bvisibility\b/i.test(fn.body)
    ) {
      violations.push(
        `${fn.relative}:${fn.name}: claim behavior depends on visibility`,
      );
    }

    if (OWNER_WRITE.test(fn.body)) {
      const withoutAllowedRevoke = fn.body.replace(
        /\b(?:public\.)?issue_4063_revoke_claim_links\s*\(/gi,
        "allowed_revoke(",
      );
      if (/\bclaim_links\b/i.test(withoutAllowedRevoke)) {
        violations.push(
          `${fn.relative}:${fn.name}: owner writer reads or writes claim_links`,
        );
      }
    }
  }

  const revoker = functions.get("issue_4063_revoke_claim_links");
  if (revoker === undefined) {
    violations.push(`${MIGRATION_DIR}: missing issue_4063_revoke_claim_links`);
  } else if (OWNER_WRITE.test(revoker.body)) {
    violations.push(
      `${revoker.relative}:${revoker.name}: revoker writes an owner column`,
    );
  }

  const phoneRecorder = functions.get("record_verified_phone");
  const phoneRevokesExtras = phoneRecorder !== undefined && [
    /UPDATE\s+public\.account_claim_contacts/i,
    /SET\s+revoked_at\s*=\s*now\(\)/i,
    /channel\s*=\s*'phone'/i,
    /user_id\s*<>\s*p_user_id/i,
  ].every((pattern) => pattern.test(phoneRecorder.body));
  if (!phoneRevokesExtras) {
    violations.push(
      `${MIGRATION_DIR}: record_verified_phone must revoke another account's extra-phone proof`,
    );
  }

  const contactRaw = tree.read(CLAIM_CONTACT);
  if (contactRaw === null) {
    violations.push(`${CLAIM_CONTACT}: missing claim-contact handler`);
  } else {
    const contact = stripComments(contactRaw);
    for (const token of CLAIM_CONTACT_FORBIDDEN) {
      if (contact.includes(token)) {
        violations.push(`${CLAIM_CONTACT}: forbidden identity writer ${token}`);
      }
    }
  }
  return violations;
}

function mutateFunction(source, name, mutation) {
  const marker = new RegExp(
    `(CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\bBEGIN\\b)`,
    "i",
  );
  if (!marker.test(source)) {
    throw new Error(`self-test fixture missing ${name}`);
  }
  return source.replace(marker, `$1\n  ${mutation}`);
}

function runSelfTest() {
  const realTree = readTree();
  const control = check(realTree);
  if (control.length > 0) {
    throw new Error(`real-tree control failed: ${control.join("; ")}`);
  }

  const core = realTree.issueMigrationFiles.find((relative) =>
    relative.includes("_claim_core.sql")
  );
  const links = realTree.issueMigrationFiles.find((relative) =>
    relative.includes("_claim_links_and_contacts.sql")
  );
  const latestMintLink = [...realTree.migrationFiles].reverse().find(
    (relative) => {
      const source = realTree.read(relative);
      return source !== null && extractFunctions(source, relative).some(
        ({ name }) => name === "mint_claim_link",
      );
    },
  );
  if (core === undefined || links === undefined || latestMintLink === undefined) {
    throw new Error("self-test fixtures missing");
  }
  const coreSource = realTree.read(core);
  const linksSource = realTree.read(links);
  const latestMintLinkSource = realTree.read(latestMintLink);

  const cases = [
    [
      "proof arm escapes its authority",
      new Map([[
        latestMintLink,
        mutateFunction(
          latestMintLinkSource,
          "mint_claim_link",
          "PERFORM 1 FROM public.account_claim_contacts;",
        ),
      ]]),
    ],
    [
      "claim definition adds visibility",
      new Map([[
        latestMintLink,
        mutateFunction(
          latestMintLinkSource,
          "mint_claim_link",
          "PERFORM visibility FROM public.events LIMIT 1;",
        ),
      ]]),
    ],
    [
      "owner writer reads claim links",
      new Map([[
        core,
        mutateFunction(
          coreSource,
          "claim_attendance_by_verified_identity",
          "PERFORM 1 FROM public.claim_links;",
        ),
      ]]),
    ],
    [
      "revoker becomes an owner writer",
      new Map([[
        links,
        mutateFunction(
          linksSource,
          "issue_4063_revoke_claim_links",
          "UPDATE public.orders SET buyer_user_id = gen_random_uuid();",
        ),
      ]]),
    ],
    [
      "verified phone stops revoking extra proof",
      new Map([[
        core,
        coreSource.replace(
          "UPDATE public.account_claim_contacts",
          "UPDATE public.not_claim_contacts",
        ),
      ]]),
    ],
    [
      "static visibility re-emission disappears",
      new Map([[
        core,
        coreSource.replace(
          "CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof_v2",
          "CREATE OR REPLACE FUNCTION public.issue_order_attendance_claim_proof_v2_missing",
        ),
      ]]),
    ],
    [
      "claim-contact writes profile identity",
      new Map([[
        CLAIM_CONTACT,
        `${realTree.read(CLAIM_CONTACT)}\nconst forbidden = "updateUserById";`,
      ]]),
    ],
  ];
  for (const [label, overrides] of cases) {
    const violations = check(readTree(overrides));
    if (violations.length === 0) {
      throw new Error(`${label}: mutation was not detected`);
    }
  }

  const allowed = new Map([[
    core,
    mutateFunction(
      coreSource,
      "claim_attendance_by_verified_identity",
      "PERFORM public.issue_4063_revoke_claim_links('order', gen_random_uuid());",
    ),
  ]]);
  const allowedViolations = check(readTree(allowed));
  if (allowedViolations.length > 0) {
    throw new Error(
      `allowed revoke call was rejected: ${allowedViolations.join("; ")}`,
    );
  }
  console.log(
    `#4063 claims self-test PASS (${cases.length} rejecting mutations + allowed revoke)`,
  );
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const violations = check(readTree());
  if (violations.length > 0) {
    console.error("#4063 claims invariant failed:");
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log(
    `#4063 claims PASS (${issueFunctions(readTree()).size} latest definitions)`,
  );
}
