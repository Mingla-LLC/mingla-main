import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "WelcomeScreen.tsx"), "utf8");
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function functionBody(startMarker) {
  const start = code.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === "{") depth += 1;
    if (code[index] === "}") depth -= 1;
    if (depth === 0) return code.slice(open, index + 1);
  }
  throw new Error(`unbalanced function body for ${startMarker}`);
}

test("the code step names the exact normalized inbox that received the code", () => {
  const send = functionBody("const sendEmailCode");
  assert.match(send, /setEmailAddress\(address\);\s*setEmailStep\("code"\)/);
  assert.match(
    code,
    /t\("auth:email\.codeSentTo",\s*\{[\s\S]*?email:\s*emailAddress,[\s\S]*?defaultValue:\s*`Enter the 6-digit code we sent to \$\{emailAddress\}\.`,/,
  );
});

test("a normal sign-in can return to the address field without stale OTP state", () => {
  const edit = functionBody("const editEmailAddress");
  assert.match(edit, /if \(followInviteActive \|\| emailBusy\) return;/);
  assert.match(edit, /setEmailStep\("address"\)/);
  assert.match(edit, /setEmailCode\(""\)/);
  assert.match(edit, /setEmailError\(null\)/);
  assert.match(edit, /setResendIn\(0\)/);

  const controlAt = code.indexOf('testID="welcome-email-edit"');
  assert.ok(controlAt > -1, "the code step exposes a stable edit-email control");
  const control = code.slice(controlAt - 900, controlAt + 80);
  assert.match(control, /!followInviteActive\s*\?\s*\(/);
  assert.match(control, /accessibilityLabel="Wrong email\? Edit"/);
  assert.match(control, /onPress=\{editEmailAddress\}/);
});

test("editing the address clears code, error, and resend cooldown again", () => {
  const addressFieldAt = code.indexOf('testID="welcome-email-address"');
  assert.ok(addressFieldAt > -1, "the email address field still exists");
  const addressField = code.slice(addressFieldAt - 1000, addressFieldAt + 80);
  assert.match(addressField, /setEmailAddress\(next\)/);
  assert.match(addressField, /setEmailCode\(""\)/);
  assert.match(addressField, /setEmailError\(null\)/);
  assert.match(addressField, /setResendIn\(0\)/);
});

test("a signed follow invite cannot redirect its code to another mailbox", () => {
  const edit = functionBody("const editEmailAddress");
  assert.match(edit, /if \(followInviteActive \|\| emailBusy\) return;/);

  const controlAt = code.indexOf('testID="welcome-email-edit"');
  const control = code.slice(controlAt - 900, controlAt + 80);
  assert.match(control, /!followInviteActive\s*\?\s*\(/);
});

