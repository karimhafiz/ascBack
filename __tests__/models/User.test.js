const User = require("../../models/User");

describe("User Model", () => {
  it("should validate a correct user", () => {
    const user = new User({
      name: "Test User",
      email: "test@example.com",
      password: "hashedPassword",
      authProvider: "local",
      role: "user",
    });

    const error = user.validateSync();
    expect(error).toBeUndefined();
  });

  it("should require name", () => {
    const user = new User({ email: "test@example.com" });
    const error = user.validateSync();
    expect(error.errors.name).toBeDefined();
  });

  it("should require email", () => {
    const user = new User({ name: "Test" });
    const error = user.validateSync();
    expect(error.errors.email).toBeDefined();
  });

  it("should not require password (Google users)", () => {
    const user = new User({
      name: "Google User",
      email: "google@example.com",
      googleId: "g123",
      authProvider: "google",
    });

    const error = user.validateSync();
    expect(error).toBeUndefined();
  });

  it("should default role to user", () => {
    const user = new User({ name: "Test", email: "t@t.com" });
    expect(user.role).toBe("user");
  });

  it("should default authProvider to local", () => {
    const user = new User({ name: "Test", email: "t@t.com" });
    expect(user.authProvider).toBe("local");
  });

  it("should reject invalid role", () => {
    const user = new User({ name: "Test", email: "t@t.com", role: "superadmin" });
    const error = user.validateSync();
    expect(error.errors.role).toBeDefined();
  });

  it("should reject invalid authProvider", () => {
    const user = new User({ name: "Test", email: "t@t.com", authProvider: "facebook" });
    const error = user.validateSync();
    expect(error.errors.authProvider).toBeDefined();
  });

  it("should default isActive to true and isBanned to false", () => {
    const user = new User({ name: "Test", email: "t@t.com" });
    expect(user.isActive).toBe(true);
    expect(user.isBanned).toBe(false);
  });
});
