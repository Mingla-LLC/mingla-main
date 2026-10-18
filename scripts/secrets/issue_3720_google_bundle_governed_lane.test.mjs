// [TEST-MOD-APPROVED #3720] Completion Wave 6 extends the existing governed
// Google Drive object with the private Data room folder authority.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadEffectiveFunctionPolicy } from "../../.github/scripts/ci-discovery/function-policy.mjs";
import { runGovernedBundleDeployment } from "./reconcile-governed-secrets.mjs";
import {
  applyPreparedGovernedBundle,
  BundleSetterError,
  loadManifest,
  prepareGovernedBundle,
  serializeGoogleCredentialBundle,
} from "./set-governed-secret-bundle.mjs";

const PROJECT_REF = "gqnoajqerqhnvulmnyvv";
const MERGED_COMMIT = "a".repeat(40);
const GOOGLE_FIELDS = [
  "calendar_client_id",
  "calendar_client_secret",
  "calendar_refresh_token",
  "drive_storage.client_email",
  "drive_storage.data_room_folder_id",
  "drive_storage.host_details_folder_id",
  "drive_storage.private_key",
  "drive_storage.shared_drive_id",
];
const EXISTING_CALENDAR_FIELDS = GOOGLE_FIELDS.slice(0, 3);

function googleInput() {
  const privateKey = [
    ["-----BEGIN", "PRIVATE KEY-----"].join(" "),
    "fixture-key-material",
    ["-----END", "PRIVATE KEY-----"].join(" "),
  ].join("\n");
  const attestations = Object.fromEntries(
    GOOGLE_FIELDS.map((field) => [
      field,
      {
        owner: "Integrations Engineering",
        source_type: "provider_dashboard_and_secure_vault",
      },
    ]),
  );
  return {
    bundleName: "GOOGLE_CALENDAR_KEYS",
    bundleObject: {
      calendar_client_id: "fixture-calendar-client",
      calendar_client_secret: "fixture-calendar-secret",
      calendar_refresh_token: "fixture-calendar-refresh",
      drive_storage: {
        client_email: "fixture-drive@example.invalid",
        data_room_folder_id: "fixture-data-room-folder",
        host_details_folder_id: "fixture-host-details-folder",
        private_key: privateKey,
        shared_drive_id: "fixture-shared-drive",
      },
    },
    authoritativeExistingFieldNames: EXISTING_CALENDAR_FIELDS,
    attestations,
  };
}

test("#3720 Google bundle is governed for every reader and has a sanctioned input flag", () => {
  const policy = loadEffectiveFunctionPolicy();
  assert.deepEqual(
    policy.contract.functions["brand-group-files"].required_bundle_fields,
    {
      GOOGLE_CALENDAR_KEYS: GOOGLE_FIELDS.filter(
        (field) =>
          field.startsWith("drive_storage.") &&
          field !== "drive_storage.data_room_folder_id",
      ),
    },
  );
  assert.deepEqual(
    policy.contract.functions["admin-data-room"].required_bundle_fields,
    {
      GOOGLE_CALENDAR_KEYS: GOOGLE_FIELDS.filter((field) =>
        field.startsWith("drive_storage."),
      ),
    },
  );
  assert.deepEqual(
    policy.contract.functions["growth-tools-book"].required_bundle_fields,
    { GOOGLE_CALENDAR_KEYS: EXISTING_CALENDAR_FIELDS },
  );
  assert.equal(
    policy.contract.functions["brand-group-files"].required_top_level.includes(
      "GOOGLE_CALENDAR_KEYS",
    ),
    false,
  );
  assert.equal(
    policy.contract.functions["growth-tools-book"].required_top_level.includes(
      "GOOGLE_CALENDAR_KEYS",
    ),
    false,
  );

  const deploy = readFileSync(
    new URL("../deploy-supabase-functions.sh", import.meta.url),
    "utf8",
  );
  const coordinator = readFileSync(
    new URL("./reconcile-governed-secrets.mjs", import.meta.url),
    "utf8",
  );
  assert.match(deploy, /--google-input/);
  assert.match(coordinator, /value === "--google-input"/);
});

