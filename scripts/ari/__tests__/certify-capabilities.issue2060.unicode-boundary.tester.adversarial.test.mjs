import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalCertificationDigest,
  canonicalCertificationTuple,
  inspectNativeArtifactManifest,
} from "../certify-capabilities.mjs";

const KIND = "unicode-🧪";
const VALUES = [
  "é",
  "e\u0301",
  "🙂",
  "line\nbreak",
  "tab\tbyte",
  "a:b|c",
  null,
  "",
];
const PG17_KNOWN_ANSWER =
  "66c54dfc26d80f3404087af0311329800b786ce6fc659a98839998b536f4b182";

test("#2060 tester: UTF-8 byte lengths are portable and bind every tuple field", () => {
  const tuple = canonicalCertificationTuple(KIND, VALUES);
  const digest = canonicalCertificationDigest(KIND, VALUES);

  assert.equal(digest, PG17_KNOWN_ANSWER);
  assert.equal(tuple.subarray(0, 40).toString("utf8").includes("12:unicode-🧪"), true);
  assert.equal(tuple.includes(Buffer.from("2:é", "utf8")), true);
  assert.equal(tuple.includes(Buffer.from("3:e\u0301", "utf8")), true);
  assert.equal(tuple.includes(Buffer.from("4:🙂", "utf8")), true);
  assert.notEqual(
    canonicalCertificationDigest(`${KIND}-changed`, VALUES),
    digest,
    "kind is a bound field",
  );

  for (const index of VALUES.keys()) {
    const changed = [...VALUES];
    changed[index] = VALUES[index] === null ? "not-null" : `${VALUES[index]}Δ`;
    assert.notEqual(
      canonicalCertificationDigest(KIND, changed),
      digest,
      `tuple value ${index} is bound`,
    );
  }
});

test("#2060 tester: web and non-Business surfaces cannot masquerade as native proof", () => {
  const releaseArtifacts = [
    "business_ios_simulator",
    "business_ios_physical",
    "business_android",
  ].map((artifact_type) => ({
    artifact_type,
    artifact_id: `${artifact_type}-1`,
  }));
  const valid = releaseArtifacts.map(({ artifact_type, artifact_id }) => ({
    surface: artifact_type,
    artifact_id,
    runtime_version: "1.1.3",
    device: "owned test runtime",
  }));

  for (const wrongSurface of ["business_web", "consumer_ios", "admin_web"]) {
    const attack = valid.map((item, index) =>
      index === 2 ? { ...item, surface: wrongSurface } : item
    );
    assert.notDeepEqual(
      inspectNativeArtifactManifest(attack, releaseArtifacts).failures,
      [],
      `${wrongSurface} must not satisfy the native runtime tuple`,
    );
  }
});
