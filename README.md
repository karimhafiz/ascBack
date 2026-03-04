# ASC Backend

This directory contains the Express.js server for the ASC application.

## Environment variables

Create a `.env` file in this folder with at least the following values:

```
MONGO_URI=...            # your MongoDB connection string
JWT_SECRET=...           # secret used for signing JWTs
GOOGLE_CLIENT_ID=...     # OAuth 2.0 client ID from Google Cloud Console
```

The application already depends on `google-auth-library` for server‑side
Google token verification.  Only the backend currently handles OAuth – the
frontend will call `/auth/google` with the ID token it obtains from the
Google Sign‑In SDK.

## Google authentication flow (backend)

1. Client obtains `idToken` from Google via the JavaScript SDK or mobile
   libraries.
2. Client sends POST `/auth/google` with `{ tokenId: "..." }`.
3. Backend verifies the token using `google-auth-library`, creates/looks up a
   user record, and responds with a local JWT.

Other authentication endpoints live under `/auth` as well (regular
`/register` and `/login`).  The `authMiddleware` exports utility functions to
verify tokens and generate new ones.

## Running

```bash
npm install
npm start          # production
npm test           # runs jest tests including auth tests
```
