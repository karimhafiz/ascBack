const { hashToken } = require("../../utils/tokenUtils");

jest.mock("../../models/VerificationToken");
const VerificationToken = require("../../models/VerificationToken");
const {
  issueVerificationToken,
  consumeVerificationToken,
} = require("../../utils/verificationTokenUtils");

describe("verificationTokenUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("issueVerificationToken", () => {
    it("should invalidate previous unused tokens for the same email + purpose", async () => {
      VerificationToken.deleteMany.mockResolvedValue({});
      VerificationToken.create.mockResolvedValue({});

      await issueVerificationToken({ email: "User@Test.com", purpose: "account_verification" });

      expect(VerificationToken.deleteMany).toHaveBeenCalledWith({
        email: "user@test.com",
        purpose: "account_verification",
        used: false,
      });
    });

    it("should store the hash of the returned token, not the raw token", async () => {
      VerificationToken.deleteMany.mockResolvedValue({});
      let stored;
      VerificationToken.create.mockImplementation((doc) => {
        stored = doc;
        return Promise.resolve(doc);
      });

      const rawToken = await issueVerificationToken({
        email: "user@test.com",
        purpose: "ticket_resend",
      });

      expect(typeof rawToken).toBe("string");
      expect(stored.tokenHash).toBe(hashToken(rawToken));
      expect(stored.tokenHash).not.toBe(rawToken);
      expect(stored.purpose).toBe("ticket_resend");
      expect(stored.expiresAt).toBeInstanceOf(Date);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("consumeVerificationToken", () => {
    it("should return null for a missing token", async () => {
      const result = await consumeVerificationToken({
        token: undefined,
        purpose: "account_verification",
      });
      expect(result).toBeNull();
      expect(VerificationToken.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("should look up by hash, unused, unexpired, and matching purpose, marking it used", async () => {
      VerificationToken.findOneAndUpdate.mockResolvedValue({ email: "user@test.com" });

      const result = await consumeVerificationToken({
        token: "raw-token-value",
        purpose: "ticket_resend",
      });

      expect(result).toBe("user@test.com");
      const [query, update] = VerificationToken.findOneAndUpdate.mock.calls[0];
      expect(query.tokenHash).toBe(hashToken("raw-token-value"));
      expect(query.purpose).toBe("ticket_resend");
      expect(query.used).toBe(false);
      expect(query.expiresAt.$gt).toBeInstanceOf(Date);
      expect(update).toEqual({ $set: { used: true } });
    });

    it("should return null when no matching, unused, unexpired token exists", async () => {
      VerificationToken.findOneAndUpdate.mockResolvedValue(null);

      const result = await consumeVerificationToken({
        token: "expired-or-wrong",
        purpose: "account_verification",
      });

      expect(result).toBeNull();
    });
  });
});
