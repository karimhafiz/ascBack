# ASC Backend

Express + Mongoose REST API for ASC — a community sports/events organisation. Handles events, tournaments/teams, courses (incl. subscriptions), venue bookings, ticketing, Stripe payments, moderated page-content editing, and admin/analytics.

## Tech stack

- **Express 4** + **Mongoose 8** (MongoDB)
- **JWT auth** — short-lived access token (`Authorization: Bearer`) + httpOnly refresh cookie
- **Stripe** — one-off payments (tickets, venue bookings, one-off course enrolments) and subscriptions (recurring courses, event tournament subscriptions), driven by webhooks
- **Cloudinary** (via `multer-storage-cloudinary`) — image uploads
- **Google OAuth** (`google-auth-library`/`googleapis`) — alternate login method alongside email/password
- **pino** / **pino-http** — structured logging
- **express-rate-limit** — auth and guest-checkout endpoints
- **express-mongo-sanitize** — strips `$`/`.` keys from `req.body`/`query`/`params` to prevent NoSQL operator injection
- **Jest** + **Supertest** — tests

## Structure

```
config/       third-party client setup (cloudinary.js, multer.js, db.js, emailConfig.js)
controllers/  request handlers, one file per resource
routes/       Express routers — role gating via middleware/authorize(...), auth via middleware/authMiddleware
middleware/   authMiddleware (JWT verify), authorize (role check)
models/       Mongoose schemas
utils/        shared helpers (logger, email, Cloudinary delete, Stripe error mapping, ticket/token utils,
              subscriptionLifecycle.js — shared cancel/reactivate/webhook handling for recurring billing)
scripts/      one-time migration/backfill/cleanup scripts (see below) — not run automatically
__tests__/    Jest tests, mirroring controllers/middleware/models/routes
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values — every var below is documented there too, generated from what the code actually reads.

```
MONGO_URI=...                                # MongoDB connection string
JWT_SECRET=...                               # signs/verifies access + refresh tokens
GOOGLE_CLIENT_ID=...                         # Google OAuth client ID (verified server-side)

STRIPE_SECRET_KEY=...
STRIPE_COURSE_WEBHOOK_SECRET=...             # /courses/webhook — course enrollment + subscription billing
STRIPE_EVENT_SUBSCRIPTION_WEBHOOK_SECRET=... # /events/subscriptions/webhook — event subscription billing

# Note: one-off ticket and venue-booking checkouts have no webhook — they're
# fulfilled synchronously on the Stripe success redirect, not via webhook.

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

EMAIL_USER=...                               # Gmail SMTP sender (nodemailer)
GMAIL_APP_PASSWORD=...

FRONT_END_URL=...                            # used to build Stripe success/cancel redirect URLs + CORS allowlist
BACK_END_URL=...                             # used to build Stripe webhook-facing redirect URLs

