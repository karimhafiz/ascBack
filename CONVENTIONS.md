# ascBack conventions

Express + Mongoose (MongoDB) API, JWT auth (short-lived access token + httpOnly refresh cookie), Cloudinary for image storage, Stripe for payments.

## Structure

- `models/` — Mongoose schemas.
- `controllers/` — request handlers, one file per resource.
- `routes/` — Express routers; role gating via `middleware/authorize("admin", "moderator", ...)`, auth via `middleware/authMiddleware`.
- `config/` — third-party client setup (`cloudinary.js`, `multer.js`).
- `utils/` — small shared helpers (e.g. `cloudinaryUtils.js`).

## Human-reviewed workflows

Not every write needs a review step — most resources (tickets, teams, bookings) are system/Stripe-driven status changes with no human approval. Where a role's direct-edit access is intentionally removed in favor of a submit → review → approve/decline flow (see `PageContentRequest`), keep that pattern: a request model with a `status` enum (`pending`/`approved`/`declined`), `requestedBy`/`reviewedBy`/`reviewedAt`, and controller actions that only ever mutate the live resource once a request is explicitly approved — never as a side effect of submission.

## Image uploads & deletion

Uploads go through `config/multer.js`'s `createUpload(folder)` (multer + Cloudinary storage), which each route calls with its own folder name. Deleting a Cloudinary asset must go through `utils/cloudinaryUtils.js#deleteCloudinaryImage`, which passes `{ invalidate: true }` to `cloudinary.uploader.destroy` so the CDN cache is purged along with the asset — don't call `cloudinary.uploader.destroy` directly elsewhere, and don't drop the `invalidate` flag, or deleted images can keep resolving under their old URL until the CDN cache happens to expire.

When a bulk delete needs to run over multiple images (e.g. cleaning up staged images that never went live, or images replaced by an approved edit), use `Promise.allSettled` rather than `Promise.all` — one failed delete shouldn't block the others or fail the whole request, since the deletions are cleanup, not the primary operation.

## Testing

Jest.
