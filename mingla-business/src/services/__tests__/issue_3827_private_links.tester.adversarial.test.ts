import { readFileSync } from "node:fs";
import { join } from "node:path";

const business = join(__dirname, "..", "..", "..");
const repo = join(business, "..");
const readBusiness = (path: string): string => readFileSync(join(business, path), "utf8");
const migration = readFileSync(
  join(repo, "supabase/migrations/20271203003827_issue_3827_private_ticket_links.sql"),
  "utf8",
);

describe("issue #3827 private ticket links — adversarial contracts", () => {
  test("anonymous documents are non-indexable, non-referring, and never CDN cached", () => {
    const document = readBusiness("server/ticketLinkDocument.js");
    expect(document).toContain('name="robots" content="noindex,nofollow,noarchive"');
    expect(document).toContain('name="referrer" content="no-referrer"');
    expect(document).toContain('res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate")');
    expect(document).toContain('res.setHeader("vercel-cdn-cache-control", "no-store")');
    expect(document).toContain('res.setHeader("x-robots-tag", "noindex, nofollow, noarchive")');
    expect(document).toMatch(/const TOKEN = \/\^\[A-Za-z0-9_-\]\{22\}\$\//);
  });

  test("hidden tiers stay absent from direct readers and direct checkout refuses them", () => {
    expect(migration).toContain("issue_3827_link_unlocks_tier");
    expect(migration).toContain("COALESCE(tt.is_hidden, false) = false");
    expect(migration).toContain("biz_ticket_link_checkout_create_session");
    expect(migration).toContain("pg_ticket_link_resolve");
    expect(migration).toMatch(/p_token_hash\s+text/i);
    expect(migration).not.toMatch(/p_token\s+text/i);
  });

  test("password controls are removed and saves explicitly scrub legacy password state", () => {
    const editor = readBusiness("src/components/event/TicketTierEditSheet.tsx");
    const settings = readBusiness("src/components/event/CreatorStep6Settings.tsx");
    const publicRenderer = readFileSync(
      join(repo, "packages/offering-rendering/PublicEventPage.tsx"),
      "utf8",
    );
    expect(editor).toContain("passwordProtected: false");
    expect(editor).toContain("password: null");
    expect(editor).not.toContain("ticket-password-input");
    expect(settings).not.toContain("event-password-input");
    expect(publicRenderer).not.toContain("This event requires a password");
    expect(publicRenderer).not.toContain("accessibilityLabel=\"Event password\"");
    expect(migration).toContain("issue_3827_retire_tier_password");
    expect(migration).toContain("issue_3827_retire_event_password");
    expect(migration).toContain("RAISE EXCEPTION 'password_protection_retired'");
    expect(migration).toContain("NEW.password_protected := false");
    expect(migration).toContain("NEW.password_hash := NULL");
  });

  test("host and guest entry points defer private-link UI from startup bundles", () => {
    const guestRoute = readBusiness("app/g/[token].tsx");
    const guests = readBusiness("app/event/[id]/guests/index.tsx");
    const tierEditor = readBusiness("src/components/event/TicketTierEditSheet.tsx");
    expect(guestRoute).toContain("React.lazy");
    expect(guests).toContain("React.lazy");
    expect(guests).not.toMatch(/^import .*TicketLinksSheet/m);
    expect(tierEditor).not.toMatch(/^import .*TicketLinksSheet/m);
  });

  test("the host form exposes expiry and hidden tiers promise private-link access", () => {
    const sheet = readBusiness("src/components/guests/TicketLinksSheet.tsx");
    const display = readBusiness("src/utils/ticketDisplay.ts");
    expect(sheet).toContain("Link stops working");
    expect(sheet).toContain("ticket-link-expiry-web");
    expect(sheet).toContain("expiresAt,");
    expect(display).toContain("Hidden — private link only");
    expect(display).not.toContain("Hidden — direct link only");
  });

  test("group signup requires unique emails, does not reserve pending capacity, and opts issued comps into marketing", () => {
    const partyLine = readFileSync(
      join(repo, "supabase/functions/_shared/email/partyLine.ts"),
      "utf8",
    );
    expect(migration).toContain("duplicate_in_request");
    expect(migration).toContain("marketing_opt_in");
    expect(migration).toContain("v_link.approval_mode = 'auto'");
    expect(migration).toContain("'status', 'pending'");
    expect(migration).toContain("emailQueuedOrderIds");
    expect(partyLine).toContain("added you to the guest list");
    expect(migration).not.toMatch(/turnstile/i);
    expect(migration).not.toMatch(/invited_by/i);
  });
});