test("#3720 Google bundle setter preserves Calendar and emits the four-part runtime format", () => {
  const manifest = loadManifest();
  const prepared = prepareGovernedBundle({ ...googleInput(), manifest });
  assert.deepEqual(prepared.fieldNames, GOOGLE_FIELDS);
  assert.deepEqual(
    prepared.fieldNames,
    manifest.secrets
      .find((record) => record.name === "GOOGLE_CALENDAR_KEYS")
      .bundle_fields.map((field) => field.name)
      .sort(),
  );
  const serialized = serializeGoogleCredentialBundle(prepared.bundleObject);
  const parts = serialized.split("|");
  assert.deepEqual(parts.slice(0, 3), [
    "fixture-calendar-client",
    "fixture-calendar-secret",
    "fixture-calendar-refresh",
  ]);
  assert.equal(parts.length, 4);
  const drive = JSON.parse(Buffer.from(parts[3], "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(drive), [
    "client_email",
    "private_key",
    "shared_drive_id",
    "host_details_folder_id",
    "data_room_folder_id",
  ]);
  assert.equal(drive.shared_drive_id, "fixture-shared-drive");
  assert.equal(drive.data_room_folder_id, "fixture-data-room-folder");
});

test("#3720 Google bundle refuses missing Calendar preservation or malformed Drive authority", () => {
  const manifest = loadManifest();
  const missingPreservation = googleInput();
  missingPreservation.authoritativeExistingFieldNames = [
    "calendar_client_id",
    "calendar_client_secret",
  ];
  assert.throws(
    () => prepareGovernedBundle({ ...missingPreservation, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "preservation_attestation_incomplete",
  );

  const malformedDrive = googleInput();
  malformedDrive.bundleObject.drive_storage.shared_drive_id = "short";
  assert.throws(
    () => prepareGovernedBundle({ ...malformedDrive, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "google_bundle_strict_parser_invalid",
  );

  const missingDataRoom = googleInput();
  delete missingDataRoom.bundleObject.drive_storage.data_room_folder_id;
  assert.throws(
    () => prepareGovernedBundle({ ...missingDataRoom, manifest }),
    (error) =>
      error instanceof BundleSetterError &&
      error.code === "google_bundle_shape_invalid",
  );
});

test("#3720 Google bundle apply sends one value through stdin and returns names only", () => {
  const manifest = loadManifest();
  const prepared = prepareGovernedBundle({ ...googleInput(), manifest });
  let invocation;
  const result = applyPreparedGovernedBundle({
    prepared,
    projectRef: PROJECT_REF,
    liveNames: ["GOOGLE_CALENDAR_KEYS"],
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(invocation.command, "supabase");
  assert.deepEqual(invocation.args, [
    "secrets",
    "set",
    "--project-ref",
    PROJECT_REF,
    "--env-file",
    "/dev/stdin",
  ]);
  assert.match(invocation.options.input, /^GOOGLE_CALENDAR_KEYS="/);
  assert.equal(invocation.args.join(" ").includes("fixture-calendar"), false);
  assert.deepEqual(Object.keys(result).sort(), [
    "bundleName",
    "fieldNames",
    "parserPass",
    "preservationPass",
    "schemaVersion",
    "sourceOwnerAttestationPass",
  ]);
});

test("#3720 same-process governed lane applies, receipts, deploys and verifies every reader", () => {
  const manifest = loadManifest();
  const liveNames = manifest.secrets.map((record) => record.name);
  const calls = [];
  const result = runGovernedBundleDeployment({
    projectRef: PROJECT_REF,
    mergedCommit: MERGED_COMMIT,
    selectedFunctions: [
      "admin-data-room",
      "brand-group-files",
      "growth-tools-book",
    ],
    bundleInputs: { GOOGLE_CALENDAR_KEYS: googleInput() },
    dependencies: {
      audit: () => [],
      gitState: () => ({
        clean: true,
        committedAtMs: Date.now(),
        head: MERGED_COMMIT,
        remoteMain: MERGED_COMMIT,
      }),
      listLiveNames: () => liveNames,
      applyBundle({ prepared }) {
        calls.push(`apply:${prepared.bundleName}`);
        return {
          bundleName: prepared.bundleName,
          fieldNames: prepared.fieldNames,
          parserPass: prepared.parserPass,
          preservationPass: prepared.preservationPass,
          schemaVersion: prepared.schemaVersion,
          sourceOwnerAttestationPass: prepared.sourceOwnerAttestationPass,
        };
      },
      deploy: () => calls.push("deploy"),
      verifyDeployed: () => calls.push("verify-source"),
      verifyRemoteJwt: () => calls.push("verify-jwt"),
    },
  });
  assert.deepEqual(calls, [
    "apply:GOOGLE_CALENDAR_KEYS",
    "deploy",
    "verify-source",
    "verify-jwt",
  ]);
  assert.deepEqual(result.applied_bundles, ["GOOGLE_CALENDAR_KEYS"]);
  assert.deepEqual(result.deployed_functions, [
    "admin-data-room",
    "brand-group-files",
    "growth-tools-book",
  ]);
  assert.equal(result.preflight_passed, true);
});
