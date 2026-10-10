import { createServer } from 'node:http';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
import { createMailer } from './email.js';

const port = Number(process.env.PORT ?? 3000);
const dbFile = process.env.DATABASE_FILE ?? 'data/car-finder.db';

const db = openDatabase(dbFile);
const app = createApp(db, {
  secureCookies: process.env.NODE_ENV === 'production',
  // Render sets RENDER_EXTERNAL_URL automatically; APP_URL overrides it (e.g. for a custom domain).
  appUrl: (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
  sendEmail: createMailer({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM ?? 'Car Finder <onboarding@resend.dev>',
  }),
});

createServer(app).listen(port, () => {
  console.log(`Car Finder running at http://localhost:${port}`);
});
