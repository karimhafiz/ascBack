const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");

// Mock models
jest.mock("../../models/PageContentRequest");
jest.mock("../../models/PageContent");

// Mock auth middleware — role is mutable per test via mockCurrentUser
let mockCurrentUser = { id: "modId", role: "moderator" };
jest.mock("../../middleware/authMiddleware", () => (req, res, next) => {
  req.user = mockCurrentUser;
  next();
});

// Mock cloudinary util
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));

const PageContentRequest = require("../../models/PageContentRequest");
const PageContent = require("../../models/PageContent");
const { deleteCloudinaryImage } = require("../../utils/cloudinaryUtils");
const pageContentRequestRoutes = require("../../routes/pageContentRequests");

const validRequestId = new mongoose.Types.ObjectId().toString();

describe("Page Content Request Routes — Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { id: "modId", role: "moderator" };

    // Default: proposed content passes schema validation
    PageContent.mockImplementation(function () {
      this.validateSync = jest.fn(() => undefined);
    });

    app = express();
    app.use(express.json());
    app.use("/api/pageContentRequests", pageContentRequestRoutes);
  });

  // ─── POST /:page ─────────────────────────────────────────────────────────

  describe("POST /api/pageContentRequests/:page", () => {
    it("creates a pending request for a moderator", async () => {
      PageContentRequest.create.mockResolvedValue({
        _id: validRequestId,
        page: "home",
        status: "pending",
      });

      const res = await request(app)
        .post("/api/pageContentRequests/home")
        .send({ heroTitle: "Proposed title" });

      expect(res.status).toBe(201);
      expect(PageContentRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          page: "home",
          requestedBy: "modId",
          status: "pending",
        })
      );
    });

    it("rejects an invalid page", async () => {
      const res = await request(app)
        .post("/api/pageContentRequests/bogus")
        .send({ heroTitle: "x" });

      expect(res.status).toBe(400);
      expect(PageContentRequest.create).not.toHaveBeenCalled();
    });

    it("returns 400 when proposed content fails schema validation", async () => {
      PageContent.mockImplementation(function () {
        this.validateSync = jest.fn(() => ({ message: "activityCards.0.title: Path required" }));
      });

      const res = await request(app)
        .post("/api/pageContentRequests/about")
        .send({ activityCards: [{}] });

      expect(res.status).toBe(400);
      expect(PageContentRequest.create).not.toHaveBeenCalled();
    });

    it("rejects admin users (moderator-only route)", async () => {
      mockCurrentUser = { id: "adminId", role: "admin" };

      const res = await request(app).post("/api/pageContentRequests/home").send({ heroTitle: "x" });

      expect(res.status).toBe(403);
    });

    it("rejects regular users", async () => {
      mockCurrentUser = { id: "userId", role: "user" };

      const res = await request(app).post("/api/pageContentRequests/home").send({ heroTitle: "x" });

      expect(res.status).toBe(403);
    });
  });

  // ─── GET / ───────────────────────────────────────────────────────────────

  describe("GET /api/pageContentRequests", () => {
    function mockRequestsQuery(requests) {
      PageContentRequest.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            sort: jest.fn().mockResolvedValue(requests),
          }),
        }),
      });
    }

    it("scopes to only the moderator's own requests", async () => {
      mockRequestsQuery([
        {
          _id: validRequestId,
          page: "home",
          status: "pending",
          requestedBy: "modId",
          createdAt: new Date("2026-01-01"),
          toObject() {
            return { ...this };
          },
        },
      ]);
      PageContent.find.mockResolvedValue([]);

      const res = await request(app).get("/api/pageContentRequests");

      expect(res.status).toBe(200);
      expect(PageContentRequest.find).toHaveBeenCalledWith({ requestedBy: "modId" });
    });

    it("shows all requests for admins", async () => {
      mockCurrentUser = { id: "adminId", role: "admin" };
      mockRequestsQuery([]);
      PageContent.find.mockResolvedValue([]);

      const res = await request(app).get("/api/pageContentRequests");

      expect(res.status).toBe(200);
      expect(PageContentRequest.find).toHaveBeenCalledWith({});
    });

    it("flags a pending request as stale when the live page changed since it was drafted", async () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      mockRequestsQuery([
        {
          _id: validRequestId,
          page: "home",
          status: "pending",
          createdAt,
          toObject() {
            return {
              _id: this._id,
              page: this.page,
              status: this.status,
              createdAt: this.createdAt,
            };
          },
        },
      ]);
      PageContent.find.mockResolvedValue([
        { page: "home", updatedAt: new Date("2026-01-02T00:00:00.000Z") },
      ]);

      const res = await request(app).get("/api/pageContentRequests");

      expect(res.body[0].stale).toBe(true);
    });

    it("does not flag an already-reviewed request as stale", async () => {
      const createdAt = new Date("2026-01-01T00:00:00.000Z");
      mockRequestsQuery([
        {
          _id: validRequestId,
          page: "home",
          status: "approved",
          createdAt,
          toObject() {
            return {
              _id: this._id,
              page: this.page,
              status: this.status,
              createdAt: this.createdAt,
            };
          },
        },
      ]);
      PageContent.find.mockResolvedValue([
        { page: "home", updatedAt: new Date("2026-01-02T00:00:00.000Z") },
      ]);

      const res = await request(app).get("/api/pageContentRequests");

      expect(res.body[0].stale).toBe(false);
    });
  });

  // ─── PATCH /:id/approve ──────────────────────────────────────────────────

  describe("PATCH /api/pageContentRequests/:id/approve", () => {
    beforeEach(() => {
      mockCurrentUser = { id: "adminId", role: "admin" };
    });

    it("applies the proposed content and marks the request approved", async () => {
      const save = jest.fn().mockResolvedValue(true);
      PageContentRequest.findById.mockResolvedValue({
        _id: validRequestId,
        page: "home",
        status: "pending",
        proposedContent: { heroTitle: "New" },
        newImages: [],
        save,
      });
      PageContent.findOne.mockResolvedValue({ page: "home", heroImageId: null });
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "home", heroTitle: "New" });

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/approve`);

      expect(res.status).toBe(200);
      expect(PageContent.findOneAndUpdate).toHaveBeenCalledWith(
        { page: "home" },
        { $set: { heroTitle: "New" } },
        { new: true, upsert: true, runValidators: true }
      );
      expect(save).toHaveBeenCalled();
    });

    it("deletes the replaced hero image after a successful update", async () => {
      const save = jest.fn().mockResolvedValue(true);
      PageContentRequest.findById.mockResolvedValue({
        _id: validRequestId,
        page: "home",
        status: "pending",
        proposedContent: { heroTitle: "New" },
        newImages: [{ field: "heroImage" }],
        save,
      });
      PageContent.findOne.mockResolvedValue({ page: "home", heroImageId: "old_hero_id" });
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "home" });

      await request(app).patch(`/api/pageContentRequests/${validRequestId}/approve`);

      expect(deleteCloudinaryImage).toHaveBeenCalledWith("old_hero_id");
    });

    it("returns 404 for a nonexistent request", async () => {
      PageContentRequest.findById.mockResolvedValue(null);

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/approve`);

      expect(res.status).toBe(404);
    });

    it("returns 400 for an already-reviewed request", async () => {
      PageContentRequest.findById.mockResolvedValue({ status: "approved" });

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/approve`);

      expect(res.status).toBe(400);
    });

    it("returns 400 for a malformed id", async () => {
      const res = await request(app).patch("/api/pageContentRequests/not-an-id/approve");

      expect(res.status).toBe(400);
      expect(PageContentRequest.findById).not.toHaveBeenCalled();
    });

    it("rejects moderators (admin-only route)", async () => {
      mockCurrentUser = { id: "modId", role: "moderator" };

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/approve`);

      expect(res.status).toBe(403);
      expect(PageContentRequest.findById).not.toHaveBeenCalled();
    });
  });

  // ─── PATCH /:id/decline ──────────────────────────────────────────────────

  describe("PATCH /api/pageContentRequests/:id/decline", () => {
    beforeEach(() => {
      mockCurrentUser = { id: "adminId", role: "admin" };
    });

    it("marks the request declined and stores the reason", async () => {
      const save = jest.fn().mockResolvedValue(true);
      const req = {
        _id: validRequestId,
        status: "pending",
        newImages: [],
        save,
      };
      PageContentRequest.findById.mockResolvedValue(req);

      const res = await request(app)
        .patch(`/api/pageContentRequests/${validRequestId}/decline`)
        .send({ reason: "Not a good fit" });

      expect(res.status).toBe(200);
      expect(req.declineReason).toBe("Not a good fit");
      expect(req.status).toBe("declined");
      expect(save).toHaveBeenCalled();
    });

    it("deletes staged images that never went live", async () => {
      const save = jest.fn().mockResolvedValue(true);
      PageContentRequest.findById.mockResolvedValue({
        _id: validRequestId,
        status: "pending",
        newImages: [{ publicId: "staged_id_1" }, { publicId: "staged_id_2" }],
        save,
      });

      await request(app).patch(`/api/pageContentRequests/${validRequestId}/decline`);

      expect(deleteCloudinaryImage).toHaveBeenCalledWith("staged_id_1");
      expect(deleteCloudinaryImage).toHaveBeenCalledWith("staged_id_2");
    });

    it("returns 400 for an already-reviewed request", async () => {
      PageContentRequest.findById.mockResolvedValue({ status: "declined" });

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/decline`);

      expect(res.status).toBe(400);
    });

    it("rejects moderators (admin-only route)", async () => {
      mockCurrentUser = { id: "modId", role: "moderator" };

      const res = await request(app).patch(`/api/pageContentRequests/${validRequestId}/decline`);

      expect(res.status).toBe(403);
    });
  });
});
