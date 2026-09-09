/*
 * #3157 implementor happy-path regression for the post-pointer public
 * reachability check.
 *
 * These tests EXECUTE the real functions from the callback module against a
 * stubbed network and stubbed ports. The bug this guards against is a check
 * that certifies something it never tested, so nothing here asserts on source
 * text: every case drives the code and reads what it produced.
 */
import {
  extractPublishedArtifactDigest,
  observePublicHost,
  type PublicCheckPorts,
  type PublicHostObservation,
  recordPublicReachability,
} from "../../brand-site-cms-callback/index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PUBLICATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DIGEST = "a".repeat(64);

function ports(
  overrides: Partial<PublicCheckPorts> & {
    recorded?: Array<Record<string, unknown>>;
  } = {},
): PublicCheckPorts & { recorded: Array<Record<string, unknown>> } {
  const recorded = overrides.recorded ?? [];
  return {
    recorded,
    primaryHostname: overrides.primaryHostname ??
      (() => Promise.resolve("gogi.sites.usemingla.com")),
    observe: overrides.observe ??
      (() =>
        Promise.resolve({
          status_code: 200,
          observed_digest: DIGEST,
          reachable: true,
        })),
    record: overrides.record ?? ((args) => {
      recorded.push({ ...args });
      return Promise.resolve({
        ok: true,
        data: {
          reachable: args.reachable,
          status_code: args.statusCode,
          live_pointer_changed: false,
        },
      });
    }),
  };
}

Deno.test("#3157 the digest the public host served is read out of the page", () => {
  const html =
    `<html><body><div data-publication-id="x" data-artifact-digest="${DIGEST}" data-page="home">hi</div></body></html>`;
  assert(
    extractPublishedArtifactDigest(html) === DIGEST,
    "the served artifact digest was not extracted",
  );
  assert(
    extractPublishedArtifactDigest("<html><body>404</body></html>") === null,
    "a page with no digest claimed one",
  );
  assert(
    extractPublishedArtifactDigest('data-artifact-digest="not-a-digest"') ===
      null,
    "a malformed digest was accepted",
  );
});

Deno.test("#3157 a 404 from the public host is recorded, not swallowed", async () => {
  let requested = "";
  const observation = await observePublicHost(
    "gogi.sites.usemingla.com",
    (input) => {
      requested = String(input);
      return Promise.resolve(
        new Response("<html><body>NOT_FOUND</body></html>", { status: 404 }),
      );
    },
  );
  assert(
    requested === "https://gogi.sites.usemingla.com/",
    `the check did not request the public host: ${requested}`,
  );
  assert(observation.status_code === 404, "the 404 status was not recorded");
  assert(observation.reachable === false, "a 404 was reported reachable");
  assert(
    observation.observed_digest === null,
    "a 404 body produced a digest",
  );
});

Deno.test("#3157 a 200 serving the publication is recorded reachable", async () => {
  const observation = await observePublicHost(
    "gogi.sites.usemingla.com",
    () =>
      Promise.resolve(
        new Response(
          `<div data-artifact-digest="${DIGEST}"></div>`,
          { status: 200 },
        ),
      ),
  );
  assert(observation.status_code === 200, "the 200 status was not recorded");
  assert(observation.reachable === true, "a 200 was reported unreachable");
  assert(
    observation.observed_digest === DIGEST,
    "the served digest was not carried through",
  );
});

Deno.test("#3157 a network failure is an outage, not an exception", async () => {
  const observation = await observePublicHost(
    "gogi.sites.usemingla.com",
    () => Promise.reject(new TypeError("dns failure")),
  );
  assert(
    observation.status_code === null,
    "a failed connection invented a status code",
  );
  assert(observation.reachable === false, "a failed connection read reachable");
});

Deno.test("#3157 a hostname the contract rejects is never fetched", async () => {
  let called = false;
  const observation = await observePublicHost("http://evil.example/*", () => {
    called = true;
    return Promise.resolve(new Response("", { status: 200 }));
  });
  assert(!called, "a malformed hostname was fetched anyway");
  assert(
    observation.reachable === false && observation.status_code === null,
    "a malformed hostname was reported reachable",
  );
});

Deno.test("#3157 the observation reaches the recorder verbatim", async () => {
  const unreachable: PublicHostObservation = {
    status_code: 404,
    observed_digest: null,
    reachable: false,
  };
  const port = ports({ observe: () => Promise.resolve(unreachable) });
  const result = await recordPublicReachability(port, {
    siteId: SITE,
    operationId: OPERATION,
    publicationId: PUBLICATION,
  });
  assert(port.recorded.length === 1, "the observation was not recorded");
  const written = port.recorded[0];
  assert(written.siteId === SITE, "the recorded site is wrong");
  assert(written.operationId === OPERATION, "the recorded operation is wrong");
  assert(
    written.publicationId === PUBLICATION,
    "the recorded publication is wrong",
  );
  assert(written.statusCode === 404, "the recorded status is wrong");
  assert(written.reachable === false, "the recorded reachability is wrong");
  assert(written.observedDigest === null, "the recorded digest is wrong");
  assert(
    typeof written.observedAt === "string" &&
      !Number.isNaN(Date.parse(String(written.observedAt))),
    "the recorded observation time is not a timestamp",
  );
  assert(
    result !== null && result.live_pointer_changed === false,
    "the summary did not come back",
  );
});

Deno.test("#3157 a site with no public hostname records nothing and does not throw", async () => {
  const port = ports({ primaryHostname: () => Promise.resolve(null) });
  const result = await recordPublicReachability(port, {
    siteId: SITE,
    operationId: OPERATION,
    publicationId: PUBLICATION,
  });
  assert(result === null, "a hostless site produced a public check");
  assert(port.recorded.length === 0, "a hostless site recorded a check");
});

Deno.test("#3157 the publish is never failed by the check itself", async () => {
  for (
    const broken of [
      ports({
        primaryHostname: () => Promise.reject(new Error("db down")),
      }),
      ports({ observe: () => Promise.reject(new Error("fetch exploded")) }),
      ports({ record: () => Promise.reject(new Error("rpc down")) }),
      ports({ record: () => Promise.resolve({ ok: false, data: null }) }),
    ]
  ) {
    const result = await recordPublicReachability(broken, {
      siteId: SITE,
      operationId: OPERATION,
      publicationId: PUBLICATION,
    });
    assert(
      result === null,
      "a broken public check returned a summary instead of nothing",
    );
  }
});
