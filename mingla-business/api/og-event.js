const {
  fetchPublicEventById,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");

module.exports = async function eventOgHandler(req, res) {
  const eventId = firstQueryValue(req.query.eventId);

  try {
    const event =
      typeof eventId === "string" ? await fetchPublicEventById(eventId) : null;
    const buffer = await renderOgPng({
      title: event?.title || "Mingla event",
      subtitle:
        event?.description ||
        (event?.brand_name
          ? `Hosted by ${event.brand_name}`
          : "Discover events on Mingla."),
      kicker: event?.brand_name || "Mingla Business",
      coverUrl:
        event?.cover_media_type === "video" ? null : event?.cover_media_url || null,
    });
    sendPng(res, buffer);
  } catch {
    const buffer = await renderOgPng({
      title: "Mingla event",
      subtitle: "Discover events on Mingla.",
      kicker: "Mingla Business",
      coverUrl: null,
    });
    sendPng(res, buffer);
  }
};
