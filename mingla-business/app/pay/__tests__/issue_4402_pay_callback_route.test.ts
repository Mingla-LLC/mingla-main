/**
 * #4402 — /pay/callback no longer lands a paying host on the installment
 * pay-link error page.
 *
 * fails-on-revert: deleting app/pay/callback.tsx sends `/pay/callback` back
 * to `[token].tsx` with token "callback" ("Something went wrong") and every
 * test here fails at the read.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE = join(__dirname, "..", "callback.tsx");
const SERVER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "functions",
  "_shared",
  "gigPaymentCapture.ts",
);

describe("#4402 /pay/callback", () => {
  const source = readFileSync(ROUTE, "utf8");

  it("is a static route beside [token] so it wins the match", () => {
    expect(existsSync(ROUTE)).toBe(true);
    expect(existsSync(join(__dirname, "..", "[token].tsx"))).toBe(true);
    expect(source).toMatch(/export default function PayCallback/);
  });

  it("recognises exactly the server's gig references", () => {
    const match = /const GIG_REFERENCE = (\/.+\/);/.exec(source);
    expect(match).not.toBeNull();
    const pattern = new RegExp(match![1].slice(1, -1));
    expect(pattern.test("ghold_6de5eb408f30444e83b8d80fa32b3798_v1")).toBe(true);
    expect(pattern.test("gtop_6de5eb408f30444e83b8d80fa32b3798_v2")).toBe(true);
    expect(pattern.test("mingla_vo_6de5eb408f30444e83b8d80fa32b3798")).toBe(false);
    expect(pattern.test("ghold_6de5eb40-8f30-444e-83b8-d80fa32b3798_v1")).toBe(false);
    const server = readFileSync(SERVER, "utf8");
    // Same body as the server parser, without its capture groups.
    expect(server.replace(/[()]/g, "")).toContain(
      match![1].replace(/[()]/g, "").replace(/^\//, "").replace(/\/$/, ""),
    );
  });

  it("routes a gig reference to its contract with the reference kept", () => {
    expect(source).toContain('action: "confirm_reference", reference');
    expect(source).toMatch(/\/brand\/\$\{brandId\}\/creators\/contract\/\$\{contractId\}\?reference=\$\{encodeURIComponent\(reference\)\}/);
    expect(source).toContain("router.replace(");
  });

  it("never tells the payer the payment failed, and stays anon-tolerant and lazy", () => {
    const rendered = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(rendered).not.toMatch(/failed|went wrong|couldn't/i);
    expect(rendered).toContain("Payment received. You can close this tab.");
    expect(rendered).not.toMatch(/useAuth/);
    // gigHireService lives in the lazy creator-program chunk; importing it
    // here would hoist it into the boot chunk.
    expect(source).not.toMatch(/gigHireService"/);
  });
});
