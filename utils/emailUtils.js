const QRCode = require("qrcode");
const { createTransporter } = require("../config/emailConfig");

/**
 * Send a ticket confirmation email after successful payment.
 * One email per purchase — lists all tickets if qty > 1.
 * QR codes are embedded as CID attachments using nodemailer's built-in
 * multipart/related support, which Gmail web renders correctly.
 */
async function sendTicketConfirmationEmail({ buyerEmail, tickets, event }) {
  const transporter = await createTransporter();

  const frontEndUrl = process.env.FRONT_END_URL || "http://localhost:5173/";

  // Generate QR buffers and build CID attachments + HTML rows
  const attachments = [];
  const ticketRows = await Promise.all(
    tickets.map(async (ticket) => {
      const verifyUrl = `${frontEndUrl}tickets/verify/${ticket.ticketCode}`;
      const qrBuffer = await QRCode.toBuffer(verifyUrl, { width: 200, margin: 1 });

      const cid = `qr-${ticket.ticketCode}@asc`;
      attachments.push({
        filename: `${ticket.ticketCode}.png`,
        content: qrBuffer,
        cid,
      });

      return `<tr><td style="padding:16px;border:1px solid #adbfe4;text-align:center;background-color:#e6f7fe;border-radius:8px;"><p style="margin:0 0 8px;font-size:18px;font-weight:bold;color:#0f1510;">${ticket.ticketCode}</p><img src="cid:${cid}" alt="QR Code" width="200" height="200" style="display:block;margin:0 auto;" /></td></tr>`;
    })
  );

  const eventDate = new Date(event.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const venue = [event.street, event.city, event.postCode].filter(Boolean).join(", ");

  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;"><div style="background-color:#08b3f7;padding:24px;text-align:center;"><h1 style="margin:0;color:#ffffff;font-size:24px;">Ticket Confirmation</h1></div><div style="padding:24px;background-color:#ffffff;"><p style="margin:0 0 16px;font-size:16px;">Thank you for your purchase! Here are your ticket details:</p><table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td style="padding:8px 0;font-weight:bold;width:120px;color:#618e9e;">Event</td><td style="padding:8px 0;">${event.title}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Date</td><td style="padding:8px 0;">${eventDate}</td></tr>${event.openingTime ? `<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Time</td><td style="padding:8px 0;">${event.openingTime}</td></tr>` : ""}<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Venue</td><td style="padding:8px 0;">${venue}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Tickets</td><td style="padding:8px 0;">${tickets.length}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Price per ticket</td><td style="padding:8px 0;">&pound;${event.ticketPrice.toFixed(2)}</td></tr></table><h2 style="margin:0 0 16px;font-size:20px;color:#0f1510;">Your Ticket${tickets.length > 1 ? "s" : ""}</h2><table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${ticketRows.join("")}</table><div style="background-color:#cef0fd;border:1px solid #08b3f7;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0;font-size:14px;color:#0f1510;"><strong>Present the QR code${tickets.length > 1 ? "s" : ""} at the entrance for check-in.</strong></p></div></div><div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;"><p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p></div></div>`;

  await transporter.sendMail({
    from: `"ASC Events" <${process.env.EMAIL_USER}>`,
    to: buyerEmail,
    subject: `Your tickets for ${event.title}`,
    html,
    attachments,
  });
}

/**
 * Send a course enrollment confirmation email.
 * Covers both one-time payments and subscriptions.
 */
async function sendCourseEnrollmentEmail({ buyerEmail, course, enrollment }) {
  const transporter = await createTransporter();

  const venue = [course.street, course.city, course.postCode].filter(Boolean).join(", ");
  const participants = enrollment.participants || [];
  const participantRows = participants
    .map(
      (p) =>
        `<tr><td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.name}</td><td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.age != null ? p.age : "—"}</td><td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.email || "—"}</td></tr>`
    )
    .join("");

  const isSubscription = course.isSubscription;
  const interval = course.billingInterval === "year" ? "year" : "month";
  const priceLabel = isSubscription
    ? `&pound;${course.price.toFixed(2)} / ${interval}`
    : `&pound;${course.price.toFixed(2)}`;
  const statusLabel = isSubscription ? "Subscription Active" : course.price === 0 ? "Free" : "Paid";

  const subscriptionNote = isSubscription
    ? `<div style="background-color:#cef0fd;border:1px solid #08b3f7;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;"><p style="margin:0;font-size:14px;color:#0f1510;"><strong>Your ${interval}ly subscription is now active.</strong> You can manage or cancel it anytime from your profile.</p></div>`
    : "";

  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;"><div style="background-color:#08b3f7;padding:24px;text-align:center;"><h1 style="margin:0;color:#ffffff;font-size:24px;">Enrollment Confirmed</h1></div><div style="padding:24px;background-color:#ffffff;"><p style="margin:0 0 16px;font-size:16px;">Thank you for enrolling! Here are your course details:</p><table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td style="padding:8px 0;font-weight:bold;width:120px;color:#618e9e;">Course</td><td style="padding:8px 0;">${course.title}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Instructor</td><td style="padding:8px 0;">${course.instructor}</td></tr>${course.schedule ? `<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Schedule</td><td style="padding:8px 0;">${course.schedule}</td></tr>` : ""}${venue ? `<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Location</td><td style="padding:8px 0;">${venue}</td></tr>` : ""}<tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Price</td><td style="padding:8px 0;">${priceLabel}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Status</td><td style="padding:8px 0;">${statusLabel}</td></tr></table>${participants.length > 0 ? `<h2 style="margin:0 0 12px;font-size:18px;color:#0f1510;">Participant${participants.length > 1 ? "s" : ""}</h2><table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Name</th><th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Age</th><th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Email</th></tr>${participantRows}</table>` : ""}${subscriptionNote}<div style="background-color:#cef0fd;border:1px solid #08b3f7;border-radius:8px;padding:16px;text-align:center;"><p style="margin:0;font-size:14px;color:#0f1510;"><strong>Arrive a few minutes early to your first session and bring any required materials.</strong></p></div></div><div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;"><p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p></div></div>`;

  await transporter.sendMail({
    from: `"ASC Events" <${process.env.EMAIL_USER}>`,
    to: buyerEmail,
    subject: `Enrollment confirmed: ${course.title}`,
    html,
  });
}

/**
 * Send a subscription cancellation confirmation email.
 */
async function sendSubscriptionCancellationEmail({ buyerEmail, course, currentPeriodEnd }) {
  const transporter = await createTransporter();

  const accessUntil = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "the end of your current billing period";

  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;"><div style="background-color:#618e9e;padding:24px;text-align:center;"><h1 style="margin:0;color:#ffffff;font-size:24px;">Subscription Cancelled</h1></div><div style="padding:24px;background-color:#ffffff;"><p style="margin:0 0 16px;font-size:16px;">Your subscription for <strong>${course.title}</strong> has been cancelled.</p><div style="background-color:#e6f7fe;border:1px solid #adbfe4;border-radius:8px;padding:16px;margin-bottom:24px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px 0;font-weight:bold;width:140px;color:#618e9e;">Course</td><td style="padding:8px 0;">${course.title}</td></tr><tr><td style="padding:8px 0;font-weight:bold;color:#618e9e;">Access Until</td><td style="padding:8px 0;">${accessUntil}</td></tr></table></div><p style="margin:0 0 16px;font-size:14px;color:#0f1510;">You will continue to have full access until <strong>${accessUntil}</strong>. After that date, your enrollment will expire.</p><p style="margin:0 0 16px;font-size:14px;color:#0f1510;">If you change your mind, you can re-enroll anytime from the course page.</p></div><div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;"><p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p></div></div>`;

  await transporter.sendMail({
    from: `"ASC Events" <${process.env.EMAIL_USER}>`,
    to: buyerEmail,
    subject: `Subscription cancelled: ${course.title}`,
    html,
  });
}

module.exports = {
  sendTicketConfirmationEmail,
  sendCourseEnrollmentEmail,
  sendSubscriptionCancellationEmail,
};
