// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4430 L-1 — every code local_review_submit raises has words in the app, and
// the review link rule matches the server's.
//
// FAILS-ON-REVERT: removing a review code from MESSAGES in programResult.ts
// (the screen showed "Something went wrong"), or going back to the old
// "any https link" check in app/local/review.tsx, fails here.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { programErrorMessage, toProgramError } from "../programResult.ts";
import { isAllowedSocialPostUrl } from "../../components/local/localReviewRules.ts";

const root = new URL("../../../../", import.meta.url);
const FALLBACK = programErrorMessage("__no_such_code__");

/** The latest local_review_submit body in the migrations, by file order. */
function latestReviewSubmitBody(): string {
  const dir = new URL("supabase/migrations/", root);
  const files = [...Deno.readDirSync(dir)].filter((e) =>
    e.isFile && e.name.endsWith(".sql")
  ).map((e) => e.name).sort();
  let body = "";
  for (const name of files) {
    const text = Deno.readTextFileSync(new URL(name, dir));
    const start = text.lastIndexOf("FUNCTION public.local_review_submit(");
    if (start < 0) continue;
    const end = text.indexOf("$function$;", start) >= 0 &&
        (text.indexOf("$fn$;", start) < 0 ||
          text.indexOf("$function$;", start) < text.indexOf("$fn$;", start))
      ? text.indexOf("$function$;", start)
      : text.indexOf("$fn$;", start);
    body = text.slice(start, end);
  }
  return body;
}

Deno.test("#4430 L-1: every code local_review_submit raises has app words", () => {
  const body = latestReviewSubmitBody();
  const codes = [
    ...new Set(
      [...body.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].map((m) => m[1]),
    ),
  ];
  assert(
    codes.length >= 4,
    `expected the review codes, found ${codes.join(",")}`,
  );
  for (const code of codes) {
    assert(
      programErrorMessage(code) !== FALLBACK,
      `${code} falls back to "Something went wrong"`,
    );
  }
  // A raised error maps to the code and its words.
  const mapped = toProgramError({
    message: "social_post_url_not_allowed",
    code: "22023",
  });
  assertEquals(mapped.code, "social_post_url_not_allowed");
  assertEquals(
    mapped.message,
    "Paste the link to your public post on Instagram, TikTok, YouTube, Facebook, Threads or X.",
  );
});

Deno.test("#4430 L-1: the link rule accepts the eight hosts and refuses the rest", () => {
  const hosts = [
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "youtu.be",
    "x.com",
    "twitter.com",
    "facebook.com",
    "threads.net",
  ];
  for (const host of hosts) {
    for (const prefix of ["", "www.", "m.", "vm."]) {
      assert(
        isAllowedSocialPostUrl(`https://${prefix}${host}/p/abc123`),
        `${prefix}${host}`,
      );
    }
  }
  assert(
    isAllowedSocialPostUrl("  https://www.instagram.com/reel/TEST4430local/  "),
    "trimmed like the service",
  );
  assert(
    isAllowedSocialPostUrl("HTTPS://WWW.TIKTOK.COM/@ada/video/1"),
    "case-insensitive",
  );
  for (
    const bad of [
      "https://instagram.com",
      "https://instagram.com/",
      "https://example.com/x",
      "http://instagram.com/p/abc",
      "https://instagram.com/p/a b",
      "https://notinstagram.com/p/a",
      "",
      null,
    ]
  ) {
    assertEquals(isAllowedSocialPostUrl(bad), false, String(bad));
  }
});

Deno.test("#4430 L-1: the review screen uses the shared rule and puts a refusal on the link field", () => {
  const screen = Deno.readTextFileSync(
    new URL("app-mobile/app/local/review.tsx", root),
  );
  assert(
    screen.includes("isAllowedSocialPostUrl(link)"),
    "linkOk uses the shared rule",
  );
  assert(
    !/\/\^https:\\\/\\\/\\S\+\\\.\\S\+\/i/.test(screen),
    "the old any-https check is gone",
  );
  assert(
    screen.includes("refused.code === 'social_post_url_not_allowed'"),
    "a server refusal lands on the link field",
  );
  const api = Deno.readTextFileSync(
    new URL("app-mobile/src/services/programApi.ts", root),
  );
  assert(
    /console\.warn\(`\[\$\{kind\}\]`, name, mapped\.code, sqlState\)/.test(api),
    "a refused call logs its name and codes only",
  );
});
