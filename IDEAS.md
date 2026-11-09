# CarsFindMe — ideas log

Things we've discussed and want to come back to. Newest ideas at the top of each section.

## Features

- **Parts & specialty item requests.** Let buyers request parts and model-specific items, not just whole cars: factory sport bucket seats, matching luggage sets, original wheels, tool kits, owner's manuals and books, period options, etc. Notes for when we build it:
  - A "What are you looking for? Car / Part or accessory" choice at the top of the request form.
  - Parts requests still name the car(s) they fit (make, model, years, e.g. "Porsche 911 1974–89"), plus the part name, part number if known, condition (new / used / NOS / restored) and photos.
  - Many of these come from specialists and private collectors rather than car dealers, so we may want a "parts specialist" dealer type with its own verification checklist.
  - Separate Wanted list tab (Cars / Parts), dealer alerts by category, and a filter on the dealer Requests page.
- **AI request check.** On posting, catch impossible combinations (e.g. "1985 Porsche 993"), understand shorthand ("E46 M3", "air-cooled 911") and fill fields from one sentence. Suggest, never change silently. Estimated cost a fraction of a cent per request. Hold until there are real requests to learn from.
- **App Store app:** the installable web app with push notifications is done; a real App Store listing still needs an Apple Developer account ($99/yr), Sign in with Apple (since we offer Google sign-in), a native wrapper (e.g. Capacitor) and ideally the LLC for a company listing. Account deletion is already in place.
- **Buyer reviews of dealers**, only after a request is marked "found", one review per deal.
- **Price-drop notice:** email the buyer when a dealer lowers the price on a response they passed on for price.
- **Dealer directory and homepage dealer strip** — built, switched off (`public/features.js` → `dealerDirectory`).
- SMS alerts; a daily digest option for dealer alerts.
- Chat extras: typing/read receipts.

## Business

- Email: carsfindme.com mail runs on Google Workspace (MX, SPF, DKIM `google._domainkey` set in Cloudflare; Cloudflare Email Routing and Microsoft 365 abandoned). DMARC added as `p=none` (monitor); switch to `p=quarantine` after ~2 weeks of clean reports. Optional cleanup: delete the old `MS=ms…` and `cf2024-1._domainkey` TXT records.
- Form the LLC; have a lawyer review the Terms and Privacy Policy and remove the "Draft" labels.
- Have a designer polish the final logo before printing merch or filing a trademark.
