const {
  buildEventOgCardProps,
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
    const buffer = await renderOgPng(buildEventOgCardProps(event));
    sendPng(res, buffer);
  } catch {
    const buffer = await renderOgPng({
      cardKind: "event",
      title: "Mingla event",
      subtitle: "Discover events on Mingla.",
      kicker: "Mingla Business",
      coverUrl: null,
      dateLabel: "Date to be announced",
      locationLabel: "",
    });
    sendPng(res, buffer);
  }
};
