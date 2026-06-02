const QRCode = require("qrcode");
const { createTransporter } = require("../config/emailConfig");
const templates = require("./emailTemplates");

const FROM = `"ASC Events" <${process.env.EMAIL_USER}>`;

function formatAccessUntil(currentPeriodEnd) {
  return currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "the end of your current billing period";
}

/**
 * Send a ticket confirmation email after successful payment.
 * One email per purchase — lists all tickets if qty > 1.
 * QR codes are embedded as CID attachments.
 */
async function sendTicketConfirmationEmail({ buyerEmail, tickets, event }) {
  const transporter = await createTransporter();
  const frontEndUrl = process.env.FRONT_END_URL || "http://localhost:5173/";

  const attachments = [];
  const ticketRows = await Promise.all(
    tickets.map(async (ticket) => {
      const verifyUrl = `${frontEndUrl}tickets/verify/${ticket.ticketCode}`;
      const qrBuffer = await QRCode.toBuffer(verifyUrl, { width: 200, margin: 1 });
      const cid = `qr-${ticket.ticketCode}@asc`;
      attachments.push({ filename: `${ticket.ticketCode}.png`, content: qrBuffer, cid });
      return `<tr><td style="padding:16px;border:1px solid #adbfe4;text-align:center;background-color:#e6f7fe;border-radius:8px;">
        <p style="margin:0 0 8px;font-size:18px;font-weight:bold;color:#0f1510;">${ticket.ticketCode}</p>
        <img src="cid:${cid}" alt="QR Code" width="200" height="200" style="display:block;margin:0 auto;" />
      </td></tr>`;
    })
  );

  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Your tickets for ${event.title}`,
    html: templates.ticketConfirmation({ tickets, event, ticketRows }),
    attachments,
  });
}

/**
 * Send a course enrollment confirmation email.
 */
async function sendCourseEnrollmentEmail({ buyerEmail, course, enrollment }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Enrollment confirmed: ${course.title}`,
    html: templates.courseEnrollment({ course, enrollment }),
  });
}

/**
 * Send a course subscription cancellation email.
 */
async function sendSubscriptionCancellationEmail({ buyerEmail, course, currentPeriodEnd }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Subscription cancelled: ${course.title}`,
    html: templates.courseSubscriptionCancellation({
      course,
      accessUntil: formatAccessUntil(currentPeriodEnd),
    }),
  });
}

/**
 * Send team registration confirmation email to the manager.
 */
async function sendTeamRegistrationEmail({ team, event }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: team.manager.email,
    subject: `Team registered: ${team.name} — ${event.title}`,
    html: templates.teamRegistration({ team, event }),
  });
}

/**
 * Send team update notification email to the manager.
 */
async function sendTeamUpdateEmail({ team, event }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: team.manager.email,
    subject: `Team updated: ${team.name} — ${event.title}`,
    html: templates.teamUpdate({ team, event }),
  });
}

/**
 * Send an event subscription confirmation email.
 */
async function sendEventSubscriptionEmail({ buyerEmail, event }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Subscription confirmed: ${event.title}`,
    html: templates.eventSubscription({ event }),
  });
}

/**
 * Send an event subscription cancellation email.
 */
async function sendEventSubscriptionCancellationEmail({ buyerEmail, event, currentPeriodEnd }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Subscription cancelled: ${event.title}`,
    html: templates.eventSubscriptionCancellation({
      event,
      accessUntil: formatAccessUntil(currentPeriodEnd),
    }),
  });
}

/**
 * Send a venue booking confirmation email.
 */
async function sendVenueBookingConfirmationEmail({ buyerEmail, userName, booking, venue, slot }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Venue Booking Confirmed - ${venue.name}`,
    html: templates.venueBookingConfirmation({
      booking: {
        ...booking.toObject(),
        userName,
        ref: booking._id.toString().slice(-8).toUpperCase(),
      },
      venue,
      slot,
    }),
  });
}

/**
 * Send a venue booking cancellation email.
 */
async function sendVenueBookingCancellationEmail({ buyerEmail, userName, venue, slot, refunded }) {
  const transporter = await createTransporter();
  await transporter.sendMail({
    from: FROM,
    to: buyerEmail,
    subject: `Booking Cancelled - ${venue.name}`,
    html: templates.venueBookingCancellation({ userName, venue, slot, refunded }),
  });
}

module.exports = {
  sendTicketConfirmationEmail,
  sendCourseEnrollmentEmail,
  sendSubscriptionCancellationEmail,
  sendTeamRegistrationEmail,
  sendTeamUpdateEmail,
  sendEventSubscriptionEmail,
  sendEventSubscriptionCancellationEmail,
  sendVenueBookingConfirmationEmail,
  sendVenueBookingCancellationEmail,
};
