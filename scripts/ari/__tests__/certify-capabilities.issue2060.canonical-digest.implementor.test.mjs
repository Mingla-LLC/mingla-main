import assert from "node:assert/strict";
import test from "node:test";

import {
  ARI_CERT_CANONICALIZATION,
  canonicalCertificationDigest,
  canonicalCertificationTuple,
  inspectNativeArtifactManifest,
} from "../certify-capabilities.mjs";

const scenarioValues = [
  "123e4567-e89b-42d3-a456-426614174000",
  "ari.brand.create",
  "confirm_one_side_effect",
  "business_web",
  "owner_tenant",
  "owner",
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "business_web",
  "web-1",
  "brands:one",
  "passed",
  "00000000-0000-4000-8000-000000000005",
  "d".repeat(64),
  "00000000-0000-4000-8000-000000000006",
];

test("#2060 canonical tuple has one portable known-answer digest", () => {
  assert.equal(ARI_CERT_CANONICALIZATION, "ARI-CERT-TUPLE-V1");
  assert.equal(
    canonicalCertificationDigest("scenario-evidence", scenarioValues),
    "1ab3c47beeca068a6c76a2b458748568d261ad61380cb4dc878a75f299c57a54",
  );
  assert.equal(
    canonicalCertificationTuple("delimiter-proof", ["a|b", "a\nb", "é", null])
      .toString("utf8"),
    "ARI-CERT-TUPLE-V1\n15:delimiter-proof\n4\n3:a|b\n3:a\nb\n2:é\n-1:",
  );
});

test("#2060 native artifact tuple is complete, closed, and release-correlated", () => {
  const surfaces = [
    "business_ios_simulator",
    "business_ios_physical",
    "business_android",
  ];
  const releaseArtifacts = surfaces.map((artifact_type) => ({
    artifact_type,
    artifact_id: `${artifact_type}-1`,
  }));
  const nativeArtifacts = surfaces.map((surface) => ({
    surface,
    artifact_id: `${surface}-1`,
    runtime_version: "1.1.3",
    device: "certification device",
  }));

  assert.deepEqual(
    inspectNativeArtifactManifest(nativeArtifacts, releaseArtifacts).failures,
    [],
  );

  const attacks = [
    nativeArtifacts.slice(0, 2),
    nativeArtifacts.map((item, index) =>
      index === 0 ? { ...item, runtime_version: "   " } : item
    ),
    [nativeArtifacts[0], nativeArtifacts[0], nativeArtifacts[2]],
    nativeArtifacts.map((item, index) =>
      index === 0 ? { ...item, unexpected: "field" } : item
    ),
    nativeArtifacts.map((item, index) =>
      index === 0 ? { ...item, artifact_id: "wrong-release" } : item
    ),
  ];
  for (const attack of attacks) {
    assert.notDeepEqual(
      inspectNativeArtifactManifest(attack, releaseArtifacts).failures,
      [],
    );
  }
});
