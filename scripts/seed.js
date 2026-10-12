// Fills the local database with demo accounts and requests so the dealer list has something to show.
// Usage: npm run seed   (all demo passwords are "password123")
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const db = openDatabase(process.env.DATABASE_FILE ?? 'data/car-finder.db');
const password = hashPassword('password123');

const addAccount = db.prepare(`
  INSERT INTO accounts (email, password_hash, name, role, business_name, phone, email_verified_at, terms_accepted_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  ON CONFLICT(email) DO UPDATE SET name = excluded.name RETURNING id`);

const buyers = [
  ['buyer@example.com', 'Alex Rivera'],
  ['jordan@example.com', 'Jordan Lee'],
  ['sam@example.com', 'Sam Patel'],
].map(([email, name]) => addAccount.get(email, password, name, 'user', null, null).id);

addAccount.get('dealer@example.com', password, 'Morgan Chen', 'dealer', 'Stuttgart Classics', '(512) 555-0142');

const addRequest = db.prepare(`
  INSERT INTO requests (user_id, make, model, trim, year_min, year_max, max_budget, condition, color, location, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);

const demo = [
  ['Porsche', '911 Carrera', 'Targa', 1987, 1987, 85000, 'excellent', 'Guards Red', 'Austin, TX', 'G50 gearbox, under 80k miles, service records.', '-2 hours'],
  ['BMW', 'M3', 'E30', 1988, 1991, 95000, 'good', null, 'Denver, CO', 'Driver-quality is fine. No rust.', '-1 days'],
  ['Toyota', 'Land Cruiser', 'FJ62', 1988, 1990, 45000, 'any', 'Tan', 'Portland, OR', 'Open to light restomods.', '-3 days'],
  ['Mercedes-Benz', '190E', '2.3-16 Cosworth', 1984, 1988, 40000, 'good', 'Smoke Silver', 'Atlanta, GA', null, '-5 days'],
  ['Ford', 'Bronco', null, 1966, 1977, 70000, 'project', null, 'Phoenix, AZ', 'Original body panels preferred.', '-8 days'],
  ['Porsche', '944', 'Turbo', 1986, 1989, 35000, 'excellent', null, 'Seattle, WA', 'Manual only.', '-12 days'],
  ['Acura', 'NSX', null, 1991, 1994, 120000, 'concours', 'Formula Red', 'Miami, FL', null, '-20 hours'],
  ['Datsun', '240Z', null, 1970, 1973, 30000, 'project', null, 'Sacramento, CA', 'Running preferred but not required.', '-15 days'],
];

demo.forEach((row, i) => addRequest.run(buyers[i % buyers.length], ...row));
console.log(`Seeded ${demo.length} requests. Log in as buyer@example.com or dealer@example.com (password: password123).`);
