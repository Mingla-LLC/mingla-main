// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// issue #3524 — THE SHEET NAMES THE ACCOUNT, AND TELLS THE TRUTH ABOUT THE CHAT.
//
// Three defects, asserted here as three groups:
//
//   1. IT NEVER SAID WHOSE ACCOUNT IT WAS ABOUT TO USE. Signed in as the wrong
//      person, the sheet looked identical and the claim SUCCEEDED. It must now
//      name the account and offer a way to reject it.
//   2. THE "Sign in" BUTTON ONLY CLOSED THE SHEET. `onSignIn` was wired to
//      `closeAttendanceClaimPresentation` — a button labelled "Sign in" that
//      dismissed and did nothing else, at the exact moment of activation.
//   3. IT WOULD HAVE PROMISED A CHAT IT HAD NOT JOINED. The chat sentence must
//      be reachable ONLY from the `success` phase, never from `no_chat` — an
//      `experience` order legitimately has none, and saying so is better than
//      lying.
//
// Assertions are made against the SOURCE, with comments stripped, exactly as
// `issue_2979_attendance_claim_android_cta` does: this sheet cannot be rendered
// in bare node (app-mobile has no jest), and a comment quoting the old copy
// would otherwise satisfy a naive substring check.
//
// Run:
//   node app-mobile/src/components/__tests__/issue_3524_claim_sheet_states.implementor.happy.test.tsx

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sheetSource = read("src/components/AttendanceClaimSheet.tsx");
const sheet = strip(sheetSource);
const shellSource = read("app/index.tsx");
const shell = strip(shellSource);
const welcomeSource = read("src/components/signIn/WelcomeScreen.tsx");
const welcome = strip(welcomeSource);
const authSource = read("src/hooks/useAuthSimple.ts");
// #3524's two email members are STATELESS, so they are module functions in the
// email service rather than hook members. `useAuthSimple.ts` is pinned
// byte-for-byte by #1875 outside that issue's own declared regions, precisely so
// the sign-in paths cannot drift under a nearby change, and two wrappers that
// hold no hook state are not a reason to spend that guarantee.
const emailAuthSource = read("src/services/emailOtpService.ts");
const appStateSource = read("src/components/AppStateManager.tsx");

// ── 1. The sheet names the account, and offers a way out ─────────────────────

assert.ok(
  /signedInIdentifier/.test(sheet),
  "the sheet takes the signed-in identifier",
);
assert.ok(
  sheetSource.includes("Connect this ticket to ${signedInIdentifier}?"),
  "the ready copy NAMES the account it is about to use",
);
assert.ok(
  sheetSource.includes("Connect this RSVP or ticket to your account?"),
  "and falls back to the old generic sentence when neither identifier resolves",
);
assert.ok(
  sheetSource.includes("Use a different account"),
  "an always-present escape hatch is offered",
);
assert.ok(
  sheetSource.includes("Use a different Mingla account for this ticket"),
  "with an accessibility label that says what it does",
);
assert.ok(
  /onUseDifferentAccount/.test(sheet),
  "and it calls out to the shell rather than signing out itself",
);

// The escape hatch is its OWN Pressable sibling of the primary button. A nested
// Pressable flattens the accessibility subtree and the screen reader loses one
// of the two actions.
const footer = sheet.slice(sheet.indexOf("const footer = ("));
const footerBlock = footer.slice(0, footer.indexOf("\n  );"));
assert.ok(
  footerBlock.indexOf("</Pressable>") < footerBlock.indexOf("{secondary}"),
  "the secondary control is rendered AFTER the primary button closes — a "
    + "SIBLING, never nested inside it, because a nested Pressable flattens the "
    + "accessibility subtree and the screen reader loses one of the two actions",
);
assert.ok(
  !/<Pressable[\s\S]*?<Pressable[\s\S]*?<\/Pressable>[\s\S]*?<\/Pressable>/.test(
    footerBlock,
  ),
  "and no Pressable in the footer encloses another",
);

