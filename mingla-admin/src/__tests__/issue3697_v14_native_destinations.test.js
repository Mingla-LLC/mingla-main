/** Issue #3697 v1.4 — provider-native app destination contract. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("Admin destination picker includes Explorer and Host native app families", () => {
  const picker = read("mingla-admin/src/components/campaign-builder/StepDestination.jsx");
  assert.match(picker, /id: "explorer_app"/);
  assert.match(picker, /id: "host_app"/);
  assert.match(picker, /listNativeAppDestinations/);
  assert.match(picker, /platforms/);
  assert.match(picker, /fresh exact/);
});

test("native app rows are selectable only from server readiness", () => {
  const service = read("mingla-admin/src/services/adDestinationsService.js");
  assert.match(service, /action: "list_destinations"/);
  assert.match(service, /platforms/);
  assert.match(service, /row\.ready === true \? "available" : "unavailable"/);
  assert.match(service, /provider_readiness/);
  assert.match(service, /measurement_event/);
  assert.doesNotMatch(service, /availability:\s*"available"[\s\S]{0,80}explorer_app/);
});

test("immutable plan uses the native destination family and OS key", () => {
  const builder = read("mingla-admin/src/pages/CampaignBuilderPage.jsx");
  assert.match(builder, /\["explorer_app", "host_app"\]/);
  assert.match(builder, /nativeAppDestination/);
  assert.match(builder, /destinationFamily/);
  assert.match(builder, /firstDestination\.slug/);
});
