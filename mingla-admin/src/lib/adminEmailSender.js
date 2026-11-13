// Who an Admin campaign email is really sent from, and where replies go.
// Mirrors ADMIN_SENDER / ADMIN_REPLY_TO in
// supabase/functions/admin-send-email/index.ts; a test keeps the two equal.
// The composer's From box and the send review read these (#4419).
export const ADMIN_EMAIL_SENDER = Object.freeze({
  name: "Mingla",
  address: "hello@campaigns.usemingla.com",
});
export const ADMIN_EMAIL_REPLY_TO = "noreply@usemingla.com";
export const ADMIN_EMAIL_FROM_LABEL = `${ADMIN_EMAIL_SENDER.name} <${ADMIN_EMAIL_SENDER.address}>`;
