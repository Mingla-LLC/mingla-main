const { requestRpcJson } = require("../server/supabaseRpc");

const firstHeader = (value) => Array.isArray(value) ? value[0] : value;

const requestCountry = (req) => {
  const value = firstHeader(
    req?.headers?.["x-vercel-ip-country"] || req?.headers?.["cf-ipcountry"],
  );
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(country) ? country : null;
};

module.exports = async function adPixelConfigHandler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const config = await requestRpcJson("ad_pixel_public_config", {
      p_country_code: requestCountry(req),
    });
    const mode = config?.ad_pixel_consent_mode === "opt_in"
      ? "opt_in"
      : "on_arrival";
    res.statusCode = 200;
    res.end(JSON.stringify({ ad_pixel_consent_mode: mode }));
  } catch {
    // Seth's approved global default is on_arrival. A read failure cannot
    // silently convert that product decision into a different market policy.
    res.statusCode = 200;
    res.end(JSON.stringify({ ad_pixel_consent_mode: "on_arrival" }));
  }
};

module.exports.requestCountry = requestCountry;