// The marker is written BEFORE sign-out is asked for, with no await between.
const handoff = sheet.slice(sheet.indexOf("handoffToAnotherAccount"));
const markerAt = handoff.indexOf("saveAttendanceClaimHandoffMarker");
const signOutAt = handoff.indexOf("onUseDifferentAccount()");
assert.ok(markerAt > -1 && signOutAt > markerAt, "the marker is written first");
assert.ok(
  !/await/.test(handoff.slice(markerAt, signOutAt)),
  "and NOTHING is awaited between the marker and the sign-out — the auth "
    + "listener fires immediately and an await here is the bug",
);

// ── 2. The mismatch is the SERVER's decision, and the hint is masked ─────────

assert.ok(
  /claim_identity_mismatch/.test(sheet),
  "the sheet reacts to the server's mismatch answer",
);
assert.ok(
  !/buyerEmail|purchaseEmail|\.email\s*===/.test(sheet),
  "the sheet contains NO email comparison of its own — one authority, the RPC",
);
assert.ok(
  /error\.contactMasked/.test(sheet),
  "the hint it renders is the one the SERVER masked",
);
assert.ok(
  sheetSource.includes("This ticket was bought with"),
  "the mismatch copy names the purchase contact",
);
assert.ok(
  sheetSource.includes("Sign out and continue"),
  "and offers to sign out and continue",
);

// Neither refusal may clear the intent: the server consumed nothing, so the
// same link must still work for the rightful account.
for (const code of ["claim_identity_mismatch", "claim_expired"]) {
  const branch = sheet.slice(sheet.indexOf(`error.code === "${code}"`));
  const arm = branch.slice(0, branch.indexOf("return;"));
  assert.ok(
    !arm.includes("clearAttendanceClaimIntent"),
    `${code} must NOT clear the pending claim — the token survived`,
  );
}

// ── 3. The chat sentence is reachable only when the chat was really joined ───

assert.ok(
  sheetSource.includes("you’ve joined the event chat"),
  "the success copy says the guest joined the chat",
);
assert.ok(
  sheetSource.includes("This one doesn’t have a group chat."),
  "and the no-chat copy says truthfully that there is none",
);
const chatSentence = sheetSource.indexOf("you’ve joined the event chat");
const successArm = sheetSource.lastIndexOf('phase === "success"', chatSentence);
assert.ok(
  successArm > -1 && chatSentence - successArm < 200,
  "the chat sentence hangs off the `success` phase and nothing else",
);
assert.ok(
  /result\.chatJoined && result\.conversationId !== null/.test(sheet),
  "and `success` is only entered when the SERVER said the chat was joined",
);
assert.ok(
  /setPhase\("no_chat"\)/.test(sheet) || /\? "no_chat"/.test(sheet),
  "a claim with no chat lands in its own phase",
);
assert.ok(
  sheetSource.includes("See who’s going"),
  "which offers the guest list instead of a chat that does not exist",
);
assert.ok(
  /onOpenChat/.test(sheet),
  "opening the chat is delegated to the shell's existing router",
);
assert.ok(
  sheetSource.includes("You’re connected, but we couldn’t open the chat."),
  "and a routing failure never looks like a claim failure",
);

// ── 4. The shell wires all of it, and `Sign in` really navigates ─────────────

