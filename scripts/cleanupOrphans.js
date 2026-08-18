/**
 * One-time cleanup: deletes records whose referenced parent resource no
 * longer exists (e.g. a Ticket for an Event that's since been deleted).
 * Logs the _ids being deleted before deleting them, for traceability.
 *
 * Run with: node scripts/cleanupOrphans.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const Ticket = require("../models/Ticket");
const CourseEnrollment = require("../models/CourseEnrollment");
const EventSubscription = require("../models/EventSubscription");
const Team = require("../models/Team");
const Event = require("../models/Event");
const Course = require("../models/Course");

async function cleanupOrphans(label, Model, field, RefModel) {
  const referencedIds = await Model.distinct(field, { [field]: { $ne: null } });
  const existingIds = await RefModel.find({ _id: { $in: referencedIds } }).distinct("_id");
  const existingSet = new Set(existingIds.map(String));
  const missingIds = referencedIds.filter((id) => !existingSet.has(String(id)));

  if (missingIds.length === 0) {
    console.log(`${label}: nothing orphaned`);
    return;
  }

  const orphans = await Model.find({ [field]: { $in: missingIds } }).select("_id");
  console.log(
    `${label}: deleting ${orphans.length} records referencing ${missingIds.length} missing ${RefModel.modelName}(s)`
  );
  console.log(`  _ids: ${orphans.map((o) => o._id).join(", ")}`);

  const result = await Model.deleteMany({ [field]: { $in: missingIds } });
  console.log(`${label}: deleted ${result.deletedCount}`);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB\n");

  await cleanupOrphans("Ticket -> Event", Ticket, "eventId", Event);
  await cleanupOrphans("CourseEnrollment -> Course", CourseEnrollment, "courseId", Course);
  await cleanupOrphans("EventSubscription -> Event", EventSubscription, "eventId", Event);
  await cleanupOrphans("Team -> Event", Team, "event", Event);

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
