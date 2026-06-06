#!/usr/bin/env node
// ORCH-0786 — creator avatar upload integrity gate.
//
// Enforces SPEC §13.2 ten assertions for the "business profile avatar
// renders black after change" fix. Key shape: the picker MUST read bytes
// via expo-file-system (NEVER fetch(uri).blob()), MUST persist a canonical
// public URL (no ?t=… cache-buster), AND the avatar <Image> MUST have an
// onError handler that flips to the initials fallback.
//
// Pattern after orch-0784-event-list-sales-summary-visibility.mjs.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const exists = (relativePath) =>
  fs.existsSync(path.join(root, relativePath));

const failures = [];

const assertIncludes = (file, needle, message) => {
  if (!read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertNotIncludes = (file, needle, message) => {
  if (read(file).includes(needle)) failures.push(`${file}: ${message}`);
};

const assertRegexAbsent = (file, regex, message) => {
  if (regex.test(read(file))) failures.push(`${file}: ${message}`);
};

const assertRegexPresent = (file, regex, message) => {
  if (!regex.test(read(file))) failures.push(`${file}: ${message}`);
};

// 1. Component: banned read-path
assertNotIncludes(
  "mingla-business/app/account/edit-profile.tsx",
  "fetch(asset.uri)",
  "edit-profile.tsx must not call fetch(asset.uri) (zero-byte upload bug)",
);
assertRegexAbsent(
  "mingla-business/app/account/edit-profile.tsx",
  /await\s+fetch\([^)]*asset\.uri[^)]*\)/,
  "edit-profile.tsx must not await fetch on a picker asset uri",
);

// 2. Component + shared services: banned generic broken-pattern signature
for (const file of [
  "mingla-business/app/account/edit-profile.tsx",
  "mingla-business/src/services/creatorAvatarService.ts",
  "mingla-business/src/services/creatorAvatarFileReader.ts",
  "mingla-business/src/services/creatorAvatarFileReader.native.ts",
  "mingla-business/src/utils/creatorAvatarRules.ts",
]) {
  assertRegexAbsent(
    file,
    /await\s+\(?\s*await\s+fetch\([^)]+\)\)?\.blob\(\s*\)/,
    "must not use the await (await fetch(uri)).blob() upload pattern",
  );
  assertNotIncludes(
    file,
    "response.blob()",
    "must not use response.blob() on picker assets",
  );
}

