// Pure functions that return HTML strings for each email type.
// No sending logic here — import into emailUtils.js for that.

const FOOTER = `
  <div style="background-color:#e6f7fe;padding:16px;text-align:center;font-size:12px;color:#618e9e;">
    <p style="margin:0;">This email was sent by ASC Events. Do not reply to this email.</p>
  </div>`;

function wrap(headerColor, title, body) {
  return `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0f1510;">
      <div style="background-color:${headerColor};padding:24px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;">${title}</h1>
      </div>
      <div style="padding:24px;background-color:#ffffff;">
        ${body}
      </div>
      ${FOOTER}
    </div>`;
}

function infoBox(content) {
  return `<div style="background-color:#cef0fd;border:1px solid #08b3f7;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
    <p style="margin:0;font-size:14px;color:#0f1510;">${content}</p>
  </div>`;
}

function table(rows) {
  const rowsHtml = rows
    .filter(([, val]) => val != null && val !== "")
    .map(
      ([label, val]) => `
      <tr>
        <td style="padding:8px 0;font-weight:bold;width:150px;color:#618e9e;">${label}</td>
        <td style="padding:8px 0;">${val}</td>
      </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${rowsHtml}</table>`;
}

// ==================== TICKETS ====================

function ticketConfirmation({ tickets, event, ticketRows }) {
  const eventDate = new Date(event.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const venue = [event.street, event.city, event.postCode].filter(Boolean).join(", ");
  const plural = tickets.length > 1;

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Thank you for your purchase! Here are your ticket details:</p>
    ${table([
      ["Event", event.title],
      ["Date", eventDate],
      ["Time", event.openingTime],
      ["Venue", venue],
      ["Tickets", tickets.length],
      ["Price per ticket", `&pound;${event.ticketPrice.toFixed(2)}`],
    ])}
    <h2 style="margin:0 0 16px;font-size:20px;color:#0f1510;">Your Ticket${plural ? "s" : ""}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${ticketRows.join("")}</table>
    ${infoBox(`<strong>Present the QR code${plural ? "s" : ""} at the entrance for check-in.</strong>`)}`;

  return wrap("#08b3f7", "Ticket Confirmation", body);
}

// ==================== COURSES ====================

function courseEnrollment({ course, enrollment }) {
  const venue = [course.street, course.city, course.postCode].filter(Boolean).join(", ");
  const participants = enrollment.participants || [];
  const isSubscription = course.isSubscription;
  const interval = course.billingInterval === "year" ? "year" : "month";
  const priceLabel = isSubscription
    ? `&pound;${course.price.toFixed(2)} / ${interval}`
    : `&pound;${course.price.toFixed(2)}`;
  const statusLabel = isSubscription ? "Subscription Active" : course.price === 0 ? "Free" : "Paid";

  const participantRows = participants
    .map(
      (p) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.name}</td>
        <td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.age != null ? p.age : "—"}</td>
        <td style="padding:8px 12px;border:1px solid #adbfe4;color:#0f1510;">${p.email || "—"}</td>
      </tr>`
    )
    .join("");

  const participantsSection =
    participants.length > 0
      ? `
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f1510;">Participant${participants.length > 1 ? "s" : ""}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Name</th>
        <th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Age</th>
        <th style="padding:8px 12px;border:1px solid #adbfe4;background-color:#e6f7fe;text-align:left;color:#618e9e;font-size:14px;">Email</th>
      </tr>
      ${participantRows}
    </table>`
      : "";

  const subscriptionNote = isSubscription
    ? infoBox(
        `<strong>Your ${interval}ly subscription is now active.</strong> You can manage or cancel it anytime from your profile.`
      )
    : "";

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Thank you for enrolling! Here are your course details:</p>
    ${table([
      ["Course", course.title],
      ["Instructor", course.instructor],
      ["Schedule", course.schedule],
      ["Location", venue],
      ["Price", priceLabel],
      ["Status", statusLabel],
    ])}
    ${participantsSection}
    ${subscriptionNote}
    ${infoBox("<strong>Arrive a few minutes early to your first session and bring any required materials.</strong>")}`;

  return wrap("#08b3f7", "Enrollment Confirmed", body);
}

function courseSubscriptionCancellation({ course, accessUntil }) {
  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Your subscription for <strong>${course.title}</strong> has been cancelled.</p>
    <div style="background-color:#e6f7fe;border:1px solid #adbfe4;border-radius:8px;padding:16px;margin-bottom:24px;">
      ${table([
        ["Course", course.title],
        ["Access Until", accessUntil],
      ])}
    </div>
    <p style="margin:0 0 16px;font-size:14px;">You will continue to have full access until <strong>${accessUntil}</strong>. After that date, your enrollment will expire.</p>
    <p style="margin:0 0 16px;font-size:14px;">If you change your mind, you can re-enroll anytime from the course page.</p>`;

  return wrap("#618e9e", "Subscription Cancelled", body);
}

// ==================== TEAMS ====================

function teamRegistration({ team, event }) {
  const venue = [event.street, event.city, event.postCode].filter(Boolean).join(", ");
  const eventDate = new Date(event.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Hi ${team.manager.name},</p>
    <p style="margin:0 0 16px;font-size:16px;">Your team has been successfully registered. Here are the details:</p>
    ${table([
      ["Tournament", event.title],
      ["Team Name", team.name],
      ["Date", eventDate],
      ["Time", event.openingTime],
      ["Venue", venue],
    ])}
    ${infoBox("<strong>Arrive 30 minutes before your scheduled time. Good luck!</strong>")}`;

  return wrap("#08b3f7", "Team Registration Confirmed", body);
}

function teamUpdate({ team, event }) {
  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Hi ${team.manager.name},</p>
    <p style="margin:0 0 16px;font-size:16px;">Your team <strong>${team.name}</strong> for <strong>${event.title}</strong> has been updated.</p>
    ${infoBox("<strong>If you did not make this change, please contact us.</strong>")}`;

  return wrap("#618e9e", "Team Updated", body);
}

// ==================== EVENT SUBSCRIPTIONS ====================

function eventSubscription({ event }) {
  const venue = [event.street, event.city, event.postCode].filter(Boolean).join(", ");
  const interval = event.subscriptionInterval === "week" ? "week" : "month";
  const eventDate = new Date(event.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Thank you for subscribing! Here are your event details:</p>
    ${table([
      ["Event", event.title],
      ["Date", eventDate],
      ["Time", event.openingTime],
      ["Venue", venue],
      ["Price", `&pound;${event.ticketPrice.toFixed(2)} / ${interval}`],
    ])}
    ${infoBox(`<strong>Your ${interval}ly subscription is now active.</strong> You can manage or cancel it anytime from your profile.`)}`;

  return wrap("#08b3f7", "Subscription Confirmed", body);
}

function eventSubscriptionCancellation({ event, accessUntil }) {
  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Your subscription for <strong>${event.title}</strong> has been cancelled.</p>
    <div style="background-color:#e6f7fe;border:1px solid #adbfe4;border-radius:8px;padding:16px;margin-bottom:24px;">
      ${table([
        ["Event", event.title],
        ["Access Until", accessUntil],
      ])}
    </div>
    <p style="margin:0 0 16px;font-size:14px;">You will continue to have full access until <strong>${accessUntil}</strong>. After that date, your subscription will expire.</p>
    <p style="margin:0 0 16px;font-size:14px;">If you change your mind, you can resubscribe anytime from the event page.</p>`;

  return wrap("#618e9e", "Subscription Cancelled", body);
}

// ==================== VENUE BOOKINGS ====================

function venueBookingConfirmation({ booking, venue, slot }) {
  const slotDate = new Date(slot.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const venueAddress = [venue.street, venue.city, venue.postCode].filter(Boolean).join(", ");

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Dear ${booking.userName},</p>
    <p style="margin:0 0 24px;font-size:16px;">Your venue booking has been confirmed. Here are your booking details:</p>
    ${table([
      ["Venue", venue.name],
      ["Address", venueAddress],
      ["Capacity", `${venue.capacity} people`],
      ["Attendees", booking.numberOfAttendees],
      ["Date", slotDate],
      ["Time", `${slot.startTime} - ${slot.endTime}`],
      ["Price", `&pound;${booking.totalPrice.toFixed(2)}`],
    ])}
    ${booking.eventName && booking.eventName !== "N/A" ? `<p style="margin:0 0 8px;font-size:14px;"><strong>Event:</strong> ${booking.eventName}</p>` : ""}
    ${booking.eventDescription ? `<p style="margin:0 0 16px;font-size:14px;"><strong>Description:</strong> ${booking.eventDescription}</p>` : ""}
    ${infoBox(`<strong>Booking reference: ${booking.ref}</strong>`)}
    <div style="background-color:#f9f9f9;border-left:4px solid #08b3f7;padding:16px;margin-bottom:24px;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#0f1510;">Important Information</h3>
      <p style="margin:0;font-size:13px;color:#618e9e;">Please arrive 15 minutes before your booking time.</p>
      ${venue.rules ? `<p style="margin:8px 0 0;font-size:13px;color:#618e9e;"><strong>Venue Rules:</strong> ${venue.rules}</p>` : ""}
    </div>`;

  return wrap("#08b3f7", "Venue Booking Confirmed", body);
}

function venueBookingCancellation({ userName, venue, slot, refunded }) {
  const slotDate = new Date(slot.date).toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Dear ${userName},</p>
    <p style="margin:0 0 24px;font-size:16px;">Your venue booking has been cancelled.</p>
    ${table([
      ["Venue", venue.name],
      ["Date", slotDate],
      ["Time", `${slot.startTime} - ${slot.endTime}`],
      ...(refunded ? [["Refund Status", '<span style="color:#27ae60;">Refunded</span>']] : []),
    ])}
    ${
      refunded
        ? `
    <div style="background-color:#d5f4e6;border:1px solid #27ae60;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0f1510;"><strong>Your refund has been processed and should appear within 3-5 business days.</strong></p>
    </div>`
        : ""
    }
    <p style="margin:0;font-size:14px;">If you have any questions, please contact us.</p>`;

  return wrap("#ff6b6b", "Booking Cancelled", body);
}

// ==================== VERIFICATION LINKS ====================

function button(link, label) {
  return `<div style="text-align:center;margin-bottom:24px;">
    <a href="${link}" style="display:inline-block;background-color:#08b3f7;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 28px;border-radius:8px;">${label}</a>
  </div>`;
}

function accountVerification({ link }) {
  const body = `
    <p style="margin:0 0 16px;font-size:16px;">Thanks for registering with ASC! Confirm your email address to finish setting up your account.</p>
    ${button(link, "Verify My Email")}
    ${infoBox("This link expires in 20 minutes. If you didn't create an account, you can ignore this email.")}`;

  return wrap("#08b3f7", "Verify Your Email", body);
}

function ticketResendLink({ link }) {
  const body = `
    <p style="margin:0 0 16px;font-size:16px;">You (or someone with this email address) asked to recover a ticket. Click below to view it.</p>
    ${button(link, "View My Ticket")}
    ${infoBox("This link expires in 20 minutes and can only be used once. If you didn't request this, you can ignore this email.")}`;

  return wrap("#08b3f7", "Recover Your Ticket", body);
}

module.exports = {
  ticketConfirmation,
  courseEnrollment,
  courseSubscriptionCancellation,
  teamRegistration,
  teamUpdate,
  eventSubscription,
  eventSubscriptionCancellation,
  venueBookingConfirmation,
  venueBookingCancellation,
  accountVerification,
  ticketResendLink,
};
