const Event = require("./Event");

describe("Event Model", () => {
  it("should validate a correct event", () => {
    const event = new Event({
      title: "Football",
      shortDescription: "Practice",
      longDescription: "Friendly matches and practice.",
      date: new Date(),
      ticketPrice: 10,
      isReoccurring: true,
      reoccurringStartDate: new Date(),
      reoccurringEndDate: new Date(),
      dayOfWeek: "friday",
      city: "London",
      street: "Main Street",
    });

    const error = event.validateSync();
    expect(error).toBeUndefined();
  });

  it("should throw an error for missing required fields", () => {
    const event = new Event({});
    const error = event.validateSync();
    expect(error.errors.title).toBeDefined();
    expect(error.errors.shortDescription).toBeDefined();
  });
});
