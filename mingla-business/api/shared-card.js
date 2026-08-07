const { fetchSharedCardSnapshot, firstQueryValue, renderSharedCardHtml, renderNotFoundHtml, sendSharedHtml } = require("../server/socialPreview");
module.exports = async function sharedCardHandler(req, res) {
  const shareId = firstQueryValue(req.query.shareId);
  if (typeof shareId !== "string") return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  try {
    const result = await fetchSharedCardSnapshot(shareId);
    if (result.status === 410) return sendSharedHtml(res, renderNotFoundHtml("This shared card has expired"), 410);
    if (!result.snapshot) return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
    return sendSharedHtml(res, renderSharedCardHtml(result.snapshot, result.appUrl));
  } catch { return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404); }
};