assert.ok(
  /onSignIn=\{attendanceClaimGoToSignIn\}/.test(shell),
  "the Sign in button no longer just closes the sheet",
);
assert.ok(
  !/onSignIn=\{closeAttendanceClaimPresentation\}/.test(shell),
  "the dead-dismiss wiring is GONE",
);
const goToSignIn = shell.slice(shell.indexOf("attendanceClaimGoToSignIn = useCallback"));
assert.ok(
  goToSignIn.slice(0, 400).includes("setAttendanceClaimWantsEmailSignIn(true)"),
  "it asks for the email-code panel, which is the only method that can prove "
    + "a purchase address Google and Apple have never seen",
);
assert.ok(
  /signedInIdentifier=\{attendanceClaimSignedInIdentifier\}/.test(shell),
  "the shell resolves who is signed in and hands it to the sheet",
);
assert.ok(
  /onUseDifferentAccount=\{attendanceClaimUseDifferentAccount\}/.test(shell),
  "and wires the escape hatch",
);
assert.ok(
  /onOpenChat=\{attendanceClaimOpenChat\}/.test(shell),
  "and the chat route",
);

// The handoff ref is set synchronously, before the async sign-out.
const useDifferent = shell.slice(
  shell.indexOf("attendanceClaimUseDifferentAccount = useCallback"),
);
const refAt = useDifferent.indexOf("attendanceClaimHandoffActiveRef.current = true");
const outAt = useDifferent.indexOf("handleSignOut()");
assert.ok(refAt > -1 && outAt > refAt, "the ref is set before sign-out is called");
assert.ok(
  !/await/.test(useDifferent.slice(refAt, outAt)),
  "with nothing awaited in between",
);

// The chat route reuses the EXISTING conversation deep-link shape.
const openChat = shell.slice(shell.indexOf("attendanceClaimOpenChat = useCallback"));
assert.ok(
  openChat.slice(0, 900).includes('tab: "messages"'),
  "it uses the existing messages deep-link params",
);
assert.ok(
  openChat.slice(0, 900).includes('setCurrentPage("connections")'),
  "and the existing page switch — no second router",
);

// `"preserve"` performs no state change at all.
const preserveArm = shell.slice(shell.indexOf('authAction === "preserve"'));
assert.ok(
  /return;/.test(preserveArm.slice(0, 120)),
  "the preserve branch returns immediately and changes nothing",
);

// ── 5. Email sign-in is an ADDITION; Google and Apple are untouched ──────────

assert.ok(
  welcomeSource.includes("Continue with email"),
  "the third way in is offered",
);
assert.ok(
  /onGoogleSignIn/.test(welcome) && /onAppleSignIn/.test(welcome),
  "Google and Apple are still on this screen",
);
assert.ok(
  /onSendEmailCode\?:/.test(welcome) && /onVerifyEmailCode\?:/.test(welcome),
  "the two email props are OPTIONAL, so every existing render site of this "
    + "screen compiles and behaves identically",
);
assert.ok(
  /emailSignInAvailable\s*\?/.test(welcome),
  "and with them absent the email option is not rendered at all",
);
assert.ok(
  /KeyboardAvoidingView/.test(welcome),
  "the screen's first text inputs get keyboard avoidance",
);
assert.ok(
  /keyboardShouldPersistTaps="handled"/.test(welcome),
  "and taps survive the keyboard — without this the first tap on the send "
    + "button only dismisses the keyboard, which is a dead tap",
);
assert.ok(
  !/radius\.pill/.test(welcome),
  "no style references a design token that does not exist",
);

