const { firstQueryValue, setSharedNoStore } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
// Stage 4 owns the immutable route and fail-closed boundary. Stage 5 supplies
// the exact portrait bytes without changing this public URL grammar.
module.exports = async function contentShareImage(req, res) {
  setSharedNoStore(res);
  const code = firstQueryValue(req.query.code);
  const version = firstQueryValue(req.query.version);
  if (!hasValidSharedCardProxySecret(req) || typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)
    || typeof version !== "string" || !/^[1-9][0-9]*$/.test(version)) { res.statusCode = 404; return res.end(); }
  res.statusCode = 404;
  return res.end();
};
