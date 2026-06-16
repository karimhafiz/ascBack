# Venue Booking Feature Documentation

## Overview

The venue booking feature allows users to reserve the community centre for 4-hour slots. The system handles availability management, payment processing through Stripe, email notifications, and booking lifecycle management.

## Architecture

### Models

#### 1. **Venue** (`models/Venue.js`)

Represents the community centre venue.

**Fields:**

- `name` (String, required): Venue name
- `description` (String): Detailed description
- `street` (String, required): Street address
- `postCode` (String): Postal code
- `city` (String, required): City
- `capacity` (Number, required): Maximum attendees
- `pricePerHour` (Number, required): Price for 4-hour booking
- `images` ([String]): Cloudinary image URLs
- `amenities` ([String]): List of available amenities
- `rules` (String): Venue usage rules
- `cancellationPolicy` (String): Cancellation terms
- `isActive` (Boolean, default: true): Venue availability status
- `managedBy` (ObjectId, ref: User): Admin/Moderator managing the venue
- `timestamps`: Auto-managed createdAt and updatedAt

#### 2. **VenueSlot** (`models/VenueSlot.js`)

Represents individual 4-hour booking slots.

**Fields:**

- `venue` (ObjectId, required, ref: Venue): Associated venue
- `date` (Date, required): Slot date
- `startTime` (String, required): Start time (e.g., "09:00")
- `endTime` (String, required): End time (always 4 hours after startTime)
- `isAvailable` (Boolean, default: true): Whether slot can be booked
- `createdBy` (ObjectId, ref: User): Admin who created the slot
- **Indexes:**
  - Unique on (venue, date, startTime)
  - On isAvailable for quick filtering

#### 3. **VenueBooking** (`models/VenueBooking.js`)

Represents a user's booking of a venue slot.

**Fields:**

- `venue` (ObjectId, required, ref: Venue): Booked venue
- `slot` (ObjectId, required, ref: VenueSlot): Booked slot
- `user` (ObjectId, required, ref: User): User who made the booking
- `status` (Enum): One of ["pending", "confirmed", "completed", "cancelled"]
- `numberOfAttendees` (Number, required): Expected attendance
- `eventName` (String): Name of the event/purpose
- `eventDescription` (String): Event details
- `totalPrice` (Number, required): Booking cost
- `paymentStatus` (Enum): One of ["unpaid", "paid", "refunded"]
- `stripePaymentId` (String): Stripe payment intent ID
- `stripeChargeId` (String): Stripe charge ID
- `cancellationReason` (String): Reason for cancellation
- `cancelledAt` (Date): When booking was cancelled
- `cancelledBy` (ObjectId, ref: User): Who cancelled the booking
- `emailSent` (Boolean): Email notification status
- `confirmationEmailSent` (Boolean): Confirmation email status
- **Indexes:**
  - On user for fast lookups
  - On (venue, status)
  - On slot
  - On status

---

## API Endpoints

### Public Endpoints

#### 1. Get Venue Details

```
GET /venues/:venueId
```

Fetch community centre information.

**Response:**

```json
{
  "_id": "venue_id",
  "name": "Community Centre",
  "description": "Main venue for events",
  "street": "123 Main St",
  "city": "London",
  "capacity": 100,
  "pricePerHour": 150,
  "amenities": ["WiFi", "Parking", "Projector"],
  "managedBy": { "name": "Admin Name", "email": "admin@test.com" }
}
```

#### 2. Get Available Slots

```
GET /venues/:venueId/slots?date=YYYY-MM-DD
```

Fetch available 4-hour booking slots.

**Query Parameters:**

- `date` (optional): Filter by specific date

**Response:**

```json
[
  {
    "_id": "slot_id",
    "date": "2026-05-15T00:00:00Z",
    "startTime": "09:00",
    "endTime": "13:00",
    "isAvailable": true
  }
]
```

---

### Authenticated User Endpoints

#### 3. Create Booking Checkout

```
POST /venues/booking/checkout
```

Initiate Stripe payment for a booking.

**Request Body:**

```json
{
  "venueId": "venue_id",
  "slotId": "slot_id",
  "numberOfAttendees": 50,
  "eventName": "Team Meeting",
  "eventDescription": "Quarterly planning session"
}
```

**Response:**

```json
{
  "sessionId": "cs_test_123",
  "url": "https://checkout.stripe.com/..."
}
```

**Validations:**

- Slot must exist and be available
- numberOfAttendees must not exceed venue capacity
- slotId must be valid

#### 4. Confirm Booking (Callback)

```
GET /venues/booking/success?sessionId=...&slotId=...&venueId=...
```

