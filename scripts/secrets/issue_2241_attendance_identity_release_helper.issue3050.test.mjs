/**
 * #3050 regression proof for #2979's exact five-function attendance deploy.
 *
 * The production reconciliation helper must recognize every selected function,
 * pass the public-reader switches only to the two public endpoints, and reject
 * a remote identity reader whose gateway JWT posture is weakened.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  deploySelectedFunctions,
  ReconciliationError,
  verifyRemoteJwtPostures,
} from "./reconcile-governed-secrets.mjs";

const projectRef = "gqnoajqerqhnvulmnyvv";
const attendanceFunctions = [
  "attendance-claim-backfill",
  "attendance-claim-identity",
  "attendance-claim-link",
  "claim-attendance",
  "ticket-confirmation-dispatch",
];
const expectedJwtPosture = Object.freeze({
  "attendance-claim-backfill": false,
  "attendance-claim-identity": true,
  "attendance-claim-link": false,
  "claim-attendance": true,
  "ticket-confirmation-dispatch": true,
});

test("#3050 happy: the exact attendance release deploys with reviewed JWT postures", () => {
  const invocations = [];
  assert.equal(
    deploySelectedFunctions({
      projectRef,
      selectedFunctions: attendanceFunctions,
      spawn(command, args) {
        invocations.push({ command, args });
        return { status: 0, stdout: "", stderr: "" };
      },
    }),
    true,
  );

  assert.equal(invocations.length, attendanceFunctions.length);
  for (const [index, functionName] of attendanceFunctions.entries()) {
    const invocation = invocations[index];
    assert.equal(invocation.command, "supabase");
    assert.deepEqual(invocation.args.slice(0, 3), [
      "functions",
      "deploy",
      functionName,
    ]);
    assert.equal(
      invocation.args.includes("--no-verify-jwt"),
      expectedJwtPosture[functionName] === false,
    );
    assert.deepEqual(invocation.args.slice(3, 7), [
      "--project-ref",
      projectRef,
      "--use-api",
      ...(expectedJwtPosture[functionName] === false
        ? ["--no-verify-jwt"]
        : []),
    ]);
  }
});

test("#3050 adversarial: remote JWT readback fails if identity becomes public", () => {
  const metadata = attendanceFunctions.map((slug) => ({
    slug,
    verify_jwt: expectedJwtPosture[slug],
  }));
  const spawn = (records) => () => ({
    status: 0,
    stdout: JSON.stringify(records),
    stderr: "",
  });

  assert.equal(
    verifyRemoteJwtPostures({
      projectRef,
      selectedFunctions: attendanceFunctions,
      spawn: spawn(metadata),
    }),
    true,
  );

  const weakened = metadata.map((record) =>
    record.slug === "attendance-claim-identity"
      ? { ...record, verify_jwt: false }
      : record
  );
  assert.throws(
    () =>
      verifyRemoteJwtPostures({
        projectRef,
        selectedFunctions: attendanceFunctions,
        spawn: spawn(weakened),
      }),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "remote_jwt_posture_mismatch" &&
      error.publicNames.includes("attendance-claim-identity"),
  );
});
