// Issue #3802 — pure helpers for team invitations (no Supabase import, so the
// whole file is unit-testable). A team invitation is tied to the invited
// person with a one-time link that expires; the secret half of that link is
// made here, stored only as a hash, and never logged.

/** Origins the admin app is served from. The first one is production. */
export const ADMIN_APP_ORIGINS = [
  "https://admin.usemingla.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** An exact match in the list, else the production origin. */
export function resolveAdminOrigin(originHeader: string | null): string {
  if (originHeader !== null && ADMIN_APP_ORIGINS.includes(originHeader)) {
    return originHeader;
  }
  return ADMIN_APP_ORIGINS[0];
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url, no padding (43 characters). */
export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function isInviteToken(v: unknown): v is string {
  return typeof v === "string" && TOKEN_PATTERN.test(v);
}

/** Lower-case hex SHA-256 (64 characters). */
export async function sha256Hex(v: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(v),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The secret sits after the `#`, so it is never sent to a server by the
 * browser that opens the link.
 */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin}/#/accept-invite/${token}`;
}

export const INVITE_ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  growth: "Sales and marketing",
  partner: "Founding partner",
};

export interface InviteAccountIdentity {
  provider?: string | null;
  identity_data?: { email?: unknown } | null;
}

export interface InviteAccount {
  phone?: string | null;
  identities?: InviteAccountIdentity[] | null;
}

/**
 * May team access be attached to this existing account?
 *
 * ONE strict rule (issue #3802): "conflict" when the account can sign in any
 * way other than email. That is a phone number on the account, a phone
 * identity, or any social identity (Google, Apple, ...) whether it is under
 * the invited address or another one. Only an account whose every identity is
 * the email one may be given team access; the person is otherwise asked for a
 * different address.
 *
 * The rule is DEFINED in the database (admin_team_invite_address_verdict),
 * which decides when an invitation is sent and is asked again when one is
 * opened. This function applies the same rule to the account the sign-in
 * service returned, as a second check that needs no extra trust.
 */
export function accountVerdict(
  user: InviteAccount | null | undefined,
  _email: string,
): "ok" | "conflict" {
  if (!user) return "conflict";
  if (typeof user.phone === "string" && user.phone.trim().length > 0) {
    return "conflict";
  }
  for (const identity of user.identities ?? []) {
    if (identity.provider !== "email") return "conflict";
  }
  return "ok";
}