Complete booking after successful payment.

**Automatically:**

- Verifies Stripe payment
- Creates VenueBooking record
- Marks slot as unavailable
- Sends confirmation email

**Response:**

```json
{
  "message": "Booking confirmed successfully",
  "booking": {
    "_id": "booking_id",
    "status": "confirmed",
    "paymentStatus": "paid",
    "totalPrice": 150
  }
}
```

#### 5. Get User's Bookings

```
GET /venues/my-bookings?status=confirmed
```

Retrieve user's bookings with filtering.

**Query Parameters:**

- `status` (optional): Filter by status

**Response:**

```json
[
  {
    "_id": "booking_id",
    "venue": { "name": "Community Centre", "street": "123 Main St", "city": "London" },
    "slot": { "date": "2026-05-15", "startTime": "09:00", "endTime": "13:00" },
    "status": "confirmed",
    "numberOfAttendees": 50,
    "totalPrice": 150,
    "eventName": "Team Meeting"
  }
]
```

#### 6. Get Booking Details

```
GET /venues/booking/:bookingId
```

Get specific booking information.

**Authorization:** User can view own bookings; admins can view all

**Response:**

```json
{
  "_id": "booking_id",
  "venue": {
    /* full venue object */
  },
  "slot": {
    /* full slot object */
  },
  "user": { "name": "John Doe", "email": "john@test.com", "phone": "..." },
  "status": "confirmed",
  "paymentStatus": "paid",
  "totalPrice": 150,
  "numberOfAttendees": 50,
  "eventName": "Team Meeting"
}
```

#### 7. Cancel Booking

```
POST /venues/booking/:bookingId/cancel
```

Cancel a booking with automatic refund processing.

**Request Body:**

```json
{
  "reason": "Schedule conflict"
}
```

**Automatically:**

- Issues refund via Stripe if paid
- Releases the slot for rebooking
- Marks booking as cancelled
- Sends cancellation email

**Response:**

```json
{
  "message": "Booking cancelled successfully",
  "booking": {
    "_id": "booking_id",
    "status": "cancelled",
    "paymentStatus": "refunded",
    "cancellationReason": "Schedule conflict"
  }
}
```

**Validations:**

- Cannot cancel already cancelled bookings
- Cannot cancel completed bookings
- Only booking owner or admins can cancel

---

### Admin/Moderator Endpoints

#### 8. Create Venue

```
POST /venues
Authorization: admin, moderator
```

Create the community centre venue.

**Request Body:**

```json
{
  "name": "Community Centre",
  "description": "Main venue",
  "street": "123 Main St",
  "postCode": "SW1A 1AA",
  "city": "London",
  "capacity": 100,
  "pricePerHour": 150,
  "amenities": ["WiFi", "Parking", "Projector"],
  "rules": "No outside food. Respect quiet hours after 10 PM.",
  "cancellationPolicy": "Free cancellation up to 7 days before."
}
```

**Response:**

```json
{
  "message": "Venue created successfully",
  "venue": {
    /* full venue object */
  }
}
```

#### 9. Update Venue

```
PUT /venues/:venueId
Authorization: admin, moderator (or admin)
```

Update venue details.

**Request Body:** Any subset of venue fields

**Response:**

```json
{
  "message": "Venue updated successfully",
  "venue": {
    /* updated venue object */
  }
}
```

#### 10. Create Venue Slots

```
POST /venues/:venueId/slots
Authorization: admin, moderator
```

Create multiple available booking slots.

**Single Slot:**

```json
{
  "date": "2026-05-15",
  "startTime": "09:00"
}
```

**Multiple Slots:**

```json
{
  "slots": [
    { "date": "2026-05-15", "startTime": "09:00" },
    { "date": "2026-05-15", "startTime": "14:00" },
    { "date": "2026-05-16", "startTime": "10:00" }
  ]
}
```

**Response:**

```json
{
  "message": "3 slot(s) created successfully",
  "slots": [
    {
      "_id": "slot_id_1",
      "date": "2026-05-15",
      "startTime": "09:00",
      "endTime": "13:00",
      "isAvailable": true
    }
  ]
}
```

**Automatic:**

- Calculates endTime as startTime + 4 hours
- Prevents duplicate slots (unique constraint on venue, date, startTime)

#### 11. Delete Venue Slot

```
DELETE /venues/slot/:slotId
Authorization: admin, moderator
```

Remove a slot (only if not booked).

**Response:**

```json
{
  "message": "Slot deleted successfully"
}
```

**Validations:**

- Cannot delete slots with active bookings

---

### Admin Only Endpoints

#### 12. Get All Bookings

