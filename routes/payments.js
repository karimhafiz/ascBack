const express = require("express");
const router = express.Router();
const paypal = require("paypal-rest-sdk");
const nodemailer = require("nodemailer");
require("dotenv").config();

// Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "Gmail", // Use your email provider (e.g., Gmail, Outlook)
  auth: {
    user: process.env.EMAIL_USER, // Your email address
    pass: process.env.EMAIL_PASS, // Your email password or app-specific password
  },
  debug: true, // Enable debug output
  logger: true, // Log information to the console
});

paypal.configure({
  mode: "sandbox", // Change to 'live' for real transactions
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_SECRET,
});

// Create PayPal Payment
router.post("/pay", async (req, res) => {
  const { amount, eventId, email, quantity } = req.body;
  console.log("Email received in /pay route:", email); // Log the email for debugging

  if (!amount || !eventId || !email || !quantity) {
    return res
      .status(400)
      .json({ error: "Amount, Event ID, Email, and Quantity are required" });
  }

  const paymentData = {
    intent: "sale",
    payer: { payment_method: "paypal" },
    redirect_urls: {
      return_url: `http://localhost:5173/success?eventId=${eventId}&email=${encodeURIComponent(
        email
      )}`,
      cancel_url: "http://localhost:5173/cancel",
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
router.get("/success", (req, res) => {
  const { paymentId, eventId, email } = req.query;
  const decodedEmail = decodeURIComponent(email || ""); // Handle undefined email
  console.log("Email received in /success route:", decodedEmail);

  paypal.payment.get(paymentId, (error, payment) => {
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const receipt = {
      eventId,
      paymentId: payment.id,
      payer: payment.payer.payer_info,
      amount: payment.transactions[0].amount.total,
      currency: payment.transactions[0].amount.currency,
      description: payment.transactions[0].description,
      createdAt: payment.create_time,
    };

    // Send email receipt
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: decodedEmail, // Use the decoded email
      subject: `Your Ticket Receipt for Event ${eventId}`,
      html: `
        <h1>Thank You for Your Purchase!</h1>
        <p>Dear ${receipt.payer.first_name} ${receipt.payer.last_name},</p>
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
        return res.status(500).json({ error: "Failed to send email receipt" });
      }

      console.log("Email sent:", info.response);

      res.json({
        message: "Payment Successful",
        receipt,
      });
    });
  });
});

module.exports = router;
