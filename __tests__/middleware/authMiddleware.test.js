const jwt = require("jsonwebtoken");
const authMiddleware = require("../../middleware/authMiddleware");

describe("authMiddleware middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("should return 401 if token is missing", () => {
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Token is missing" });
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 403 if token is invalid", () => {
    req.headers["authorization"] = "Bearer invalidtoken";
    jest.spyOn(jwt, "verify").mockImplementation(() => {
      throw new Error("Invalid token");
    });
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid token" });
    expect(next).not.toHaveBeenCalled();
    jwt.verify.mockRestore();
  });

  it("should call next and attach decoded token if valid", () => {
    req.headers["authorization"] = "Bearer validtoken";
    const decoded = { id: "123" };
    jest.spyOn(jwt, "verify").mockReturnValue(decoded);
    authMiddleware(req, res, next);
    expect(req.user).toEqual(decoded);
    expect(next).toHaveBeenCalled();
    jwt.verify.mockRestore();
  });
});
