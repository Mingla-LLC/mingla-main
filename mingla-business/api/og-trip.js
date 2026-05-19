const {
  buildTripOgCardProps,
  fetchPublicTripById,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");

module.exports = async function tripOgHandler(req, res) {
  const tripId = firstQueryValue(req.query.tripId);

  try {
    const trip =
      typeof tripId === "string" ? await fetchPublicTripById(tripId) : null;
    const buffer = await renderOgPng(buildTripOgCardProps(trip));
    sendPng(res, buffer);
  } catch {
    const buffer = await renderOgPng({
      cardKind: "event",
      title: "Mingla trip",
      subtitle: "Discover trips on Mingla.",
      kicker: "Mingla Business",
      coverUrl: null,
      dateLabel: "Dates to be announced",
      locationLabel: "",
    });
    sendPng(res, buffer);
  }
};
