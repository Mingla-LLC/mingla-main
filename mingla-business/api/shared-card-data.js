const { fetchSharedCardSnapshot, firstQueryValue, setSharedNoStore } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");

const sendJson = (res, body, status) => {
  setSharedNoStore(res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(body));
};

const createSharedCardDataHandler = (fetchSnapshot = fetchSharedCardSnapshot) => async function sharedCardDataHandler(req, res) {
  if (!hasValidSharedCardProxySecret(req)) return sendJson(res, { error: "not_found" }, 404);
  const shareId = firstQueryValue(req.query.shareId);
  if (typeof shareId !== "string") return sendJson(res, { error: "not_found" }, 404);
  try {
    const result = await fetchSnapshot(shareId);
    if (result.status === 410) return sendJson(res, { error: "gone" }, 410);
    if (!result.snapshot) {
      const status = [429, 500, 503].includes(result.status) ? result.status : 404;
      return sendJson(res, { error: status === 404 ? "not_found" : "unavailable" }, status);
    }
    return sendJson(res, { snapshot: result.snapshot, appUrl: result.appUrl }, 200);
  } catch {
    return sendJson(res, { error: "not_found" }, 404);
  }
};

module.exports = createSharedCardDataHandler();
module.exports.createSharedCardDataHandler = createSharedCardDataHandler;
