const { fetchSharedCardSnapshot, firstQueryValue, renderSharedCardHtml, renderNotFoundHtml, sendSharedHtml } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");

const createSharedCardHandler = (fetchSnapshot = fetchSharedCardSnapshot) => async function sharedCardHandler(req, res) {
  if (!hasValidSharedCardProxySecret(req)) return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  const shareId = firstQueryValue(req.query.shareId);
  if (typeof shareId !== "string") return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  try {
    const result = await fetchSnapshot(shareId);
    if (result.status === 410) return sendSharedHtml(res, renderNotFoundHtml("This shared card has expired"), 410);
    if ([429, 500, 503].includes(result.status)) return sendSharedHtml(res, renderNotFoundHtml("Shared card unavailable"), result.status);
    if (!result.snapshot) return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
    return sendSharedHtml(res, renderSharedCardHtml(result.snapshot, result.appUrl));
  } catch { return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404); }
};
module.exports = createSharedCardHandler();
module.exports.createSharedCardHandler = createSharedCardHandler;
