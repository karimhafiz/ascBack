/**
 * One-time migration: assigns human-readable codes to existing records
 * that were created before code generation was added.
 *
 * Run with: node scripts/backfillCodes.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const CourseEnrollment = require("../models/CourseEnrollment");
const Team = require("../models/Team");
const VenueBooking = require("../models/VenueBooking");
const Ticket = require("../models/Ticket");
const { generateUniqueCode } = require("../utils/ticketUtils");

async function backfill(label, Model, field, prefix) {
  const records = await Model.find({ [field]: { $exists: false } })
    .select("_id")
    .lean();
  console.log(`${label}: ${records.length} records need codes`);

  let count = 0;
  for (const record of records) {
    const code = await generateUniqueCode(prefix, Model, field);
    await Model.updateOne({ _id: record._id }, { $set: { [field]: code } });
    count++;
  }
  console.log(`${label}: assigned ${count} codes`);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  await backfill("CourseEnrollment", CourseEnrollment, "enrollmentCode", "ENR");
  await backfill("Team", Team, "teamCode", "TEAM");
  await backfill("VenueBooking", VenueBooking, "bookingCode", "VBK");
  await backfill("Ticket", Ticket, "ticketCode", "TKT");

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
