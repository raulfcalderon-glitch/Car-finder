import { createServer } from 'node:http';
import { openDatabase } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const dbFile = process.env.DATABASE_FILE ?? 'data/car-finder.db';

const db = openDatabase(dbFile);
const app = createApp(db, { secureCookies: process.env.NODE_ENV === 'production' });

createServer(app).listen(port, () => {
  console.log(`Car Finder running at http://localhost:${port}`);
});
