const { fetchSharedCardSnapshot, firstQueryValue, sendSharedPng, setSharedNoStore } = require("../server/socialPreview");
const { renderCardIdentityPng } = require("../server/cardIdentityRenderer");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
const createSharedCardImageHandler = (fetchSnapshot = fetchSharedCardSnapshot, renderPng = renderCardIdentityPng) => async function sharedCardImageHandler(req, res) {
  setSharedNoStore(res);
  const shareId = firstQueryValue(req.query.shareId);
  const surface = firstQueryValue(req.query.surface) === "s4" ? "s4Snippet" : "s5Og";
  try {
    const result = typeof shareId === "string" ? await fetchSnapshot(shareId) : {};
    if (!result.snapshot || !result.snapshot.cover_url) {
      res.statusCode = [410, 429, 500, 503].includes(result.status) ? result.status : 404;
      return res.end();
    }
    return sendSharedPng(res, await renderPng(result.snapshot, surface));
  } catch { res.statusCode = 404; return res.end(); }
};
const createProtectedSharedCardImageHandler = (inner = createSharedCardImageHandler()) => async function protectedSharedCardImageHandler(req, res) {
  setSharedNoStore(res);
  if (!hasValidSharedCardProxySecret(req)) { res.statusCode = 404; return res.end(); }
  return inner(req, res);
};
module.exports = createProtectedSharedCardImageHandler();
module.exports.createSharedCardImageHandler = createSharedCardImageHandler;
module.exports.createProtectedSharedCardImageHandler = createProtectedSharedCardImageHandler;
