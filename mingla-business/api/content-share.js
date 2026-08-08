const { fetchContentShare, firstQueryValue, renderContentShareHtml, renderNotFoundHtml, sendSharedHtml } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");

const createContentShareHandler = (fetchShare = fetchContentShare) => async function contentShareHandler(req, res) {
  if (!hasValidSharedCardProxySecret(req)) return sendSharedHtml(res, renderNotFoundHtml("Shared page not found"), 404);
  const code = firstQueryValue(req.query.code);
  if (typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)) return sendSharedHtml(res, renderNotFoundHtml("Shared page not found"), 404);
  try {
    const result = await fetchShare(code);
    if (result.status === 410) return sendSharedHtml(res, renderNotFoundHtml("This shared page is no longer available"), 410);
    if ([429, 500, 503].includes(result.status)) return sendSharedHtml(res, renderNotFoundHtml("Shared page unavailable"), result.status);
    if (!result.contentShare) return sendSharedHtml(res, renderNotFoundHtml("Shared page not found"), 404);
    return sendSharedHtml(res, renderContentShareHtml(result.contentShare, result.installAttribution));
  } catch { return sendSharedHtml(res, renderNotFoundHtml("Shared page not found"), 404); }
};
module.exports = createContentShareHandler();
module.exports.createContentShareHandler = createContentShareHandler;
