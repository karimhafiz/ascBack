const express = require("express");
const router = express.Router();
const paypal = require("paypal-rest-sdk");
const { createTransporter } = require("../config/emailConfig");
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
require("dotenv").config();

paypal.configure({
  mode: "sandbox", // Change to 'live' for real transactions
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_SECRET,
});

// Create PayPal Payment
router.post("/pay", async (req, res) => {
  const { amount, eventId, email, quantity } = req.body;

  if (!amount || !eventId || !email || !quantity) {
    return res
      .status(400)
      .json({ error: "Amount, Event ID, Email, and Quantity are required" });
  }

  const paymentData = {
    intent: "sale",
    payer: { payment_method: "paypal" },
    redirect_urls: {
      return_url: `${
        process.env.FRONT_END_URL
      }success?eventId=${eventId}&email=${encodeURIComponent(email)}`,
      cancel_url: `${process.env.FRONT_END_URL}cancel`,
    },
    transactions: [
      {
        amount: { total: amount.toFixed(2), currency: "GBP" },
        description: `Purchase of ${quantity} ticket(s) for event ${eventId}`,
      },
    ],
  };

  paypal.payment.create(paymentData, (error, payment) => {
    if (error) {
      console.error("PayPal Payment Creation Error:", error);
      res.status(500).json({ error: error.message });
    } else {
      res.json({
        link: payment.links.find((l) => l.rel === "approval_url").href,
      });
    }
  });
});

// Execute Payment
router.get("/success", async (req, res) => {
  const { paymentId, eventId, teamId, email } = req.query;
  const decodedEmail = decodeURIComponent(email || "");

  paypal.payment.get(paymentId, async (error, payment) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const receipt = {
      eventId,
      paymentId: payment.id,
      payerEmail: payment.payer.payer_info.email,
      amount: parseFloat(payment.transactions[0].amount.total), // Ensure amount is a number
      currency: payment.transactions[0].amount.currency,
      description: payment.transactions[0].description,
      createdAt: payment.create_time,
    };
    try {
      // Check if the payment has already been processed
      const existingTicket = await Ticket.findOne({
        paymentId: receipt.paymentId,
      });
      if (existingTicket) {
        return res
          .status(200)
          .json({ message: "Payment already processed", receipt });
      }

      // If this is a team payment
      if (teamId) {
        // Update the team record to mark as paid
        const Team = require("../models/Team");
        const team = await Team.findById(teamId);

        if (team) {
          team.paid = true;
          team.paymentId = receipt.paymentId;
          await team.save();
        } else {
          return res.status(404).json({ error: "Team not found" });
        }

        // Update event revenue
        const event = await Event.findById(team.event);
        if (event) {
          event.totalRevenue += receipt.amount;
          await event.save();
        }

        // Send email confirmation for team registration
        const transporter = await createTransporter();
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: decodedEmail,
          subject: `Team Registration Confirmation for ${
            event ? event.title : "Tournament"
          }`,
          html: `
            <h1>Team Registration Confirmed!</h1>
            <p>Dear ${payment.payer.payer_info.first_name} ${
            payment.payer.payer_info.last_name
          },</p>
            <p>Thank you for registering your team. Your payment has been processed successfully.</p>
            <ul>
              <li><strong>Team:</strong> ${team.name}</li>
              <li><strong>Event:</strong> ${event ? event.title : teamId}</li>
              <li><strong>Payment ID:</strong> ${receipt.paymentId}</li>
              <li><strong>Amount:</strong> ${receipt.amount} ${
            receipt.currency
          }</li>
              <li><strong>Date:</strong> ${new Date(
                receipt.createdAt
              ).toLocaleString()}</li>
            </ul>
            <p>We look forward to seeing your team at the tournament!</p>
            <p>Best regards,</p>
            <p>The Tournament Team</p>
          `,
        };

        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            console.error("Error sending email:", err);
          }
        });

        return res.redirect(
          `${process.env.FRONT_END_URL}team-confirmation?teamId=${teamId}`
        );
      }

      // For regular ticket purchases
      // Log the successful payment in the Ticket collection
      const ticket = new Ticket({
        eventId: receipt.eventId,
        buyerEmail: receipt.payerEmail,
        paymentId: receipt.paymentId, // Save paymentId to ensure idempotency
        status: "paid",
      });
      await ticket.save();

      // Update total revenue (idempotent logic)
      const event = await Event.findById(eventId); // Assuming you have an Event model
      if (event) {
        event.totalRevenue += receipt.amount; // Increment total revenue
        await event.save();
      }
      if (!event) {
        return res.status(404).json({ error: "Event not found" });
      }

      // Add the payment amount to the event's total revenue

      // Send email receipt
      const transporter = await createTransporter();
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: decodedEmail,
        subject: `Your Ticket Receipt for Event ${eventId}`,
        html: `
          <h1>Thank You for Your Purchase!</h1>
          <p>Dear ${payment.payer.payer_info.first_name} ${
          payment.payer.payer_info.last_name
        },</p>
          <p>Thank you for purchasing tickets for the event. Here are your receipt details:</p>
          <ul>
            <li><strong>Event ID:</strong> ${receipt.eventId}</li>
            <li><strong>Payment ID:</strong> ${receipt.paymentId}</li>
            <li><strong>Amount:</strong> ${receipt.amount} ${
          receipt.currency
        }</li>
            <li><strong>Description:</strong> ${receipt.description}</li>
            <li><strong>Date:</strong> ${new Date(
              receipt.createdAt
            ).toLocaleString()}</li>
          </ul>
          <p>We look forward to seeing you at the event!</p>
          <p>Best regards,</p>
          <p>The Event Team</p>
        `,
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
          console.error("Error sending email:", err);
          return res
            .status(500)
            .json({ error: "Failed to send email receipt" });
        }

        res.json({ message: "Payment Successful", receipt });
      });
    } catch (dbError) {
      console.error("Error saving ticket to database:", dbError);
      res.status(500).json({ error: "Failed to save ticket details" });
    }
  });
});

// Handle Payment Cancellation
router.get("/cancel", async (req, res) => {
  const { eventId, email } = req.query;
  const decodedEmail = decodeURIComponent(email || "");

  try {
    const ticket = new Ticket({
      eventId,
      buyerEmail: decodedEmail,
      status: "failed",
    });
    await ticket.save();
    res.json({ message: "Payment was canceled" });
  } catch (error) {
    console.error("Error logging Failed payment: ", error);
    res.status(500).json({ error: "Failed to log Failed payment" });
  }
});

module.exports = router;
