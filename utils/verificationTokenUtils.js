const crypto = require("crypto");
const VerificationToken = require("../models/VerificationToken");
const { hashToken } = require("./tokenUtils");

const TOKEN_TTL_MINUTES = 20;

/**
 * Issue a new single-use verification token for an email + purpose.
 * Invalidates any previous unused token for the same email + purpose first,
 * so only the most recently sent link ever works.
 * Returns the raw token — only the hash is persisted.
 */
async function issueVerificationToken({ email, purpose }) {
  const normalisedEmail = email.trim().toLowerCase();

  await VerificationToken.deleteMany({ email: normalisedEmail, purpose, used: false });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);

  await VerificationToken.create({
    email: normalisedEmail,
    tokenHash: hashToken(rawToken),
    purpose,
    expiresAt,
  });

  return rawToken;
}

/**
 * Validate and consume a token for a given purpose.
 * Returns the associated email on success, or null if the token is missing,
 * expired, already used, or for the wrong purpose.
 */
async function consumeVerificationToken({ token, purpose }) {
  if (!token || typeof token !== "string") return null;

  const record = await VerificationToken.findOneAndUpdate(
    {
      tokenHash: hashToken(token),
      purpose,
      used: false,
      expiresAt: { $gt: new Date() },
    },
    { $set: { used: true } }
  );

  return record ? record.email : null;
}

module.exports = { issueVerificationToken, consumeVerificationToken };
