const { fetchSharedCardSnapshot, firstQueryValue, renderSharedCardHtml, renderNotFoundHtml, sendHtml } = require("../server/socialPreview");
module.exports = async function sharedCardHandler(req, res) {
  const shareId = firstQueryValue(req.query.shareId);
  if (typeof shareId !== "string") return sendHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  try {
    const result = await fetchSharedCardSnapshot(shareId);
    if (result.status === 410) return sendHtml(res, renderNotFoundHtml("This shared card has expired"), 410);
    if (!result.snapshot) return sendHtml(res, renderNotFoundHtml("Shared card not found"), 404);
    return sendHtml(res, renderSharedCardHtml(result.snapshot, result.appUrl));
  } catch { return sendHtml(res, renderNotFoundHtml("Shared card not found"), 404); }
};
