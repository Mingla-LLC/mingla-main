import assert from "node:assert/strict";
import test from "node:test";

import { validateManagementProjectResponse } from "../lib/sites-ops.mjs";

const PROJECT_REF = "jwwlbmwxmuljrxkrnxry";
const ORGANIZATION_ID = "mrcqqkovdchaltvquggd";
const NOW = new Date("2026-09-01T12:15:00.000Z");

function liveProject(overrides = {}) {
  return {
    created_at: "2026-09-01T04:19:25.460203Z",
    database: {
      host: `db.${PROJECT_REF}.supabase.co`,
      postgres_engine: "17",
      release_channel: "ga",
      version: "17.6.1.166",
    },
    id: PROJECT_REF,
    name: "mingla-sites-cms-prod",
    organization_id: ORGANIZATION_ID,
    organization_slug: ORGANIZATION_ID,
    ref: PROJECT_REF,
    region: "us-east-2",
    status: "ACTIVE_HEALTHY",
    ...overrides,
  };
}

test("#2943 accepts the exact live Supabase project identity shape", () => {
  const result = validateManagementProjectResponse(liveProject(), PROJECT_REF, NOW);
  assert.equal(result.region, "us-east-2");
  assert.equal(result.created_at, "2026-09-01T04:19:25.460Z");
});

test("#2943 rejects spoofed or undocumented project identity fields", () => {
  for (const project of [
    liveProject({ id: "other-project-ref-00" }),
    liveProject({ organization_id: "other-organization-id" }),
    liveProject({ undocumented: true }),
  ]) {
    assert.throws(
      () => validateManagementProjectResponse(project, PROJECT_REF, NOW),
      /PROJECT_RESPONSE_SCHEMA_INVALID/,
    );
  }
});
