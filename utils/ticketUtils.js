const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1

function generateTicketCode() {
  let code = "TKT-";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Generates a unique ticket code by retrying until no collision is found.
 * Separated from the model so it can be tested in isolation and called
 * explicitly before save rather than hidden inside a pre-save hook.
 *
 * @param {import('mongoose').Model} TicketModel - The Ticket mongoose model
 * @returns {Promise<string>} A unique TKT-XXXXXX code
 */
async function generateUniqueTicketCode(TicketModel) {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateTicketCode();
    const exists = await TicketModel.exists({ ticketCode: code });
    if (!exists) return code;
  }
  throw new Error("Failed to generate unique ticket code after maximum attempts");
}

module.exports = { generateUniqueTicketCode };