// 3. Required reader
const readerPath = "mingla-business/src/services/creatorAvatarFileReader.native.ts";
const webReaderPath = "mingla-business/src/services/creatorAvatarFileReader.ts";
if (!exists(readerPath)) {
  failures.push(`${readerPath}: required native file reader is missing`);
} else {
  assertIncludes(
    readerPath,
    'from "expo-file-system"',
    "native reader must import from expo-file-system",
  );
  assertIncludes(
    readerPath,
    "readCreatorAvatarFileBytes",
    "native reader must export readCreatorAvatarFileBytes",
  );
}
if (!exists(webReaderPath)) {
  failures.push(`${webReaderPath}: required web file reader is missing`);
} else {
  assertIncludes(
    webReaderPath,
    "readCreatorAvatarFileBytes",
    "web reader must export readCreatorAvatarFileBytes",
  );
  assertRegexAbsent(
    webReaderPath,
    /from\s+["']expo-file-system["']/,
    "web reader must not import expo-file-system into the web bundle",
  );
}

// 4. Required service
const servicePath = "mingla-business/src/services/creatorAvatarService.ts";
if (!exists(servicePath)) {
  failures.push(`${servicePath}: required file is missing`);
} else {
  assertIncludes(
    servicePath,
    "readCreatorAvatarFileBytes",
    "service must import the bytes reader",
  );
  assertIncludes(
    servicePath,
    "uploadCreatorAvatar",
    "service must export uploadCreatorAvatar",
  );
}

// 5. Required rules helper
const rulesPath = "mingla-business/src/utils/creatorAvatarRules.ts";
if (!exists(rulesPath)) {
  failures.push(`${rulesPath}: required file is missing`);
} else {
  for (const symbol of [
    "verifyCreatorAvatarPublicUrl",
    "resolveCreatorAvatarContentType",
    "CreatorAvatarError",
    "CREATOR_AVATAR_MAX_BYTES",
  ]) {
    assertIncludes(rulesPath, symbol, `rules must export ${symbol}`);
  }
}

// 6. Avatar <Image> must have onError
assertIncludes(
  "mingla-business/app/account/edit-profile.tsx",
  "onError={",
  "edit-profile.tsx avatar <Image> must have an onError handler (initials fallback)",
);
assertIncludes(
  "mingla-business/app/account/edit-profile.tsx",
  "setAvatarLoadFailed(true)",
  "edit-profile.tsx onError must set avatarLoadFailed",
);

// 7. No persisted cache-bust in avatar_url
assertRegexAbsent(
  "mingla-business/app/account/edit-profile.tsx",
  /setPhotoUri\(`[^`]*\?t=\$\{/,
  "edit-profile.tsx must not setPhotoUri with a ?t= cache-bust suffix (cache-bust is render-only)",
);
assertRegexAbsent(
  "mingla-business/app/account/edit-profile.tsx",
  /avatar_url:\s*`[^`]*\?t=/,
  "edit-profile.tsx must not pass a ?t=-suffixed avatar_url to updateAccount",
);

// 8. Migration present
const migrationDir = "supabase/migrations";
const migrationPattern = /^\d{14}_orch_0786_creator_avatars_bucket\.sql$/;
const migrationFile = fs
  .readdirSync(path.join(root, migrationDir))
  .find((name) => migrationPattern.test(name));
if (migrationFile === undefined) {
  failures.push(
    `${migrationDir}: missing ORCH-0786 creator_avatars bucket migration (expected <14-digits>_orch_0786_creator_avatars_bucket.sql)`,
  );
} else {
  const migration = read(`${migrationDir}/${migrationFile}`);
  for (const needle of [
    "creator_avatars",
    "auth.uid()::text",
    "ON CONFLICT (id) DO UPDATE",
    "DROP POLICY IF EXISTS",
  ]) {
    if (!migration.includes(needle)) {
      failures.push(
        `${migrationDir}/${migrationFile}: must contain ${JSON.stringify(needle)}`,
      );
    }
  }
  // 9. Migration MIME shape — strict single-quoted allowlist, no image/jpg alias
  if (!migration.includes("ARRAY['image/jpeg','image/png','image/webp']")) {
    failures.push(
      `${migrationDir}/${migrationFile}: allowed_mime_types must be ARRAY['image/jpeg','image/png','image/webp']`,
    );
  }
  if (/image\/jpg(?!eg)/.test(migration)) {
    failures.push(
      `${migrationDir}/${migrationFile}: must not whitelist image/jpg (non-IANA alias)`,
    );
  }
}

// 10. package.json script wired
const packageJson = JSON.parse(read("mingla-business/package.json"));
const testScript = packageJson.scripts?.["test:orch-0786"] ?? "";
const requiredScriptFragments = [
  "orch-0786-creator-avatar-upload-integrity.mjs",
  "creatorAvatarService.test",
  "creatorAvatarRules.test",
  "creatorAvatarFileReader.test",
  "edit-profile.avatar.test",
];
for (const fragment of requiredScriptFragments) {
  if (!testScript.includes(fragment)) {
    failures.push(
      `mingla-business/package.json: test:orch-0786 must reference ${fragment}`,
    );
  }
}

// Workflow registration
const workflow = read(".github/workflows/strict-grep-mingla-business.yml");
if (!workflow.includes("orch-0786-creator-avatar-upload-integrity")) {
  failures.push(
    ".github/workflows/strict-grep-mingla-business.yml: missing ORCH-0786 strict-grep job",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0786 creator avatar upload integrity guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-0786 creator avatar upload integrity guard passed.");
