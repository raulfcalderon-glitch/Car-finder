# CarsFindMe

A two-sided marketplace for enthusiast cars — 911s, BMW M cars, special editions and exotics. Live at [carsfindme.com](https://carsfindme.com).

- **Users** (buyers) post a request for the exact car they want — e.g. a 1987 Porsche 911 Carrera — with year range, budget, condition, color, location and notes.
- **Dealers** (licensed dealers, and brokers / independent specialists) apply with checkable details — business name, role, phone, address, website, dealer license and state (licensed dealers), track record and references (brokers). An admin works through a checklist (license looked up with the state, website/references checked, publicly listed number called) before they can approve; approved dealers show a **Verified** badge to buyers. They then browse every open request in a searchable, sortable list and respond with what they have and an asking price.
- **Admins** see every user and dealer with activity and last login, approve dealers, **edit, hide or delete any request**, and **freeze** accounts: a frozen account is signed out and can't sign in, a frozen user's requests are hidden from dealers, and a frozen dealer's responses are hidden from buyers.
- **Accounts:** signup requires accepting the Terms and Privacy Policy and confirming the email address (needed before posting a request or responding); "forgot password" emails a one-hour, single-use reset link; repeated wrong passwords lock that email out for 15 minutes.
- **Continue with Google (buyers only):** when `GOOGLE_CLIENT_ID` is set, the log-in and buyer sign-up pages show Google's button. New Google users accept the Terms in one extra step; their email counts as confirmed. A Google sign-in with the email of an existing buyer links to that account; dealer emails are refused (dealers use the application and a password). Tokens are verified in `src/google.js` against Google's published keys, with no extra packages.
- **Dealer profiles (public):** every dealer gets a page at `/d/<slug>` (from their business name) with a cover photo, logo, About text, up to 8 specialties, city, year founded, website and Instagram links, a gallery of up to 8 captioned photos, and "What CarsFindMe checked" (from the admin checklist, never the notes). It goes public once the dealer is approved; pending dealers can prepare it. Dealer names on responses link to it. The `/d/` link carries the dealer's own link-preview tags (title, bio, cover photo). Admins can hide a profile, remove the cover or any gallery photo; anyone can report a profile through Contact us.
- **Dealer directory:** `#/dealers` lists approved dealers whose public profile is finished (a logo and a description), verified first, with search and filters by specialty and state. The homepage shows a strip of them with the count once at least 3 are listed; until then it explains how dealers are verified. Visitors and buyers get a **Dealers** link in the top bar.
- **Demo dealers:** Admin → **Add 3 demo dealers** creates sample verified dealers (marked "(Demo)") that only admins can see, to preview the homepage strip and directory. Visitors, buyers and dealers never see them, nobody can log in as them, and they never get alerts. **Remove demo dealers** deletes them.
- **Dealer alerts:** approved dealers get an email for each new request — all of them, only certain makes, or off, with an optional minimum budget (set on the **Alerts** page). Emails include a one-click unsubscribe (also via mail apps' `List-Unsubscribe`).
- **Photos:** dealers can attach up to 6 photos to a response. The browser shrinks them (max 1600px JPEG) before upload; the server checks they're real JPEG/PNG/WebP files and stores them in `uploads/` next to the database (so on the persistent disk). Buyers see them on the request and in the response email.
- **Profiles:** everyone can upload a profile picture (center-cropped to a square in the browser); without one, a colored circle shows up to two initials (business name for dealers). Dealers' pictures show on their responses, buyers' on their requests.
- **Reports:** buyers can report a dealer's response (deposit/wire request, misleading, conduct, spam, other) once per response; admins get an email and a **Reports** tab to review and resolve, and each dealer's page lists its reports.
- **Homepage:** animated hero, example request cards, a live ticker of recent requests, scroll-in sections, and a quick-start box ("What are you hunting for?") that pre-fills the request form (through signup for visitors). Motion is turned off for reduced-motion users. A **Contact us** page sends messages to admins.
- **Makes & models:** `public/vehicles.js` is a shared catalog (~140 enthusiast makes with nicknames like VW, Chevy, Merc; model suggestions for ~45 makes). The request form autocompletes make and model and asks "Did you mean Porsche?" for likely typos; the server saves known makes under one standard spelling (and fixes older requests at startup), and dealer search, filters and alerts use the standard names.
- **Request expiry:** requests close by themselves after 60 days so dealers only see buyers who are still looking. A week before, the buyer gets a "Still looking?" email with a one-click **keep it open** link (no login needed); when it closes they get a reopen link. Reopening gives a fresh 60 days. The check runs at startup and hourly.
- **Buyer feedback:** buyers mark each response **Interested** (the dealer is emailed; the buyer's contact details are not shared) or **Not for me** with an optional reason (price, spec, condition, found one elsewhere). Dealers see the reaction on the request and on their **My responses** page.
- **Dealer edits:** dealers can edit a response's price or message while the request is open (buyers see "edited"), or **withdraw** it if the car sold (buyers see it marked withdrawn; it no longer counts).
- **Link previews:** `og:`/Twitter tags and `public/og-image.png` (1200×630) give a branded card when carsfindme.com is shared; `apple-touch-icon.png` is the home-screen icon.
- Buyers get an **email alert** when a dealer responds, and see each response with the dealer's contact details. Dealers only see a buyer's first name and only their own responses, not competitors'.

## Run it

Requires Node.js 22.13 or newer. There are no dependencies to install.

```sh
npm run seed   # optional: demo data (buyer@example.com / dealer@example.com, password "password123")
npm start      # http://localhost:3000
npm test
```

Environment variables:

- `PORT` (default 3000), `DATABASE_FILE` (default `/var/data/car-finder.db` when a Render disk is mounted at `/var/data`, otherwise `data/car-finder.db`), `NODE_ENV=production` to mark the session cookie `Secure`.
- `ADMIN_EMAILS` – comma-separated emails of the accounts that can approve dealers (on the **Admin** page) and get an email when a dealer signs up. New dealers stay "waiting for approval" until an admin approves them.
- `RESEND_API_KEY` – API key from [Resend](https://resend.com) for email alerts. Without it, emails are printed to the server log instead of sent.
- `EMAIL_FROM` – sender, e.g. `CarsFindMe <alerts@yourdomain.com>` (default `CarsFindMe <onboarding@resend.dev>`, Resend's test sender, which can only deliver to your own Resend account's email until you verify a domain).
- `GOOGLE_CLIENT_ID` – OAuth Client ID (Web application) from Google Cloud Console; turns on "Continue with Google" for buyers. Add `https://carsfindme.com` (and `http://localhost:3000` for local testing) under **Authorized JavaScript origins**.
- `APP_URL` – public address used for links in emails (defaults to Render's `RENDER_EXTERNAL_URL`).

## Backups

Render snapshots the disk automatically every 24 hours and keeps each snapshot for at least 7 days (Disk page in the Render dashboard). Admins can also download a full copy of the database any time from **Admin → Download backup**; it's a standard SQLite file. Dealer photos aren't in that download; they're in the `uploads/` folder on the disk, which Render's snapshots do cover. Keep downloads somewhere private: they contain everyone's contact details (passwords are stored only as hashes).

## Legal pages

`public/legal.js` holds **draft** Terms of Service and Privacy Policy text (operator: Raul Calderon, Miami, FL; Florida law). Have a lawyer review them before relying on them, then remove the "Draft — pending legal review" labels.

## How it's built

- `src/server.js` – starts the HTTP server.
- `src/app.js` – JSON API and static file serving (Node's built-in `http`, no framework).
- `src/db.js` – SQLite schema via Node's built-in `node:sqlite`: `accounts`, `sessions`, `requests`, `responses`.
- `src/auth.js` – scrypt password hashing and session tokens (HttpOnly cookie).
- `src/email.js` – emails (alerts, confirmations, password resets) via Resend's HTTP API.
- `src/ratelimit.js` – in-memory limits on login attempts and outgoing account emails.
- `public/vehicles.js` – make/model catalog, make standardization and typo suggestions (used by both browser and server).
- `src/verification.js` – dealer verification rules: required checks, the Verified badge, email-domain signal.
- `public/` – the single-page front end in plain HTML/CSS/JS.
- `test/` – API tests using `node:test`.

### API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/signup`, `/api/login`, `/api/logout` | anyone | Accounts (`role` is `user` or `dealer`; signup needs `acceptTerms: true`) |
| GET | `/api/me` | anyone | Current account |
| GET | `/api/config` | anyone | Public settings for the browser (`googleClientId`) |
| POST | `/api/auth/google` | anyone | Buyer sign-in/sign-up with a Google ID token (`credential`); returns `needsTerms` for new accounts until `acceptTerms: true` |
| POST | `/api/contact` | anyone | Contact form: `name`, `email`, `topic`, `message`; stored in `contact_messages` and emailed to admins (honeypot + 5/hour per address) |
| GET | `/api/public/recent-requests` | anyone | Homepage ticker: year, make, model and trim of the 10 latest open, visible requests (nothing else) |
| PUT | `/api/me/alerts` | dealer | Alert settings: `mode` (`all`, `makes`, `off`), `makes` (list or comma-separated), `minBudget` |
| PUT / DELETE | `/api/me/avatar` | signed in | Set (`photo` as an image data URL) or remove your profile picture |
| POST | `/api/alerts/unsubscribe?token=` | anyone | Turn off a dealer's alerts from an email link |
| POST | `/api/verify` | anyone | Confirm an email address with the emailed `token` |
| POST | `/api/verify/resend` | signed in | Send a new confirmation email |
| POST | `/api/password/forgot` | anyone | Email a reset link (same response whether or not the account exists) |
| POST | `/api/password/reset` | anyone | Set a new `password` with the emailed `token`; signs out other sessions |
| GET | `/api/admin/backup` | admin | Download the whole database as a SQLite file |
| POST | `/api/requests` | user | Post a vehicle request |
| GET | `/api/my/requests` | user | Your requests with response counts |
| PATCH | `/api/requests/:id` | owning user | Edit fields or set `status` (`open`, `fulfilled`, `closed`) |
| GET | `/api/requests` | approved dealer | Search open requests (see below) |
| GET | `/api/makes` | dealer | Makes that have open requests (for the filter) |
| GET | `/api/requests/:id` | owner, dealer or admin | Request details plus responses (`viewer` says which view you got) |
| GET | `/api/admin/stats` | admin | Dashboard totals (users, dealers, open requests, recent activity, frozen) |
| GET | `/api/admin/accounts?role=dealer` | admin | Users or dealers with activity counts and last login; `status` (`all`, `active`, `pending`, `rejected`, `frozen`), `q`, `sort` (`newest`, `oldest`, `name`, `last_login`, `activity`) |
| GET | `/api/admin/accounts/:id` | admin | One account with its requests (users) or responses (dealers) |
| PATCH | `/api/admin/accounts/:id` | admin | `check` (`license`, `web`, `call`) with `done` and optional `note` records a verification step; `status` approves (only once required checks are done) or rejects a dealer; `verified: true` confirms their email; `frozen: true` (with optional `reason`) or `false` freezes/unfreezes any non-admin account; for dealers, `profileHidden` (with optional `reason`) and `removeCover: true` moderate the public profile |
| GET | `/api/admin/requests` | admin | Every request with buyer details; `q` (vehicle, notes, location, buyer name/email, `#id`), `status` (`open` default, `fulfilled`, `closed`, `all`), `visibility` (`all`, `visible`, `hidden`), `sort` |
| PATCH | `/api/admin/requests/:id` | admin | Edit any request field, set `status`, or `hidden: true` (with optional `reason`) / `false` to hide it from dealers |
| DELETE | `/api/admin/requests/:id` | admin | Permanently delete a request and its responses |
| POST | `/api/requests/:id/renew` | owning user | Keep the request open for another 60 days (or reopen it) |
| POST | `/api/requests/renew` | anyone with the emailed `token` | Same, from the reminder email's one-click link |
| PUT | `/api/responses/:id/feedback` | buyer who received it | `feedback` (`interested`, `not_for_me` or `null`), optional `reason` (`price`, `spec`, `condition`, `found`, `other`) |
| GET | `/api/my/responses` | dealer | Your responses with the buyer's feedback |
| PATCH / DELETE | `/api/responses/:id` | the dealer who sent it | Edit `message` / `price` (request must be open), or withdraw it |
| POST | `/api/requests/:id/responses` | approved dealer | Respond with `message`, optional `price`, and optional `photos` (up to 6 image data URLs) |
| POST | `/api/responses/:id/reports` | buyer who received it | Report a dealer's response: `reason` (`deposit`, `misleading`, `conduct`, `spam`, `other`), optional `details` |
| GET | `/api/admin/reports?status=open` | admin | Reports (`open`, `resolved`, `all`) with dealer, reporter, request and response |
| PATCH | `/api/admin/reports/:id` | admin | Set a report's `status` (`resolved` or `open`) |
| GET | `/api/dealers` | anyone | Directory of listed dealers; `q`, `specialty`, `state` (two letters), `limit`. Returns `total`, `count`, `dealers` and filter choices |
| GET | `/api/dealers/:slug` | anyone | A dealer's public profile (admins and the dealer also see it while hidden or pending) |
| GET / PUT | `/api/me/profile` | dealer | Your profile; PUT `bio`, `specialties` (list), `city`, `foundedYear`, `instagram` |
| PUT / DELETE | `/api/me/cover` | dealer | Set (`photo` data URL) or remove your cover photo |
| POST | `/api/me/gallery` | dealer | Add a gallery photo (`photo`, optional `caption`), up to 8 |
| DELETE | `/api/me/gallery/:id`, `/api/admin/gallery/:id` | dealer (own) / admin | Remove a gallery photo |
| GET | `/uploads/:file` | anyone with the link | A response photo (random, unguessable names) |

`GET /api/requests` query parameters: `q` (free text; every word must match make/model/trim/color/location/notes, and a 4-digit year matches requests whose range covers it), `make`, `year` (requests whose range includes it), `condition`, `minBudget`, `status` (`open` by default, or `all`), `sort` (`newest`, `oldest`, `budget_desc`, `budget_asc`, `year_desc`, `year_asc`, `make`, `responses`), `limit`, `offset`.

## Ideas for next steps

- SMS alerts; a daily digest option for dealer alerts.
- In-app messaging instead of sharing contact details.
- Deploy behind HTTPS (e.g. Fly.io, Render, Railway) with a persistent volume for the SQLite file, or move to Postgres.