LOGGER_LEVEL=info                            # optional, pino log level
PORT=5000                                    # optional, local dev only (Vercel ignores this)
```

`NODE_ENV`/`VERCEL` are read but set by the platform, not `.env`.

## Auth

Two login paths, both issuing the same JWT shape:

- **Email/password**: `POST /users/register`, `POST /users/login` (bcrypt-hashed passwords)
- **Google Sign-In**: client obtains an ID token from Google's SDK and `POST /users/google` with it; the backend verifies it via `google-auth-library` and creates/looks up the user

Both flows return a short-lived `accessToken` (sent as `Authorization: Bearer`) and set an httpOnly refresh cookie. `POST /users/refresh` rotates both. `authMiddleware` verifies the access token and attaches `req.user`; `authorize("admin", "moderator", ...)` gates by `req.user.role` on top of that — routes needing only authentication use `authMiddleware` alone, routes needing a specific role stack both. Ownership-scoped resources (a user's own bookings/tickets/enrollments/teams) additionally compare the record's owner against `req.user.id`/`email` inside the controller, since `authMiddleware`/`authorize` alone don't express per-record ownership.

`authLimiter`/`guestCheckoutLimiter` (`express-rate-limit`) throttle login/register/refresh/google-login and the unauthenticated guest-checkout endpoints.

## API overview

All paths below are mounted at the repo root (no `/api` prefix).

| Mount | Resource |
|---|---|
| `/users` | register, login, Google login, refresh, logout, profile (own tickets/teams/enrollments/subscriptions/bookings) |
| `/events` | CRUD, subscription checkout + webhook, subscription-success redirect |
| `/tickets` | admin ticket issuance/listing, lookup by payment/id/ticket-code, QR verification |
| `/payments` | guest + authenticated ticket checkout, Stripe success/session/guest-order endpoints |
| `/teams` | tournament team registration, manager self-edit, payment success/cancel redirects |
| `/courses` | CRUD, enrollment (one-off + subscription), enrollment management, Stripe webhook |
| `/venues` | CRUD, slot/schedule management, booking checkout + webhook-driven confirm, user/admin booking views, cancel |
| `/pageContent` | moderator-edited static page sections (About/Home/etc.) |
| `/pageContentRequests` | submit → review → approve/decline workflow for moderator content edits (see below) |
| `/admin` | user management — list, delete, change role, ban/unban |
| `/stats` | `/public` (homepage counters) and `/admin` (full analytics dashboard) |

Most read endpoints (events, courses, venues, public stats, page content) are public; writes and anything user- or role-scoped require `authMiddleware`.

## Human-reviewed workflows

Most resources (tickets, teams, bookings) change status automatically via system/Stripe events — no human approval step. Where a role's direct-edit access is intentionally replaced with a submit → review → approve/decline flow (`PageContentRequest` is the current example), the pattern is: a request model with a `status` enum (`pending`/`approved`/`declined`), `requestedBy`/`reviewedBy`/`reviewedAt`, and controller actions that only mutate the live resource once a request is explicitly approved — never as a side effect of submission.

## Image uploads & deletion

Uploads go through `config/multer.js`'s `createUpload(folder)` (multer + Cloudinary storage), called per-route with its own folder name. Deleting a Cloudinary asset must go through `utils/cloudinaryUtils.js#deleteCloudinaryImage`, which passes `{ invalidate: true }` so the CDN cache is purged along with the asset — never call `cloudinary.uploader.destroy` directly elsewhere. Bulk deletes (e.g. cleaning up replaced/staged images) use `Promise.allSettled` so one failed delete doesn't block the rest.

## Payments

Stripe drives three flows — ticket purchase, venue booking, and course enrolment/subscription — plus a separate event-subscription (tournament) billing flow, each with its own webhook secret/endpoint. Webhooks are idempotent (`WebhookEvent`/`stripeEventId` dedup) and out-of-order-safe (`lastStripeEventTimestamp` on `EventSubscription`/`CourseEnrollment` — an update only applies if the incoming event is newer than the last one already processed). `utils/stripeErrorUtils.js` maps Stripe-outage errors to a distinct response so the frontend can show a "payment provider unavailable" state instead of a generic error.

Course and event-subscription recurring billing (cancel, reactivate, and webhook handling) share one implementation via `utils/subscriptionLifecycle.js` — `courseController.js`/`eventSubscriptionController.js` each just configure it with their own Model, field names, and messages, rather than each maintaining their own copy of the cancel/reactivate/webhook logic.

One-off ticket and venue booking success URLs point at the backend, not the frontend — the backend does the authoritative DB write (create ticket, decrement capacity, issue refund on failure) before redirecting the browser to the frontend confirmation page."

## Maintenance scripts (`scripts/`)

One-time/manual scripts, not run automatically — invoke with `node scripts/<name>.js`, each loads `.env` itself:

- `backfillCodes.js` — assigns human-readable codes (ticket/enrollment/team/booking) to pre-existing records
- `backfillRevenue.js` — populates `totalAmountPaid` on historical Ticket/EventSubscription/CourseEnrollment records from Stripe
- `cleanupOrphans.js` — deletes records whose parent resource no longer exists (e.g. a Ticket for a deleted Event)
- `migrateRecurringSubscriptions.js` — creates missing Stripe products/prices for existing recurring paid events

## Running

```bash
npm install
npm start          # node index.js
npm test           # jest
npm run lint        # eslint .
npm run format       # prettier --write .
```

Husky + lint-staged run eslint/prettier on staged files pre-commit.
