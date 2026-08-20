import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(__dirname, "..");
const builder = join(packageRoot, "scripts/build-invite-critical-entry.mjs");

function buildFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "issue2211-ci-rework-"));
  const jsDir = join(dir, "_expo/static/js/web");
  mkdirSync(jsDir, { recursive: true });
  for (const name of ["runtime-a.js", "common-b.js", "index-c.js"]) {
    writeFileSync(join(jsDir, name), "// #2211 fixture");
  }
  writeFileSync(
    join(dir, "index.html"),
    '<!doctype html><html><body><div id="root"></div>' +
      '<script src="/_expo/static/js/web/runtime-a.js"></script>' +
      '<script src="/_expo/static/js/web/common-b.js"></script>' +
      '<script src="/_expo/static/js/web/index-c.js"></script>' +
      "</body></html>",
  );
  execFileSync(process.execPath, [builder, "--build-dir", dir], {
    env: { ...process.env, NODE_ENV: "test" },
  });
  return readFileSync(
    join(dir, "accept-brand-invitation-entry.html"),
    "utf8",
  );
}

describe("#2211 CI integration rework", () => {
  test("the copied invitation controls use the same outer/face/label paint ownership as React Native Web", () => {
    const output = buildFixture();

    expect(output).toContain(
      '<button class="i922-signin" type="button"><span class="i922-signin-face"><span class="i922-signin-label">Sign in</span></span></button>',
    );
    expect(output).toContain(
      '<span class="i922-action-face i922-accept-face"><span class="i922-action-label">Accept all</span></span>',
    );
    expect(output).toContain(
      '<span class="i922-action-face i922-reject-face"><span class="i922-action-label">Reject</span></span>',
    );
    expect(output).toContain(
      '<span class="i922-manage-label">Manage</span>',
    );
    expect(output).toContain(
      ".i922-signin{display:flex;width:100%;height:52px}",
    );
    expect(output).toContain(
      ".i922-action-face{display:flex;flex:1;align-items:center;justify-content:center;height:44px",
    );
    expect(output).toContain(
      'manageLabel.textContent=open?"Manage":"Hide details"',
    );
    expect(output).not.toContain(
      '<button class="i922-signin" type="button">Sign in</button>',
    );
    expect(output).not.toContain(
      'manage.textContent=open?"Manage":"Hide details"',
    );
  });
});
