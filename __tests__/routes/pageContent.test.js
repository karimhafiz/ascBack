const request = require("supertest");
const express = require("express");

// Mock models
jest.mock("../../models/PageContent");

// Mock auth middleware — role is mutable per test via mockCurrentUser
let mockCurrentUser = { id: "adminId", role: "admin" };
jest.mock("../../middleware/authMiddleware", () => (req, res, next) => {
  req.user = mockCurrentUser;
  next();
});

// Mock cloudinary util
jest.mock("../../utils/cloudinaryUtils", () => ({
  deleteCloudinaryImage: jest.fn().mockResolvedValue(true),
}));

const PageContent = require("../../models/PageContent");
const { deleteCloudinaryImage } = require("../../utils/cloudinaryUtils");
const pageContentRoutes = require("../../routes/pageContent");
const pageContentController = require("../../controllers/pageContentController");

describe("Page Content Routes — Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = { id: "adminId", role: "admin" };

    app = express();
    app.use(express.json());
    app.use("/api/pageContent", pageContentRoutes);
  });

  // ─── GET /:page ──────────────────────────────────────────────────────────

  describe("GET /api/pageContent/:page", () => {
    it("returns the page content when it exists", async () => {
      PageContent.findOne.mockResolvedValue({ page: "home", heroTitle: "Welcome" });

      const res = await request(app).get("/api/pageContent/home");

      expect(res.status).toBe(200);
      expect(res.body.heroTitle).toBe("Welcome");
    });

    it("returns an empty object when no content exists yet", async () => {
      PageContent.findOne.mockResolvedValue(null);

      const res = await request(app).get("/api/pageContent/home");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("is public — works with no authenticated user", async () => {
      mockCurrentUser = null;
      PageContent.findOne.mockResolvedValue({ page: "about" });

      const res = await request(app).get("/api/pageContent/about");

      expect(res.status).toBe(200);
    });
  });

  // ─── PUT /:page ──────────────────────────────────────────────────────────

  describe("PUT /api/pageContent/:page", () => {
    it("upserts the page content", async () => {
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "home", heroTitle: "New Title" });

      const res = await request(app).put("/api/pageContent/home").send({ heroTitle: "New Title" });

      expect(res.status).toBe(200);
      expect(PageContent.findOneAndUpdate).toHaveBeenCalledWith(
        { page: "home" },
        { $set: { heroTitle: "New Title" } },
        { new: true, upsert: true, runValidators: true }
      );
    });

    it("deletes the old hero image when a new one replaces it", async () => {
      // Bypasses the real route (and its multer/Cloudinary storage middleware) —
      // mounts the controller directly with req.files injected, since actually
      // uploading a file would hit the real Cloudinary API.
      const directApp = express();
      directApp.use(express.json());
      directApp.use((req, res, next) => {
        req.user = mockCurrentUser;
        req.files = [
          { fieldname: "heroImage", secure_url: "https://new.jpg", public_id: "new_public_id" },
        ];
        next();
      });
      directApp.put("/api/pageContent/:page", pageContentController.updatePageContent);

      PageContent.findOne.mockResolvedValue({ page: "home", heroImageId: "old_public_id" });
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "home" });

      const res = await request(directApp)
        .put("/api/pageContent/home")
        .send({ heroTitle: "Updated" });

      expect(res.status).toBe(200);
      expect(deleteCloudinaryImage).toHaveBeenCalledWith("old_public_id");
      expect(PageContent.findOneAndUpdate).toHaveBeenCalledWith(
        { page: "home" },
        {
          $set: {
            heroTitle: "Updated",
            heroImage: "https://new.jpg",
            heroImageId: "new_public_id",
          },
        },
        { new: true, upsert: true, runValidators: true }
      );
    });

    it("rejects non-admin users", async () => {
      mockCurrentUser = { id: "modId", role: "moderator" };

      const res = await request(app).put("/api/pageContent/home").send({ heroTitle: "Nope" });

      expect(res.status).toBe(403);
      expect(PageContent.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid JSON in contentData", async () => {
      const res = await request(app)
        .put("/api/pageContent/home")
        .set("Content-Type", "multipart/form-data")
        .field("contentData", "{not valid json");

      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE /:page and /:page/:section ─────────────────────────────────────

  describe("DELETE /api/pageContent/:page", () => {
    it("deletes the home page doc and its hero image", async () => {
      PageContent.findOne.mockResolvedValue({ page: "home", heroImageId: "hero_id" });
      PageContent.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const res = await request(app).delete("/api/pageContent/home");

      expect(res.status).toBe(200);
      expect(deleteCloudinaryImage).toHaveBeenCalledWith("hero_id");
      expect(PageContent.deleteOne).toHaveBeenCalledWith({ page: "home" });
    });

    it("returns early when content is already at defaults", async () => {
      PageContent.findOne.mockResolvedValue(null);

      const res = await request(app).delete("/api/pageContent/home");

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/already at defaults/);
      expect(PageContent.deleteOne).not.toHaveBeenCalled();
    });

    it("rejects non-admin users", async () => {
      mockCurrentUser = { id: "userId", role: "user" };

      const res = await request(app).delete("/api/pageContent/home");

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/pageContent/:page/:section", () => {
    it("unsets only the requested about-page section", async () => {
      PageContent.findOne.mockResolvedValue({ page: "about", activityCards: [] });
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "about" });

      const res = await request(app).delete("/api/pageContent/about/mission");

      expect(res.status).toBe(200);
      expect(PageContent.findOneAndUpdate).toHaveBeenCalledWith(
        { page: "about" },
        { $unset: { missionTitle: 1, missionText: 1 } },
        { new: true }
      );
    });

    it("deletes activity-card images when resetting the cards section", async () => {
      PageContent.findOne.mockResolvedValue({
        page: "about",
        activityCards: [{ image: "card1.jpg" }, { image: null }],
      });
      PageContent.findOneAndUpdate.mockResolvedValue({ page: "about" });

      await request(app).delete("/api/pageContent/about/cards");

      expect(deleteCloudinaryImage).toHaveBeenCalledTimes(1);
      expect(deleteCloudinaryImage).toHaveBeenCalledWith("card1.jpg", "page-images");
    });

    it("returns 400 for an unknown section", async () => {
      PageContent.findOne.mockResolvedValue({ page: "about" });

      const res = await request(app).delete("/api/pageContent/about/bogus");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Unknown section");
    });
  });
});
