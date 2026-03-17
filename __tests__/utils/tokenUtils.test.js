const jwt = require("jsonwebtoken");
const {
  generateAccessToken,
  generateRefreshToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} = require("../../utils/tokenUtils");

describe("Token Utilities", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  describe("generateAccessToken", () => {
    it("should return a valid JWT", () => {
      const user = { _id: "user123", role: "user", name: "Test", email: "test@test.com" };
      const token = generateAccessToken(user);

      expect(typeof token).toBe("string");
      const decoded = jwt.verify(token, "test-secret");
      expect(decoded.id).toBe("user123");
      expect(decoded.role).toBe("user");
      expect(decoded.name).toBe("Test");
      expect(decoded.email).toBe("test@test.com");
    });

    it("should have 15m expiry", () => {
      const user = { _id: "user123", role: "user", name: "Test", email: "test@test.com" };
      const token = generateAccessToken(user);
      const decoded = jwt.verify(token, "test-secret");

      // exp - iat should be 900 seconds (15 minutes)
      expect(decoded.exp - decoded.iat).toBe(900);
    });
  });

  describe("generateRefreshToken", () => {
    it("should return a hex string", () => {
      const token = generateRefreshToken();
      expect(typeof token).toBe("string");
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it("should return 80-char token (40 bytes hex)", () => {
      const token = generateRefreshToken();
      expect(token.length).toBe(80);
    });

    it("should generate unique tokens", () => {
      const t1 = generateRefreshToken();
      const t2 = generateRefreshToken();
      expect(t1).not.toBe(t2);
    });
  });

  describe("setRefreshTokenCookie", () => {
    it("should set cookie with correct options in development", () => {
      delete process.env.NODE_ENV;
      const res = { cookie: jest.fn() };
      setRefreshTokenCookie(res, "test-token");

      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        "test-token",
        expect.objectContaining({
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
        })
      );
    });

    it("should set secure cookie in production", () => {
      process.env.NODE_ENV = "production";
      const res = { cookie: jest.fn() };
      setRefreshTokenCookie(res, "test-token");

      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        "test-token",
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: "none",
        })
      );
      delete process.env.NODE_ENV;
    });
  });

  describe("clearRefreshTokenCookie", () => {
    it("should clear the refresh token cookie", () => {
      const res = { clearCookie: jest.fn() };
      clearRefreshTokenCookie(res);

      expect(res.clearCookie).toHaveBeenCalledWith(
        "refreshToken",
        expect.objectContaining({
          httpOnly: true,
          path: "/",
        })
      );
    });
  });
});
