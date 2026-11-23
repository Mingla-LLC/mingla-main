// Issue #3969 Step 2 — the admin console reads people's emails through the
// admin contacts read, never from the profile row.
//
// FAILS-ON-REVERT: putting `email` back into a profiles select in the command
// palette, the coach-mark reset, the identity read, the product board's
// reporters or the Email page's preferences list fails here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) =>
  fs.readFileSync(path.join(here, "..", rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const SITES = [
  "components/CommandPalette.jsx",
  "pages/SettingsPage.jsx",
  "services/identityReadService.js",
  "services/productAvengersService.js",
  "pages/EmailPage.jsx",
];

describe("#3969 admin profile contacts", () => {
  it("the service calls the admin contacts read and throws on failure", () => {
    const source = read("services/adminProfileContactsService.js");
    assert.match(source, /supabase\.rpc\("issue_3969_admin_profile_contacts", \{/);
    assert.match(source, /p_user_ids:/);
    assert.match(source, /p_email:/);
    assert.match(source, /if \(error\) throw error;/);
  });

  for (const site of SITES) {
    it(`${site} reads no email from profiles`, () => {
      const source = read(site);
      const chains = source.match(/\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}/g) || [];
      for (const chain of chains) {
        const select = /\.select\(\s*["'`]([^"'`]*)["'`]/.exec(chain);
        if (select) assert.doesNotMatch(select[1], /\bemail\b|\*/, `${site}: ${select[1]}`);
      }
      assert.doesNotMatch(source, /profiles![\w]+\([^)]*\bemail\b/, `${site}: profiles embed names email`);
      assert.ok(
        /adminProfileContactsService|issue_3969_admin_profile_contacts/.test(source),
        `${site} uses the admin contacts read`,
      );
    });
  }

  it("the coach-mark reset finds the person by email through the admin read", () => {
    const source = read("pages/SettingsPage.jsx");
    assert.match(source, /fetchAdminProfileContacts\(\{ email: userEmail\.trim\(\) \}\)/);
    assert.doesNotMatch(source, /\.eq\("email"/);
  });

  it("emails missing from the admin read are shown as empty, and the failure is logged", () => {
    for (const site of ["components/CommandPalette.jsx", "pages/EmailPage.jsx"]) {
      const source = read(site);
      assert.match(source, /contacts\[[\w.]+\]\?\.email \|\| null/, site);
      assert.match(source, /console\.warn\("\[\w+\] contact read failed:"/, site);
    }
  });
});
