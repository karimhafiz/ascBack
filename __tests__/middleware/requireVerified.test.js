const requireVerified = require("../../middleware/requireVerified");

describe("requireVerified middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { user: { isVerified: true } };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("should call next if the user is verified", () => {
    requireVerified(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should return 403 if the user is not verified", () => {
    req.user.isVerified = false;
    requireVerified(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Please verify your email before continuing",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 if there is no authenticated user", () => {
    req.user = null;
    requireVerified(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
