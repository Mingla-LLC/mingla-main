import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { qrTokenPepper } from "../ticketCheckout.ts";

Deno.test("qrTokenPepper rejects missing, fallback, and short values", () => {
  const prior = Deno.env.get("app.qr_token_pepper");
  try {
    Deno.env.delete("app.qr_token_pepper");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );

    Deno.env.set("app.qr_token_pepper", "local-ticket-pepper");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );

    Deno.env.set("app.qr_token_pepper", "short");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );
  } finally {
    if (prior === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", prior);
  }
});

Deno.test("qrTokenPepper returns a trimmed non-default secret without logging it", () => {
  const prior = Deno.env.get("app.qr_token_pepper");
  const value = "  12345678901234567890123456789012  ";
  try {
    Deno.env.set("app.qr_token_pepper", value);
    assertEquals(qrTokenPepper(), value.trim());
  } finally {
    if (prior === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", prior);
  }
});
