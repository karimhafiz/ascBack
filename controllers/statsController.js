const User = require("../models/User");
const Event = require("../models/Event");
const Course = require("../models/Course");
const Ticket = require("../models/Ticket");
const CourseEnrollment = require("../models/CourseEnrollment");
const EventSubscription = require("../models/EventSubscription");
const VenueBooking = require("../models/VenueBooking");
const Venue = require("../models/Venue");
const Team = require("../models/Team");
const logger = require("../utils/logger");

const ACTIVE_ENROLLMENT_STATUSES = ["paid", "free", "active", "past_due"];
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "past_due"];

// GET /stats/public — homepage stats. No auth required.
exports.getPublicStats = async (req, res) => {
  try {
    const [activeUsers, currentEvents, currentCourses] = await Promise.all([
      User.countDocuments({ isBanned: false, role: { $nin: ["moderator", "admin"] } }),
      Event.countDocuments({ date: { $gte: new Date() } }),
      Course.countDocuments({}),
    ]);

    res.json({ activeUsers, currentEvents, currentCourses });
  } catch (err) {
    logger.error(err, "Error fetching public stats");
    res.status(500).json({ error: "Failed to load stats" });
  }
};

// Last 6 calendar months (oldest first), including the current one, as "YYYY-MM".
function lastSixMonthLabels() {
  const labels = [];
  const cursor = new Date();
  cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() - i);
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return labels;
}

// GET /stats/admin — cross-resource analytics for the admin/moderator dashboard.
exports.getAdminStats = async (req, res) => {
  try {
    const monthLabels = lastSixMonthLabels();
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      ticketsSold,
      courseEnrollments,
      eventSubscriptions,
      venueBookingsActive,
      totalTeams,
      eventRevenueAgg,
      eventSubscriptionRevenueAgg,
      courseRevenueAgg,
      venueRevenueAgg,
      topEventsAgg,
      topCoursesAgg,
      userGrowthAgg,
      allCourses,
      allVenues,
      reoccurringEvents,
      courseRevenueByCourseAgg,
      venueRevenueByVenueAgg,
      eventSubscriptionRevenueByEventAgg,
    ] = await Promise.all([
      User.countDocuments({}),
      Ticket.countDocuments({ status: "paid" }),
      CourseEnrollment.countDocuments({ status: { $in: ACTIVE_ENROLLMENT_STATUSES } }),
      EventSubscription.countDocuments({ status: { $in: ACTIVE_SUBSCRIPTION_STATUSES } }),
      VenueBooking.countDocuments({ status: { $ne: "cancelled" } }),
      Team.countDocuments({}),
      Event.aggregate([{ $group: { _id: null, total: { $sum: "$totalRevenue" } } }]),
      EventSubscription.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmountPaid" } } }]),
      CourseEnrollment.aggregate([{ $group: { _id: null, total: { $sum: "$totalAmountPaid" } } }]),
      VenueBooking.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
      Ticket.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: "$eventId", ticketsSold: { $sum: 1 } } },
        { $sort: { ticketsSold: -1 } },
        { $limit: 5 },
        { $lookup: { from: "events", localField: "_id", foreignField: "_id", as: "event" } },
        { $unwind: "$event" },
        { $project: { _id: 0, eventId: "$_id", title: "$event.title", ticketsSold: 1 } },
      ]),
      CourseEnrollment.aggregate([
        { $match: { status: { $in: ACTIVE_ENROLLMENT_STATUSES } } },
        { $group: { _id: "$courseId", enrollments: { $sum: 1 } } },
        { $sort: { enrollments: -1 } },
        { $limit: 5 },
        { $lookup: { from: "courses", localField: "_id", foreignField: "_id", as: "course" } },
        { $unwind: "$course" },
        { $project: { _id: 0, courseId: "$_id", title: "$course.title", enrollments: 1 } },
      ]),
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
      ]),
      Course.find({}, "title"),
      Venue.find({}, "name"),
      Event.find({ isReoccurring: true }, "title"),
      CourseEnrollment.aggregate([
        { $match: { status: { $in: ACTIVE_ENROLLMENT_STATUSES } } },
        { $group: { _id: "$courseId", revenue: { $sum: "$totalAmountPaid" } } },
      ]),
      VenueBooking.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: "$venue", revenue: { $sum: "$totalPrice" } } },
      ]),
      EventSubscription.aggregate([
        { $group: { _id: "$eventId", revenue: { $sum: "$totalAmountPaid" } } },
      ]),
    ]);

    const growthByMonth = new Map(userGrowthAgg.map((m) => [m._id, m.count]));
    const userGrowth = monthLabels.map((month) => ({
      month,
      count: growthByMonth.get(month) ?? 0,
    }));

    const eventRevenue = eventRevenueAgg[0]?.total ?? 0;
    const eventSubscriptionRevenue = eventSubscriptionRevenueAgg[0]?.total ?? 0;
    const courseRevenue = courseRevenueAgg[0]?.total ?? 0;
    const venueRevenue = venueRevenueAgg[0]?.total ?? 0;

    // Every course/venue/reoccurring-event, revenue defaulted to 0 for ones
    // with no enrollments/bookings/subscriptions yet — mirrors how the
    // "Revenue by Event" chart already shows every event, not just top sellers.
    const courseRevenueById = new Map(
      courseRevenueByCourseAgg.map((r) => [String(r._id), r.revenue])
    );
    const revenueByCourse = allCourses.map((c) => ({
      courseId: c._id,
      title: c.title,
      revenue: courseRevenueById.get(String(c._id)) ?? 0,
    }));

    const venueRevenueById = new Map(venueRevenueByVenueAgg.map((r) => [String(r._id), r.revenue]));
    const revenueByVenue = allVenues.map((v) => ({
      venueId: v._id,
      name: v.name,
      revenue: venueRevenueById.get(String(v._id)) ?? 0,
    }));

    const eventSubscriptionRevenueById = new Map(
      eventSubscriptionRevenueByEventAgg.map((r) => [String(r._id), r.revenue])
    );
    const revenueByEventSubscription = reoccurringEvents.map((e) => ({
      eventId: e._id,
      title: e.title,
      revenue: eventSubscriptionRevenueById.get(String(e._id)) ?? 0,
    }));

    res.json({
      revenue: {
        events: eventRevenue,
        eventSubscriptions: eventSubscriptionRevenue,
        courses: courseRevenue,
        venues: venueRevenue,
        total: eventRevenue + eventSubscriptionRevenue + courseRevenue + venueRevenue,
      },
      counts: {
        users: totalUsers,
        ticketsSold,
        courseEnrollments,
        eventSubscriptions,
        venueBookings: venueBookingsActive,
        teams: totalTeams,
      },
      topEvents: topEventsAgg,
      topCourses: topCoursesAgg,
      userGrowth,
      revenueByCourse,
      revenueByVenue,
      revenueByEventSubscription,
    });
  } catch (err) {
    logger.error(err, "Error fetching admin stats");
    res.status(500).json({ error: "Failed to load analytics" });
  }
};
