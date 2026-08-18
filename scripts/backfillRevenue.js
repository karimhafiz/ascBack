/**
 * One-time backfill: populates totalAmountPaid on Ticket/EventSubscription/
 * CourseEnrollment records created before that field existed, by looking up
 * the real amount from Stripe. Only touches records where totalAmountPaid
 * is still 0 and a real payment reference exists — never re-touches records
 * the live code has already priced.
 *
 * Run with: node scripts/backfillRevenue.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const Ticket = require("../models/Ticket");
const CourseEnrollment = require("../models/CourseEnrollment");
const EventSubscription = require("../models/EventSubscription");

// Sum every paid invoice for a Stripe subscription — the true lifetime total,
// not just whatever the first checkout session happened to cover.
async function sumPaidInvoices(subscriptionId) {
  let total = 0;
  let startingAfter;
  let hasMore = true;
  while (hasMore) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      status: "paid",
      limit: 100,
      starting_after: startingAfter,
    });
    for (const invoice of page.data) total += invoice.amount_paid;
    hasMore = page.has_more;
    startingAfter = page.data[page.data.length - 1]?.id;
  }
  return total / 100;
}

// Matches both "field never written" (every pre-backfill record) and
// "field explicitly 0" — a plain { totalAmountPaid: 0 } filter only matches
// the second, since Mongoose's schema default is an application-layer
// read-time fill-in, not something the raw Mongo query engine applies.
const NEEDS_BACKFILL = { $or: [{ totalAmountPaid: { $exists: false } }, { totalAmountPaid: 0 }] };

async function backfillTickets() {
  const tickets = await Ticket.find({
    status: "paid",
    paymentId: { $ne: null },
    ...NEEDS_BACKFILL,
  });
  console.log(`Ticket: ${tickets.length} records to check`);

  // Group by paymentId — one Stripe session can cover several tickets from a
  // bulk purchase, and the original code split the total evenly between them.
  const byPaymentId = new Map();
  for (const t of tickets) {
    if (!byPaymentId.has(t.paymentId)) byPaymentId.set(t.paymentId, []);
    byPaymentId.get(t.paymentId).push(t);
  }

  let updated = 0;
  let skipped = 0;
  for (const [paymentId, group] of byPaymentId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(paymentId);
      const perTicketAmount = (session.amount_total ?? 0) / 100 / group.length;
      for (const ticket of group) {
        await Ticket.updateOne({ _id: ticket._id }, { $set: { totalAmountPaid: perTicketAmount } });
        updated++;
      }
    } catch (err) {
      console.error(`  Skipped paymentId ${paymentId} (${group.length} tickets): ${err.message}`);
      skipped += group.length;
    }
  }
  console.log(`Ticket: updated ${updated}, skipped ${skipped}`);
}

async function backfillEventSubscriptions() {
  const subs = await EventSubscription.find({
    $and: [
      NEEDS_BACKFILL,
      { $or: [{ subscriptionId: { $ne: null } }, { paymentId: { $ne: null } }] },
    ],
  });
  console.log(`EventSubscription: ${subs.length} records to check`);

  let updated = 0;
  let skipped = 0;
  for (const sub of subs) {
    try {
      let amount = 0;
      if (sub.subscriptionId) {
        amount = await sumPaidInvoices(sub.subscriptionId);
      } else if (sub.paymentId) {
        const session = await stripe.checkout.sessions.retrieve(sub.paymentId);
        amount = (session.amount_total ?? 0) / 100;
      }
      if (amount > 0) {
        await EventSubscription.updateOne({ _id: sub._id }, { $set: { totalAmountPaid: amount } });
        updated++;
      }
    } catch (err) {
      console.error(`  Skipped subscription ${sub._id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`EventSubscription: updated ${updated}, skipped ${skipped}`);
}

async function backfillCourseEnrollments() {
  const enrollments = await CourseEnrollment.find({
    $and: [
      NEEDS_BACKFILL,
      { $or: [{ subscriptionId: { $ne: null } }, { paymentId: { $ne: null } }] },
    ],
  });
  console.log(`CourseEnrollment: ${enrollments.length} records to check`);

  let updated = 0;
  let skipped = 0;
  for (const enr of enrollments) {
    try {
      let amount = 0;
      if (enr.subscriptionId) {
        amount = await sumPaidInvoices(enr.subscriptionId);
      } else if (enr.paymentId) {
        const session = await stripe.checkout.sessions.retrieve(enr.paymentId);
        amount = (session.amount_total ?? 0) / 100;
      }
      if (amount > 0) {
        await CourseEnrollment.updateOne({ _id: enr._id }, { $set: { totalAmountPaid: amount } });
        updated++;
      }
    } catch (err) {
      console.error(`  Skipped enrollment ${enr._id}: ${err.message}`);
      skipped++;
    }
  }
  console.log(`CourseEnrollment: updated ${updated}, skipped ${skipped}`);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  await backfillTickets();
  await backfillEventSubscriptions();
  await backfillCourseEnrollments();

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
