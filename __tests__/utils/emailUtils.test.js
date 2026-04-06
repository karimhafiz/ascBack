const QRCode = require("qrcode");

jest.mock("qrcode");
jest.mock("../../config/emailConfig");

const { createTransporter } = require("../../config/emailConfig");
const { sendTicketConfirmationEmail } = require("../../utils/emailUtils");

describe("sendTicketConfirmationEmail", () => {
  let mockSendMail;

  const event = {
    title: "Community Football",
    date: new Date("2026-05-15T18:00:00Z"),
    openingTime: "6:00 PM",
    street: "123 Main St",
    city: "London",
    postCode: "E1 6AN",
    ticketPrice: 10,
  };

  const tickets = [{ ticketCode: "TKT-ABC123" }, { ticketCode: "TKT-DEF456" }];

  const fakeQrBuffer = Buffer.from("fake-qr-png");

  beforeEach(() => {
    process.env.FRONT_END_URL = "http://localhost:5173/";
    process.env.EMAIL_USER = "test@example.com";

    mockSendMail = jest.fn().mockResolvedValue({ messageId: "abc" });
    createTransporter.mockResolvedValue({ sendMail: mockSendMail });
    QRCode.toBuffer.mockResolvedValue(fakeQrBuffer);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should send an email with correct recipient and subject", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailOptions = mockSendMail.mock.calls[0][0];
    expect(mailOptions.to).toBe("buyer@test.com");
    expect(mailOptions.subject).toBe("Your tickets for Community Football");
  });

  it("should include event details in the HTML body", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("Community Football");
    expect(html).toContain("6:00 PM");
    expect(html).toContain("123 Main St");
    expect(html).toContain("London");
    expect(html).toContain("E1 6AN");
    expect(html).toContain("&pound;10.00");
  });

  it("should include all ticket codes in the HTML body", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("TKT-ABC123");
    expect(html).toContain("TKT-DEF456");
  });

  it("should generate QR buffers for each ticket", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    expect(QRCode.toBuffer).toHaveBeenCalledTimes(2);
    expect(QRCode.toBuffer).toHaveBeenCalledWith(
      "http://localhost:5173/tickets/verify/TKT-ABC123",
      expect.objectContaining({ width: 200 })
    );
    expect(QRCode.toBuffer).toHaveBeenCalledWith(
      "http://localhost:5173/tickets/verify/TKT-DEF456",
      expect.objectContaining({ width: 200 })
    );
  });

  it("should include CID attachments for QR codes", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    const mailOptions = mockSendMail.mock.calls[0][0];
    expect(mailOptions.attachments).toHaveLength(2);
    expect(mailOptions.attachments[0]).toMatchObject({
      filename: "TKT-ABC123.png",
      content: fakeQrBuffer,
      cid: "qr-TKT-ABC123@asc",
    });
    expect(mailOptions.attachments[1]).toMatchObject({
      filename: "TKT-DEF456.png",
      content: fakeQrBuffer,
      cid: "qr-TKT-DEF456@asc",
    });
  });

  it("should reference CID URLs in HTML", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain('src="cid:qr-TKT-ABC123@asc"');
    expect(html).toContain('src="cid:qr-TKT-DEF456@asc"');
  });

  it("should work with a single ticket", async () => {
    const singleTicket = [{ ticketCode: "TKT-SINGLE" }];
    await sendTicketConfirmationEmail({
      buyerEmail: "buyer@test.com",
      tickets: singleTicket,
      event,
    });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).toContain("TKT-SINGLE");
    expect(QRCode.toBuffer).toHaveBeenCalledTimes(1);
    expect(html).toContain("Your Ticket</h2>");
    expect(mockSendMail.mock.calls[0][0].attachments).toHaveLength(1);
  });

  it("should omit opening time row if not set", async () => {
    const eventNoTime = { ...event, openingTime: undefined };
    await sendTicketConfirmationEmail({
      buyerEmail: "buyer@test.com",
      tickets,
      event: eventNoTime,
    });

    const html = mockSendMail.mock.calls[0][0].html;
    expect(html).not.toContain("Time</td>");
  });

  it("should set from address using EMAIL_USER env var", async () => {
    await sendTicketConfirmationEmail({ buyerEmail: "buyer@test.com", tickets, event });

    const mailOptions = mockSendMail.mock.calls[0][0];
    expect(mailOptions.from).toContain("test@example.com");
  });
});
