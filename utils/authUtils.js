/**
 * Returns true if the requesting user is admin or moderator.
 * @param {object} user - req.user from authMiddleware
 */
function isStaff(user) {
  return user.role === "admin" || user.role === "moderator";
}

/**
 * Returns true if the requesting user owns a ticket (matched by email or user ID).
 * @param {object} user - req.user from authMiddleware
 * @param {object} ticket - populated Ticket document
 */
function isTicketOwner(user, ticket) {
  return ticket.buyerEmail === user.email || ticket.user?._id?.toString() === user.id;
}

module.exports = { isStaff, isTicketOwner };
