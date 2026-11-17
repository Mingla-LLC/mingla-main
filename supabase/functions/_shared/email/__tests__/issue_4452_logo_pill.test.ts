// #4452 B17: the email logo is a PILL (white wordmark on a rounded orange pill), not the
// square app icon. FAILS-ON-REVERT: pointing LOGO_PILL_URL back at the square icon fails here.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("DENO_TESTING", "1");
const { LOGO_PILL_URL, renderShell } = await import("../shell.ts");

Deno.test("LOGO_PILL_URL is the pill file, it exists, and it is wide (ratio >= 2.5)", async () => {
  assert(LOGO_PILL_URL.endsWith("/brand/mingla-logo-pill.png"), LOGO_PILL_URL);
  const file = new URL("../../../../../mingla-marketing/public/brand/mingla-logo-pill.png", import.meta.url);
  const png = await Deno.readFile(file);
  assertEquals([...png.slice(1, 4)], [80, 78, 71], "a PNG");
  const dv = new DataView(png.buffer, png.byteOffset);
  const w = dv.getUint32(16), h = dv.getUint32(20);
  assert(w / h >= 2.5, `pill is ${w}x${h}, ratio ${(w / h).toFixed(2)}`);
});

Deno.test("shell <img> carries an explicit height matching the pill ratio (Outlook)", () => {
  const src = Deno.readTextFileSync(new URL("../shell.ts", import.meta.url));
  assert(/width="96" height="38"/.test(src) && /width="64" height="25"/.test(src));
  assert(typeof renderShell === "function");
});
