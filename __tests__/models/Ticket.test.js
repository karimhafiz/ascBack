const mongoose = require("mongoose");

// We need to test the schema without hitting DB, so we test validation only
const Ticket = require("../../models/Ticket");

describe("Ticket Model", () => {
  it("should validate a correct ticket", () => {
    const ticket = new Ticket({
      eventId: new mongoose.Types.ObjectId(),
      buyerEmail: "buyer@test.com",
      status: "paid",
      user: new mongoose.Types.ObjectId(),
      paymentId: "cs_test_123",
    });

    const error = ticket.validateSync();
    expect(error).toBeUndefined();
  });

  it("should require status to be set explicitly, with no default", () => {
    const ticket = new Ticket({
      eventId: new mongoose.Types.ObjectId(),
      buyerEmail: "buyer@test.com",
    });
    const error = ticket.validateSync();
    expect(error.errors.status).toBeDefined();
  });

  it("should default checkedIn to false", () => {
    const ticket = new Ticket({
      eventId: new mongoose.Types.ObjectId(),
      buyerEmail: "buyer@test.com",
    });
    expect(ticket.checkedIn).toBe(false);
  });

  it("should allow setting ticketCode manually", () => {
    const ticket = new Ticket({
      eventId: new mongoose.Types.ObjectId(),
      buyerEmail: "buyer@test.com",
      ticketCode: "TKT-ABC123",
    });
    expect(ticket.ticketCode).toBe("TKT-ABC123");
  });
});
