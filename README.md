# Car Finder

A two-sided marketplace for hard-to-find vehicles.

- **Users** (buyers) post a request for the exact car they want — e.g. a 1987 Porsche 911 Carrera — with year range, budget, condition, color, location and notes.
- **Dealers** (specialty dealerships, brokers, people in the car business) browse every open request in a searchable, sortable list and respond with what they have and an asking price.
- Buyers see each dealer's response along with the dealer's contact details. Dealers only see a buyer's first name and only their own responses, not competitors'.

## Run it

Requires Node.js 22.13 or newer. There are no dependencies to install.

```sh
npm run seed   # optional: demo data (buyer@example.com / dealer@example.com, password "password123")
npm start      # http://localhost:3000
npm test
```

Environment variables: `PORT` (default 3000), `DATABASE_FILE` (default `data/car-finder.db`), `NODE_ENV=production` to mark the session cookie `Secure`.

## How it's built

- `src/server.js` – starts the HTTP server.
- `src/app.js` – JSON API and static file serving (Node's built-in `http`, no framework).
- `src/db.js` – SQLite schema via Node's built-in `node:sqlite`: `accounts`, `sessions`, `requests`, `responses`.
- `src/auth.js` – scrypt password hashing and session tokens (HttpOnly cookie).
- `public/` – the single-page front end in plain HTML/CSS/JS.
- `test/` – API tests using `node:test`.

### API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/signup`, `/api/login`, `/api/logout` | anyone | Accounts (`role` is `user` or `dealer`) |
| GET | `/api/me` | anyone | Current account |
| POST | `/api/requests` | user | Post a vehicle request |
| GET | `/api/my/requests` | user | Your requests with response counts |
| PATCH | `/api/requests/:id` | owning user | Edit fields or set `status` (`open`, `fulfilled`, `closed`) |
| GET | `/api/requests` | dealer | Search open requests (see below) |
| GET | `/api/makes` | dealer | Makes that have open requests (for the filter) |
| GET | `/api/requests/:id` | owner or dealer | Request details plus responses |
| POST | `/api/requests/:id/responses` | dealer | Respond with `message` and optional `price` |

`GET /api/requests` query parameters: `q` (free text; every word must match make/model/trim/color/location/notes, and a 4-digit year matches requests whose range covers it), `make`, `year` (requests whose range includes it), `condition`, `minBudget`, `status` (`open` by default, or `all`), `sort` (`newest`, `oldest`, `budget_desc`, `budget_asc`, `year_desc`, `year_asc`, `make`, `responses`), `limit`, `offset`.

## Ideas for next steps

- Email/SMS notifications to buyers when a dealer responds, and to dealers when a request matches a saved search.
- Dealer verification before they can respond.
- Photos on dealer responses, and in-app messaging instead of sharing contact details.
- Deploy behind HTTPS (e.g. Fly.io, Render, Railway) with a persistent volume for the SQLite file, or move to Postgres.
