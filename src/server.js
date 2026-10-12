import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { createMailer } from './email.js';

const port = Number(process.env.PORT ?? 3000);
// Render persistent disks are mounted at /var/data. Use it automatically when present, so data
// survives restarts and deploys even if DATABASE_FILE was never set.
const PERSISTENT_DIR = '/var/data';
const dbFile =
  process.env.DATABASE_FILE ?? (existsSync(PERSISTENT_DIR) ? `${PERSISTENT_DIR}/car-finder.db` : 'data/car-finder.db');

const db = openDatabase(dbFile);
const accounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
const onDisk = dbFile.startsWith(`${PERSISTENT_DIR}/`);
// Render sets RENDER=true; warn there, since anything outside the disk is wiped on every restart.
const warning = process.env.RENDER && !onDisk ? ' — WARNING: not on a persistent disk, data will be lost on restart' : '';
console.log(`Database: ${dbFile} (${accounts} accounts)${warning}`);
const app = createApp(db, {
  secureCookies: process.env.NODE_ENV === 'production',
  // Dealer photos sit next to the database, so they're on the persistent disk too.
  uploadsDir: join(dirname(dbFile), 'uploads'),
  // Comma-separated emails of people who can approve dealers, e.g. "you@example.com,partner@example.com".
  // ADMIN_EMAIL (singular) is accepted too, since it's an easy name to type.
  adminEmails: [process.env.ADMIN_EMAILS, process.env.ADMIN_EMAIL].filter(Boolean).join(',').split(','),
  // Render sets RENDER_EXTERNAL_URL automatically; APP_URL overrides it (e.g. for a custom domain).
  appUrl: (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  sendEmail: createMailer({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM ?? 'CarsFindMe <onboarding@resend.dev>',
  }),
});

createServer(app).listen(port, () => {
  console.log(`CarsFindMe running at http://localhost:${port}`);
});
