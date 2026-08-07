const { fetchSharedCardSnapshot, firstQueryValue, sendSharedPng, setSharedNoStore } = require("../server/socialPreview");
const { renderCardIdentityPng } = require("../server/cardIdentityRenderer");
const createSharedCardImageHandler = (fetchSnapshot = fetchSharedCardSnapshot, renderPng = renderCardIdentityPng) => async function sharedCardImageHandler(req, res) {
  setSharedNoStore(res);
  const shareId = firstQueryValue(req.query.shareId);
  const surface = firstQueryValue(req.query.surface) === "s4" ? "s4Snippet" : "s5Og";
  try {
    const result = typeof shareId === "string" ? await fetchSnapshot(shareId) : {};
    if (!result.snapshot || !result.snapshot.cover_url) { res.statusCode = result.status === 410 ? 410 : 404; return res.end(); }
    return sendSharedPng(res, await renderPng(result.snapshot, surface));
  } catch { res.statusCode = 404; return res.end(); }
};
module.exports = createSharedCardImageHandler();
module.exports.createSharedCardImageHandler = createSharedCardImageHandler;
