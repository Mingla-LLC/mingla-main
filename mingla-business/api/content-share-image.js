const { fetchContentShareVersion, firstQueryValue, setSharedNoStore } = require("../server/socialPreview");
const { isValidContentSharePortraitJpeg, renderContentSharePortraitJpeg } = require("../server/cardIdentityRenderer");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const setImmutableJpegHeaders = (res, etag) => {
  res.setHeader("content-type", "image/jpeg");
  res.setHeader("etag", etag);
  res.setHeader("cache-control", IMMUTABLE_CACHE);
  res.setHeader("cdn-cache-control", IMMUTABLE_CACHE);
  res.setHeader("vercel-cdn-cache-control", IMMUTABLE_CACHE);
};
const failClosed = (res, statusCode) => {
  setSharedNoStore(res);
  res.statusCode = statusCode;
  return res.end();
};
const createContentShareImageHandler = (fetchShare = fetchContentShareVersion, renderJpeg = renderContentSharePortraitJpeg) => async function contentShareImage(req, res) {
  const code = firstQueryValue(req.query.code);
  const version = firstQueryValue(req.query.version);
  if (!hasValidSharedCardProxySecret(req) || typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)
    || typeof version !== "string" || !/^[1-9][0-9]*$/.test(version)) return failClosed(res, 404);
  try {
    const result = await fetchShare(code, Number(version));
    if (result.status === 410) return failClosed(res, 410);
    if ([429, 500, 502, 503].includes(result.status)) return failClosed(res, result.status === 429 ? 503 : result.status);
    const share = result.contentShare;
    /**
     * #2589 — a coverless share is no longer a 404.
     *
     * This line used to demand a usable poster before the renderer was allowed
     * to run, so every offering without one served nothing at all. The renderer
     * now composes a card from the offering's own facts when there is no usable
     * cover, so the only remaining 404 conditions are the two that are genuinely
     * unanswerable: the share does not exist, or the requested version has
     * drifted from the current one.
     */
    if (!share || Number(share.version) !== Number(version)) return failClosed(res, 404);
    const etag = `"content-share-${code}-v${version}-r2-jpeg"`;
    if (req.headers?.["if-none-match"] === etag) {
      res.statusCode = 304;
      setImmutableJpegHeaders(res, etag);
      return res.end();
    }
    const jpeg = await renderJpeg(share);
    if (!(await isValidContentSharePortraitJpeg(jpeg))) return failClosed(res, 502);
    res.statusCode = 200;
    setImmutableJpegHeaders(res, etag);
    return res.end(jpeg);
  } catch { return failClosed(res, 502); }
};
module.exports = createContentShareImageHandler();
module.exports.createContentShareImageHandler = createContentShareImageHandler;
