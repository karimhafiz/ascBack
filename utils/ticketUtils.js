const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1

function generateCode(prefix) {
  let code = prefix + "-";
  for (let i = 0; i < 6; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

/**
 * Generates a unique human-readable code for any model.
 *
 * @param {string} prefix - e.g. "TKT", "ENR", "TEAM", "VBK"
 * @param {import('mongoose').Model} Model - The mongoose model to check uniqueness against
 * @param {string} field - The field name to check (e.g. "ticketCode", "enrollmentCode")
 * @returns {Promise<string>}
 */
async function generateUniqueCode(prefix, Model, field) {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateCode(prefix);
    const exists = await Model.exists({ [field]: code });
    if (!exists) return code;
  }
  throw new Error(`Failed to generate unique ${prefix} code after maximum attempts`);
}

// Legacy alias kept for existing ticket usage
async function generateUniqueTicketCode(TicketModel) {
  return generateUniqueCode("TKT", TicketModel, "ticketCode");
}

module.exports = { generateUniqueCode, generateUniqueTicketCode };
