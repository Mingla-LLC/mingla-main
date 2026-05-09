const {
  fetchPublicEventBySlug,
  firstQueryValue,
  renderEventHtml,
  renderNotFoundHtml,
  sendHtml,
} = require("../server/socialPreview");

module.exports = async function publicEventHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const eventSlug = firstQueryValue(req.query.eventSlug);

  if (typeof brandSlug !== "string" || typeof eventSlug !== "string") {
    sendHtml(res, renderNotFoundHtml("Event not found"), 404);
    return;
  }

  try {
    const event = await fetchPublicEventBySlug(brandSlug, eventSlug);
    if (event === null) {
      sendHtml(res, renderNotFoundHtml("Event not found"), 404);
      return;
    }
    sendHtml(res, renderEventHtml(event));
  } catch {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Mingla public event preview could not load.");
  }
};
