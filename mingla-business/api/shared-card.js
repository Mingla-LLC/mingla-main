const { fetchSharedCardSnapshot, fetchContentShare, firstQueryValue, renderSharedCardHtml, renderContentShareHtml, renderNotFoundHtml, sendSharedHtml } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");

const createSharedCardHandler = (fetchSnapshot = fetchSharedCardSnapshot, fetchCanonical = fetchContentShare) => async function sharedCardHandler(req, res) {
  if (!hasValidSharedCardProxySecret(req)) return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  const shareId = firstQueryValue(req.query.shareId);
  if (typeof shareId !== "string") return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
  try {
    const result = await fetchSnapshot(shareId);
    if (result.status === 410) return sendSharedHtml(res, renderNotFoundHtml("This shared card has expired"), 410);
    if ([429, 500, 503].includes(result.status)) return sendSharedHtml(res, renderNotFoundHtml("Shared card unavailable"), result.status);
    if (!result.snapshot) return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404);
    const aliasCode=/^https:\/\/usemingla\.com\/s\/([0-9A-Za-z]{16})$/.exec(result.canonicalUrl || "")?.[1];
    if(aliasCode){
      const canonical=await fetchCanonical(aliasCode);
      if(canonical.status===410)return sendSharedHtml(res,renderNotFoundHtml("This shared card has expired"),410);
      if(!canonical.contentShare)return sendSharedHtml(res,renderNotFoundHtml("Shared card unavailable"),canonical.status||503);
      return sendSharedHtml(res,renderContentShareHtml(canonical.contentShare,canonical.installAttribution));
    }
    return sendSharedHtml(res, renderSharedCardHtml(result.snapshot, result.appUrl, result.canonicalUrl));
  } catch { return sendSharedHtml(res, renderNotFoundHtml("Shared card not found"), 404); }
};
module.exports = createSharedCardHandler();
module.exports.createSharedCardHandler = createSharedCardHandler;
