const { fetchContentShare, firstQueryValue, setSharedNoStore } = require("../server/socialPreview");
const { renderContentSharePortraitPng } = require("../server/cardIdentityRenderer");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
const createContentShareImageHandler = (fetchShare = fetchContentShare, renderPng = renderContentSharePortraitPng) => async function contentShareImage(req, res) {
  setSharedNoStore(res);
  const code = firstQueryValue(req.query.code);
  const version = firstQueryValue(req.query.version);
  if (!hasValidSharedCardProxySecret(req) || typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)
    || typeof version !== "string" || !/^[1-9][0-9]*$/.test(version)) { res.statusCode = 404; return res.end(); }
  try {
    const result = await fetchShare(code);
    const share = result.contentShare;
    if (!share || Number(share.version) !== Number(version)) { res.statusCode = 404; return res.end(); }
    const png = await renderPng(share);
    res.statusCode = 200;
    res.setHeader("content-type", "image/png");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    return res.end(png);
  } catch { res.statusCode = 404; return res.end(); }
};
module.exports = createContentShareImageHandler();
module.exports.createContentShareImageHandler = createContentShareImageHandler;
