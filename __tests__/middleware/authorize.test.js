const authorize = require("../../middleware/authorize");

describe("authorize middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: { role: "user" } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("should call next if user role is allowed", () => {
    const middleware = authorize("user", "admin");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 403 if user role is not allowed", () => {
    const middleware = authorize("admin", "moderator");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Access denied" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow admin access to admin-only route", () => {
    req.user.role = "admin";
    const middleware = authorize("admin");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should allow moderator access to moderator+admin route", () => {
    req.user.role = "moderator";
    const middleware = authorize("admin", "moderator");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("should deny regular user from admin-only route", () => {
    req.user.role = "user";
    const middleware = authorize("admin");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
