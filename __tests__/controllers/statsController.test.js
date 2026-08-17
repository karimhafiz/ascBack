const request = require("supertest");
const express = require("express");

jest.mock("../../models/User");
jest.mock("../../models/Event");
jest.mock("../../models/Course");
jest.mock("../../models/Ticket");
jest.mock("../../models/CourseEnrollment");
jest.mock("../../models/EventSubscription");
jest.mock("../../models/VenueBooking");
jest.mock("../../models/Venue");
jest.mock("../../models/Team");

const statsController = require("../../controllers/statsController");
const User = require("../../models/User");
const Event = require("../../models/Event");
const Course = require("../../models/Course");
const Ticket = require("../../models/Ticket");
const CourseEnrollment = require("../../models/CourseEnrollment");
const EventSubscription = require("../../models/EventSubscription");
const VenueBooking = require("../../models/VenueBooking");
const Venue = require("../../models/Venue");
const Team = require("../../models/Team");

const app = express();
app.get("/stats/public", statsController.getPublicStats);
app.get("/stats/admin", statsController.getAdminStats);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getPublicStats", () => {
  it("returns active users, current events, and current courses counts", async () => {
    User.countDocuments.mockResolvedValue(12);
    Event.countDocuments.mockResolvedValue(3);
    Course.countDocuments.mockResolvedValue(5);

    const res = await request(app).get("/stats/public");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeUsers: 12, currentEvents: 3, currentCourses: 5 });
    expect(User.countDocuments).toHaveBeenCalledWith({
      isBanned: false,
      role: { $nin: ["moderator", "admin"] },
    });
    expect(Event.countDocuments).toHaveBeenCalledWith({ date: { $gte: expect.any(Date) } });
  });

  it("returns 500 on failure", async () => {
    User.countDocuments.mockRejectedValue(new Error("DB down"));
    Event.countDocuments.mockResolvedValue(0);
    Course.countDocuments.mockResolvedValue(0);

    const res = await request(app).get("/stats/public");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to load stats" });
  });
});

