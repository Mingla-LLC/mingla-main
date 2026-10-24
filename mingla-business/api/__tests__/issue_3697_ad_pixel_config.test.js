const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const HANDLER = "../ad-pixel-config.js";

const load = (rpcImpl) => {
  const handlerKey = require.resolve(HANDLER);
  delete require.cache[handlerKey];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "../server/supabaseRpc") return { requestRpcJson: rpcImpl };
    return original.apply(this, arguments);
  };
  try {
    return require(HANDLER);
  } finally {
    Module._load = original;
  }
};

const response = () => ({
  statusCode: 0,
  headers: {},
  body: "",
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
  end(body) { this.body = body; },
});

test("#3697 pixel config normalizes the edge country and returns opt_in", async () => {
  let seen = null;
  const handler = load(async (name, body) => {
    seen = { name, body };
    return { ad_pixel_consent_mode: "opt_in" };
  });
  const res = response();
  await handler({ headers: { "x-vercel-ip-country": " gb " } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { ad_pixel_consent_mode: "opt_in" });
  assert.deepEqual(seen, {
    name: "ad_pixel_public_config",
    body: { p_country_code: "GB" },
  });
});

test("#3697 missing, malformed and failed config reads fail to approved on_arrival", async () => {
  for (const headers of [{}, { "cf-ipcountry": "UK1" }]) {
    let country = "not-called";
    const handler = load(async (_name, body) => {
      country = body.p_country_code;
      return { ad_pixel_consent_mode: "unexpected" };
    });
    const res = response();
    await handler({ headers }, res);
    assert.equal(country, null);
    assert.deepEqual(JSON.parse(res.body), { ad_pixel_consent_mode: "on_arrival" });
  }

  const failed = load(async () => { throw new Error("db unavailable"); });
  const res = response();
  await failed({ headers: { "cf-ipcountry": "FR" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ad_pixel_consent_mode: "on_arrival" });
});
