import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../../../../");
const repoRoot = resolve(appRoot, "..");
const sheet = readFileSync(
  resolve(appRoot, "src/components/purchases/SendTicketSheet.tsx"),
  "utf8",
);
const route = readFileSync(
  resolve(appRoot, "app/purchases/[kind]/[id].tsx"),
  "utf8",
);
const service = readFileSync(
  resolve(appRoot, "src/services/purchasesService.ts"),
  "utf8",
);
const sharedPhoneInput = readFileSync(
  resolve(repoRoot, "packages/phone-input/PhoneInput.tsx"),
  "utf8",
);
const transferMigration = readFileSync(
  resolve(
    repoRoot,
    "supabase/migrations/20271219014063_issue_4063_ticket_send_to_friend.sql",
  ),
  "utf8",
);

test("T5-17 maps the server self-contact refusal to the reviewed sheet error", () => {
  assert.ok(sheet.includes('code === "self"'));
  assert.ok(sheet.includes('"send.errorSelf"'));
  assert.ok(sheet.includes("offerTicketToFriend"));
  assert.ok(service.includes("ticket_offer_self"));
  assert.ok(service.includes('new TicketTransferError("self")'));
});

test("send-to-friend is limited to valid extra tickets and preserves offered QR access", () => {
  assert.ok(route.includes("ticket.ticketIndex >= 2"));
  assert.ok(route.includes('statusKey === "valid"'));
  assert.ok(route.includes('ticket.transferState === "offered"'));
  assert.ok(route.includes("confirmTakeBack(ticket)"));
  assert.ok(route.includes("SendTicketSheet"));
});

test("a post-send cache refresh failure cannot turn a committed transfer into a retry", () => {
  assert.match(
    sheet,
    /postHogService\.capture\("ticket_sent", \{ channel: "email_sms" \}\);[\s\S]*?try \{[\s\S]*?await onSent\(\);[\s\S]*?\} catch \{[\s\S]*?onClose\(\);/,
  );
});

test("send-to-friend requires email and a country-formatted mobile number", () => {
  assert.ok(sheet.includes('t("send.emailLabel")'));
  assert.ok(sheet.includes('t("send.phoneLabel")'));
  assert.ok(sheet.includes("<PhoneInput"));
  assert.ok(sheet.includes("smartEntry"));
  assert.ok(sheet.includes("required"));
  assert.ok(sheet.includes("parsePhoneEntry"));
  assert.ok(sheet.includes("email: normalizedEmail"));
  assert.ok(sheet.includes("phoneE164: phoneEntry.e164"));
  assert.ok(service.includes("p_email: email"));
  assert.ok(service.includes("p_phone_e164: phone"));
  assert.ok(
    transferMigration.includes(
      "OR (holder_email IS NOT NULL AND holder_phone_e164 IS NOT NULL)",
    ),
  );
  assert.ok(
    transferMigration.includes("OR v_email IS NULL OR v_phone IS NULL"),
  );
});

test("ticket phone entry stays on the bottom-sheet keyboard restoration rail", () => {
  assert.ok(sheet.includes("inputComponent={BottomSheetTextInput}"));
  assert.ok(sheet.includes('keyboardBehavior="interactive"'));
  assert.ok(sheet.includes('keyboardBlurBehavior="restore"'));
  assert.ok(sheet.includes('android_keyboardInputMode="adjustResize"'));
  assert.ok(sheet.includes('keyboardDismissMode: "interactive"'));
  assert.ok(sheet.includes('keyboardShouldPersistTaps: "handled"'));
  assert.ok(sharedPhoneInput.includes("inputComponent?: React.ComponentType"));
  assert.ok(
    sharedPhoneInput.includes(
      "const PhoneTextInput = inputComponent ?? RefForwardingTextInput;",
    ),
  );
});

test("email and SMS notification rows commit together for a sent ticket", () => {
  assert.ok(
    transferMigration.includes(
      "Email and Twilio-backed SMS are one durable delivery contract",
    ),
  );
  assert.match(
    transferMigration,
    /INSERT INTO public\.notification_outbox\([\s\S]*?'email', NULL[\s\S]*?'sms', public\.mingla_e164_country\(v_phone\)[\s\S]*?RETURN jsonb_build_object\('ok', true, 'state', 'offered'\)/,
  );
  assert.ok(
    !transferMigration.includes("issue_4063_ticket_sent_enqueue_failed"),
  );
});

test("held tickets join Purchases through their own safe ownership query", () => {
  assert.ok(service.includes("fetchMyHeldTickets"));
  assert.ok(service.includes('.eq("holder_user_id", userId)'));
  assert.ok(service.includes('.eq("transfer_state", "claimed")'));
  assert.ok(service.includes('source: "transfer"'));
});