describe("getAdminStats", () => {
  // CourseEnrollment/VenueBooking/EventSubscription.aggregate are each called
  // 2-3 times per request with different pipelines (a _id:null total sum, a
  // top-N breakdown with $lookup, and a per-item breakdown without $lookup).
  // Distinguish by inspecting the pipeline shape rather than a single fixed
  // mockResolvedValue, which would return the same thing for every call.
  function mockGroupedAggregate(model, { total = [], topN = [], byItem = [] } = {}) {
    model.aggregate.mockImplementation((pipeline) => {
      const groupStage = pipeline.find((s) => s.$group);
      if (groupStage?.$group._id === null) return Promise.resolve(total);
      if (pipeline.some((s) => s.$lookup)) return Promise.resolve(topN);
      return Promise.resolve(byItem);
    });
  }

  function mockAllZero() {
    User.countDocuments.mockResolvedValue(0);
    Ticket.countDocuments.mockResolvedValue(0);
    CourseEnrollment.countDocuments.mockResolvedValue(0);
    EventSubscription.countDocuments.mockResolvedValue(0);
    VenueBooking.countDocuments.mockResolvedValue(0);
    Team.countDocuments.mockResolvedValue(0);
    Event.aggregate.mockResolvedValue([]);
    Ticket.aggregate.mockResolvedValue([]);
    User.aggregate.mockResolvedValue([]);
    Course.find.mockResolvedValue([]);
    Venue.find.mockResolvedValue([]);
    Event.find.mockResolvedValue([]);
    mockGroupedAggregate(CourseEnrollment);
    mockGroupedAggregate(VenueBooking);
    mockGroupedAggregate(EventSubscription);
  }

  it("sums event, event-subscription, course, and venue revenue into a combined total", async () => {
    mockAllZero();
    Event.aggregate.mockResolvedValue([{ _id: null, total: 500 }]);
    EventSubscription.aggregate.mockResolvedValue([{ _id: null, total: 80 }]);
    CourseEnrollment.aggregate.mockResolvedValue([{ _id: null, total: 70 }]);
    VenueBooking.aggregate.mockResolvedValue([{ _id: null, total: 150 }]);

    const res = await request(app).get("/stats/admin");

    expect(res.status).toBe(200);
    expect(res.body.revenue).toEqual({
      events: 500,
      eventSubscriptions: 80,
      courses: 70,
      venues: 150,
      total: 800,
    });
  });

  it("defaults revenue to 0 when there are no matching documents", async () => {
    mockAllZero();

    const res = await request(app).get("/stats/admin");

    expect(res.body.revenue).toEqual({
      events: 0,
      eventSubscriptions: 0,
      courses: 0,
      venues: 0,
      total: 0,
    });
  });

  it("fills every one of the last 6 months, defaulting missing months to 0", async () => {
    mockAllZero();
    const thisMonth = new Date().toISOString().slice(0, 7);
    User.aggregate.mockResolvedValue([{ _id: thisMonth, count: 4 }]);

    const res = await request(app).get("/stats/admin");

    expect(res.body.userGrowth).toHaveLength(6);
    expect(res.body.userGrowth[5]).toEqual({ month: thisMonth, count: 4 });
    expect(res.body.userGrowth[0].count).toBe(0);
  });

  it("returns the aggregated counts", async () => {
    mockAllZero();
    User.countDocuments.mockResolvedValue(42);
    Ticket.countDocuments.mockResolvedValue(10);
    CourseEnrollment.countDocuments.mockResolvedValue(5);
    EventSubscription.countDocuments.mockResolvedValue(2);
    VenueBooking.countDocuments.mockResolvedValue(3);
    Team.countDocuments.mockResolvedValue(1);

    const res = await request(app).get("/stats/admin");

    expect(res.body.counts).toEqual({
      users: 42,
      ticketsSold: 10,
      courseEnrollments: 5,
      eventSubscriptions: 2,
      venueBookings: 3,
      teams: 1,
    });
  });

  it("returns top events and top courses from the aggregation results", async () => {
    mockAllZero();
    Ticket.aggregate.mockResolvedValue([{ eventId: "e1", title: "Event A", ticketsSold: 10 }]);
    CourseEnrollment.aggregate.mockResolvedValue([
      { courseId: "c1", title: "Course A", enrollments: 5 },
    ]);

    const res = await request(app).get("/stats/admin");

    expect(res.body.topEvents).toEqual([{ eventId: "e1", title: "Event A", ticketsSold: 10 }]);
    expect(res.body.topCourses).toEqual([{ courseId: "c1", title: "Course A", enrollments: 5 }]);
  });

  it("returns every course/venue/reoccurring-event, defaulting revenue to 0 for ones with none", async () => {
    mockAllZero();
    Course.find.mockResolvedValue([
      { _id: "c1", title: "Course A" },
      { _id: "c2", title: "Course B" },
    ]);
    Venue.find.mockResolvedValue([{ _id: "v1", name: "Venue A" }]);
    Event.find.mockResolvedValue([{ _id: "e1", title: "Reoccurring Event A" }]);
    mockGroupedAggregate(CourseEnrollment, { byItem: [{ _id: "c1", revenue: 120 }] });
    mockGroupedAggregate(VenueBooking, { byItem: [] });
    mockGroupedAggregate(EventSubscription, { byItem: [{ _id: "e1", revenue: 45 }] });

    const res = await request(app).get("/stats/admin");

    expect(res.body.revenueByCourse).toEqual([
      { courseId: "c1", title: "Course A", revenue: 120 },
      { courseId: "c2", title: "Course B", revenue: 0 },
    ]);
    expect(res.body.revenueByVenue).toEqual([{ venueId: "v1", name: "Venue A", revenue: 0 }]);
    expect(res.body.revenueByEventSubscription).toEqual([
      { eventId: "e1", title: "Reoccurring Event A", revenue: 45 },
    ]);
    expect(Event.find).toHaveBeenCalledWith({ isReoccurring: true }, "title");
  });

  it("returns 500 on failure", async () => {
    User.countDocuments.mockRejectedValue(new Error("DB down"));

    const res = await request(app).get("/stats/admin");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to load analytics" });
  });
});