// The two OAuth paths and sign-out are not modified by this issue.
for (const name of ["signInWithGoogle", "signInWithApple", "signOut"]) {
  assert.ok(
    authSource.includes(name),
    `${name} is still exported by useAuthSimple`,
  );
}
assert.ok(
  emailAuthSource.includes("export async function signInWithEmailCode") &&
    emailAuthSource.includes("export async function verifyEmailCode"),
  "and the two email members exist beside them, in the email service",
);
// STRICTER than naming them: they have to actually REACH the screen, or the
// guest still cannot prove the purchase address.
assert.ok(
  /import \{[^}]*signInWithEmailCode[^}]*verifyEmailCode[^}]*\}\s*from\s*"\.\.\/services\/emailOtpService"/s
    .test(appStateSource) &&
    /signInWithEmailCode,\n\s*verifyEmailCode,/.test(appStateSource),
  "and the shell passes both of them through to the screen",
);
// And #1875's pin is not spent: nothing but that issue's own regions may differ
// in the hook, so the two email members must NOT be members of it.
assert.ok(
  !authSource.includes("signInWithEmailCode") &&
    !authSource.includes("verifyEmailCode"),
  "useAuthSimple keeps the shape #1875 pins byte-for-byte",
);
assert.ok(
  /classifyAuthFailure\(\s*\n?\s*"EmailOtpSendFailed"/.test(emailAuthSource) ||
    emailAuthSource.includes('"EmailOtpSendFailed"'),
  "an email-OTP failure is classified through the SAME path a Google failure "
    + "takes, so it is as visible in monitoring as any other",
);
assert.ok(
  /import \{ classifyAuthFailure \} from "\.\.\/hooks\/useAuthSimple"/
    .test(emailAuthSource),
  "and it is the ONE shared predicate, imported, not a second copy of it",
);

// Nothing in the new code logs an address or a code.
const otp = read("src/services/emailOtpService.ts");
assert.ok(
  !/console\.(log|info|warn|error|debug)/.test(strip(otp)),
  "the email OTP service logs nothing at all",
);
assert.ok(
  /shouldCreateUser:\s*true/.test(otp),
  "and it creates the account, because a guest who bought a ticket without one "
    + "is exactly the person this exists for",
);

// ── #3524 ITEM 4: the refusal splits, and the split reaches the screen ──────
//
// THE DEFECT THIS SECTION EXISTS FOR. One refusal was doing two jobs. The
// rightful buyer whose inbox was simply unproved got the SAME sheet as somebody
// holding a forwarded email, and that sheet's only action is to sign out and
// come back as someone else — which for them is a circle back to this wall.
// So the assertion that carries the meaning is not "a new phase exists", it is
// "the unproved-same case renders confirm-the-inbox and NOT the mismatch copy".

// The server is the only authority: the sheet branches on the server's code and
// never on a comparison of its own.
assert.ok(
  /error\.code === "claim_contact_unproved"/.test(sheetSource),
  "the sheet must branch on the server's own outcome for the unproved case",
);
assert.ok(
  !/signedInIdentifier\s*===\s*maskedContact|maskedContact\s*===\s*signedInIdentifier/
    .test(sheetSource),
  "the client must never compare the two contacts — the RPC is the one authority",
);

// THE ONE THAT WOULD HAVE CAUGHT IT.
{
  // The BRANCH, not the analytics ternary that names the same code earlier.
  const unproved = sheetSource.indexOf('if (error.code === "claim_contact_unproved")');
  const mismatch = sheetSource.indexOf('if (error.code === "claim_identity_mismatch")');
  assert.ok(unproved > 0 && mismatch > 0, "both refusal branches must exist");
  // Each arm is its OWN body, brace-matched, not a fixed window — a window runs
  // into the next branch and then asserts about somebody else's code.
  const armAt = (from) => {
    const open = sheetSource.indexOf("{", from);
    let depth = 0;
    for (let i = open; i < sheetSource.length; i += 1) {
      if (sheetSource[i] === "{") depth += 1;
      else if (sheetSource[i] === "}") {
        depth -= 1;
        if (depth === 0) return sheetSource.slice(open, i + 1);
      }
    }
    throw new Error("unbalanced branch body");
  };
  const unprovedArm = armAt(unproved);
  const mismatchArm = armAt(mismatch);
  assert.ok(
    /setPhase\("confirm_inbox"\)/.test(unprovedArm),
    "an unproved-but-matching contact must land on confirm-the-inbox, not the "
      + "sign-out sheet — that is the circle this issue removes",
  );
  assert.ok(
    !/setPhase\("mismatch"\)/.test(unprovedArm),
    "the unproved case must NOT render the mismatch copy",
  );
  assert.ok(
    /setPhase\("mismatch"\)/.test(mismatchArm),
    "a genuinely different address must still get the mismatch sheet",
  );
  assert.ok(
    !/clearAttendanceClaimIntent/.test(unprovedArm),
    "the unproved refusal must not clear the pending intent — nothing was consumed",
  );
}

assert.ok(
  /error\.code === "claim_contact_unproved" \? "contact_unproved"/.test(sheetSource),
  "the new refusal needs its own funnel outcome — folded into network it reads "
    + "as a fault, and this is the one refusal the guest can act on",
);

// The approved copy, and nothing that promises permanence.
assert.ok(
  sheetSource.includes("the address on this account"),
  "screen 1 must name the address as this account's own",
);
assert.ok(
  sheetSource.includes("We just need to check you can open that inbox."),
  "screen 1 must carry the approved ask",
);
assert.ok(sheetSource.includes("Email me a code"), "screen 1's primary");
assert.ok(
  sheetSource.includes("Enter the 6-digit code we sent to"),
  "screen 2 must carry the approved ask",
);
assert.ok(
  sheetSource.includes("Confirm and connect") && sheetSource.includes("Send it again"),
  "screen 2 must carry both approved controls",
);
assert.ok(
  !/never (?:see|ask) (?:this|you) again|only once|won.t ask again|from now on/i
    .test(sheetSource),
  "no copy may imply the proof is permanent — it is bound to the proving "
    + "session, so it is durable, not forever",
);

// The code step lives INSIDE the sheet, keyboard-aware, one OTP writer.
assert.ok(
  /BottomSheetTextInput/.test(sheetSource),
  "the code field must be the sheet-aware input, or the keyboard covers it",
);
// The sheet-aware input alone is not the whole contract: the sheet has to lift
// with the keyboard, and the submitting tap must not be eaten by the dismiss.
// This is the configuration the app's other form sheets already use.
assert.ok(
  /keyboardBehavior="interactive"/.test(sheetSource),
  "the sheet must lift with the keyboard, or the field is covered at the low snap",
);
assert.ok(
  /keyboardShouldPersistTaps: "handled"/.test(sheetSource),
  "without persistent taps the first press on Confirm and connect only closes "
    + "the keyboard — a two-tap button at the moment of completion",
);
assert.ok(
  !/@gorhom\/bottom-sheet/.test(sheetSource),
  "the sheet must take that input from the primitive, not from @gorhom directly",
);
assert.ok(
  /from "\.\.\/services\/emailOtpService"/.test(sheetSource) &&
    /sendEmailSignInCode/.test(sheetSource) &&
    /verifyEmailSignInCode/.test(sheetSource),
  "the sheet must reuse emailOtpService — one writer for the emailed code",
);
assert.ok(
  !/router\.(push|navigate)|useRouter/.test(sheetSource),
  "the code step must not navigate — the person must not leave the ticket they "
    + "are connecting",
);

// A successful confirm falls through to the ORDINARY claim.
{
  const at = sheetSource.indexOf("const confirmCode");
  const body = sheetSource.slice(at, at + 900);
  assert.ok(
    /await submit\(\)/.test(body),
    "a confirmed code must fall through to submit(), not re-implement the claim",
  );
  assert.ok(
    !/setPhase\("success"\)/.test(body),
    "the confirm path must not set the success phase itself — screen 3 is "
      + "reached through the ordinary claim or not at all",
  );
}

// The resend is rate-limited; the secondaries are siblings of the primary.
assert.ok(
  /resendAt/.test(sheetSource) && /disabled=\{codeBusy \|\| !resendArmed\}/.test(sheetSource),
  "Send it again must have a cooldown so it cannot be hammered",
);
assert.ok(
  sheetSource.indexOf("const secondary") < sheetSource.indexOf("{secondary}"),
  "the secondary controls must be rendered as siblings of the primary button",
);

console.log(
  "issue #3524 claim sheet, shell wiring and email sign-in contracts passed",
);