```
GET /venues/admin/bookings?status=confirmed&venueId=venue_id
Authorization: admin
```

View all bookings with filtering.

**Query Parameters:**

- `status` (optional): Filter by status
- `venueId` (optional): Filter by venue

**Response:**

```json
[
  {
    "_id": "booking_id",
    "venue": { "name": "Community Centre" },
    "user": { "name": "John Doe", "email": "john@test.com" },
    "slot": { "date": "2026-05-15", "startTime": "09:00" },
    "status": "confirmed",
    "numberOfAttendees": 50,
    "totalPrice": 150
  }
]
```

#### 13. Complete Booking

```
POST /venues/booking/:bookingId/complete
Authorization: admin
```

Mark booking as completed (e.g., after event finishes).

**Response:**

```json
{
  "message": "Booking marked as completed",
  "booking": {
    "_id": "booking_id",
    "status": "completed"
  }
}
```

---

## Workflow Examples

### Scenario 1: User Books a Venue

1. **Admin/Moderator creates slots:**

   ```
   POST /venues/:venueId/slots
   { "date": "2026-05-15", "startTime": "09:00" }
   ```

2. **User views available slots:**

   ```
   GET /venues/:venueId/slots?date=2026-05-15
   ```

3. **User initiates booking:**

   ```
   POST /venues/booking/checkout
   {
     "venueId": "...",
     "slotId": "...",
     "numberOfAttendees": 30,
     "eventName": "Workshop"
   }
   ```

4. **User completes Stripe payment:**
   Redirects to Stripe checkout, then back to success URL

5. **Booking confirmed:**
   - VenueBooking created with "confirmed" status
   - Slot marked as unavailable
   - Confirmation email sent

6. **Admin marks as completed after event:**
   ```
   POST /venues/booking/:bookingId/complete
   ```

### Scenario 2: User Cancels a Booking

1. **User cancels:**

   ```
   POST /venues/booking/:bookingId/cancel
   { "reason": "Schedule conflict" }
   ```

2. **System processes:**
   - Issues refund via Stripe
   - Updates booking status to "cancelled"
   - Marks slot as available
   - Sends cancellation email

---

## Email Notifications

### Confirmation Email

Sent immediately after booking confirmation with:

- Venue details (name, address, capacity)
- Booking date and time
- Attendance count
- Event name and description
- Booking reference
- Venue rules and cancellation policy

### Cancellation Email

Sent when booking is cancelled with:

- Venue and booking details
- Cancellation date/time
- Refund status
- "Refund appears in 3-5 business days" message

---

## Error Handling

| Scenario                    | HTTP Status | Error Message                                  |
| --------------------------- | ----------- | ---------------------------------------------- |
| Non-admin creating venue    | 403         | "Only admins and moderators can create venues" |
| Slot not available          | 400         | "Selected slot is not available"               |
| Attendees exceed capacity   | 400         | "Number of attendees exceeds venue capacity"   |
| Venue not found             | 404         | "Venue not found"                              |
| Slot already booked         | 400         | "Cannot delete slot with active bookings"      |
| Unauthorized booking access | 403         | "Not authorized to view this booking"          |
| Cancel already cancelled    | 400         | "Booking is already cancelled"                 |
| Refund failure              | 500         | "Failed to process refund"                     |

---

## Testing

Run tests:

```bash
npm test
```

Test coverage includes:

- Model validation and relationships
- Venue CRUD operations
- Slot creation and filtering
- Booking checkout process
- Booking confirmation and cancellation
- Authorization checks
- Email notification triggers
- Stripe integration

---

## Integration Checklist

- ✅ Models created (Venue, VenueSlot, VenueBooking)
- ✅ Controller with all handlers
- ✅ Routes with proper authorization
- ✅ Stripe payment integration
- ✅ Email notifications
- ✅ Unit tests
- ✅ Error handling
- [ ] Frontend integration (to be done)
- [ ] Environment variables configured (STRIPE_SECRET_KEY, FRONT_END_URL, etc.)

---

## Future Enhancements

1. **Recurring bookings:** Support weekly/monthly recurring slots
2. **Bulk operations:** Create multiple slots for multiple dates at once
3. **Waitlist:** Allow users to join waitlist for fully booked slots
4. **Discounts:** Apply promo codes or group booking discounts
5. **Notifications:** SMS reminders before event
6. **Reviews:** User reviews and ratings for bookings
7. **Calendar view:** Interactive calendar for availability
8. **Deposits:** Require deposits for bookings
9. **Late cancellation:** Reduced refunds for late cancellations
10. **Analytics:** Booking statistics and revenue reports
