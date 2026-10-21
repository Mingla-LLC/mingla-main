const { handleTicketLinkDocument } = require("../server/ticketLinkDocument");

module.exports = async function ticketLinkHandler(req, res) {
  return handleTicketLinkDocument(req, res);
};
