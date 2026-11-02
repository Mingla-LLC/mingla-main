/**
 * #4226 — every Mingla email carries ONE footer line (Seth, 2026-11-02):
 *
 *   You’re receiving this email because you’ve connected with Mingla
 *
 * written once in supabase/functions/_shared/email/footerLine.ts, mirrored
 * for the business preview in packages/brand-rendering/emailFooter.ts.
 *
 *   1. The words are exact (curly apostrophes, no trailing period).
 *   2. Every email path prints it exactly once: the shell, a transactional
 *      email, an admin send (admin_compose) and a host brand blast.
 *   3. The host composer preview reads the same constant (drift guard).
 *   4. The old purchase sentence and the per-reason sentences are gone from
 *      every source file.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { EMAIL_FOOTER_LINE } from "../email/footerLine.ts";
import { FOOTER_DISCLAIMER } from "../email/copy.ts";
import { renderShell } from "../email/shell.ts";
import { renderTransactionalEmail } from "../email/index.ts";
import { renderMarketingEmail } from "../marketingEmailRender.ts";

Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");

const ROOT = new URL("../../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, ROOT));
const OLD_SENTENCE =
  "You received this email because you purchased tickets or requested an action with Mingla.";
const timesIn = (html: string) => html.split(EMAIL_FOOTER_LINE).length - 1;

Deno.test("#4226 the footer line is exactly Seth's wording", () => {
  assertEquals(
    EMAIL_FOOTER_LINE,
    "You’re receiving this email because you’ve connected with Mingla",
  );
  assertEquals(
    FOOTER_DISCLAIMER,
    EMAIL_FOOTER_LINE,
    "the shell reads the one constant",
  );
});

Deno.test("#4226 every email path prints the line exactly once and never the old sentence", () => {
  const shell = renderShell({
    preheader: "p",
    bodyHtml: "<p>Hi</p>",
    supportEmail: "support@usemingla.com",
    logoUrl: "https://cdn.mingla-fixture.org/logo-fixture.png",
    footerAddress: "Mingla",
  });
  const admin = renderTransactionalEmail({
    variant: "admin_compose",
    recipient: { name: "Kemi", email: "kemi@mingla-fixture.org" },
    body: {
      variant: "admin_compose",
      title: "Hello",
      paragraphs: [],
      document: [{ type: "rich_text", html: "<p>Hi</p>" }],
    },
    sender: { name: "Mingla", address: "hello@usemingla.com" },
  }).html;
  const notification = renderTransactionalEmail({
    variant: "generic_notification",
    recipient: { name: null, email: "someone@mingla-fixture.org" },
    body: {
      variant: "generic_notification",
      title: "Update",
      paragraphs: ["Hi"],
    },
    sender: { name: "Mingla", address: "hello@usemingla.com" },
  }).html;
  const blast = renderMarketingEmail({
    body_html: "Hi {first_name}",
    variables: {
      first_name: "Ada",
      event_name: null,
      event_date: null,
      event_date_short: null,
      event_time: null,
      doors_open: null,
      ends_at: null,
      brand_name: "Lantern Room",
      event_url: null,
      spots_left: null,
      previous_event_name: null,
      next_event_name: null,
      event_id: null,
    },
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Hello",
    brand_name: "Lantern Room",
  }).html;
  for (
    const [name, html] of Object.entries({ shell, admin, notification, blast })
  ) {
    assertEquals(timesIn(html), 1, `${name} prints the footer line once`);
    assertEquals(html.includes("purchased tickets"), false, name);
    assertEquals(html.includes("requested an action"), false, name);
    assertEquals(
      /You(?:'|&#39;)re receiving this because/.test(html),
      false,
      name,
    );
  }
});

Deno.test("#4226 the business preview mirror equals the canonical footer line", async () => {
  const mirror = await import("../../../../packages/brand-rendering/emailFooter.ts");
  assertEquals(mirror.EMAIL_FOOTER_LINE, EMAIL_FOOTER_LINE);
});

Deno.test("#4226 no edge function imports from packages/ for the footer", () => {
  assertEquals(read("supabase/functions/_shared/email/copy.ts").includes("packages/"), false);
});

Deno.test("#4226 the host composer preview shows the same constant", () => {
  const preview = read(
    "mingla-business/src/components/marketing/EmailPreviewPane.tsx",
  );
  assertStringIncludes(
    preview,
    'import { EMAIL_FOOTER_LINE } from "@mingla/brand-rendering/emailFooter";',
  );
  assertStringIncludes(preview, "{EMAIL_FOOTER_LINE}");
  assertEquals(preview.includes("previewReceiveReasonLine"), false);
  assertEquals(
    /receiving this/i.test(preview),
    false,
    "no hand-written copy of the line",
  );
  // The alias resolves to the same file in the app, its types and its tests.
  assertStringIncludes(
    read("mingla-business/tsconfig.json"),
    '"@mingla/brand-rendering/*": ["../packages/brand-rendering/*"]',
  );
  assertStringIncludes(
    read("mingla-business/jest.config.cjs"),
    '"^@mingla/brand-rendering/(.+)$": "<rootDir>/../packages/brand-rendering/$1"',
  );
});

Deno.test("#4226 no source file keeps the old sentence or a per-reason sentence", async () => {
  const offenders: string[] = [];
  const walk = async (dir: URL, rel: string) => {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        if (
          ["node_modules", "__tests__", "__mocks__", ".expo", "dist"].includes(
            entry.name,
          )
        ) {
          continue;
        }
        await walk(new URL(`${entry.name}/`, dir), `${rel}${entry.name}/`);
      } else if (
        /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ) {
        const text = Deno.readTextFileSync(new URL(entry.name, dir));
        if (`${rel}${entry.name}` === "supabase/functions/_shared/email/footerLine.ts") continue;
        if (
          text.includes(OLD_SENTENCE) ||
          /You(?:'|’)re receiving this (?:because|email)/.test(text)
        ) offenders.push(`${rel}${entry.name}`);
      }
    }
  };
  for (
    const rel of [
      "supabase/functions/",
      "mingla-business/src/",
      "mingla-business/app/",
    ]
  ) {
    await walk(new URL(rel, ROOT), rel);
  }
  assertEquals(
    offenders,
    [],
    "the line lives only in supabase/functions/_shared/email/footerLine.ts (and its parity-tested mirror)",
  );
});
