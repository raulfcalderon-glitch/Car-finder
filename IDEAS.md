# CarsFindMe — ideas log

Things we've discussed and want to come back to. Newest ideas at the top of each section.

## Features

- **Parts & specialty item requests.** Let buyers request parts and model-specific items, not just whole cars: factory sport bucket seats, matching luggage sets, original wheels, tool kits, owner's manuals and books, period options, etc. Notes for when we build it:
  - A "What are you looking for? Car / Part or accessory" choice at the top of the request form.
  - Parts requests still name the car(s) they fit (make, model, years, e.g. "Porsche 911 1974–89"), plus the part name, part number if known, condition (new / used / NOS / restored) and photos.
  - Many of these come from specialists and private collectors rather than car dealers, so we may want a "parts specialist" dealer type with its own verification checklist.
  - Separate Wanted list tab (Cars / Parts), dealer alerts by category, and a filter on the dealer Requests page.
- **AI request check.** On posting, catch impossible combinations (e.g. "1985 Porsche 993"), understand shorthand ("E46 M3", "air-cooled 911") and fill fields from one sentence. Suggest, never change silently. Estimated cost a fraction of a cent per request. Hold until there are real requests to learn from.
- **App:** first an installable web app (home-screen icon, push notifications for new responses and alerts), later an App Store app (needs Apple Developer account, Sign in with Apple, in-app account deletion, an LLC for a company listing).
- **Buyer reviews of dealers**, only after a request is marked "found", one review per deal.
- **Price-drop notice:** email the buyer when a dealer lowers the price on a response they passed on for price.
- **Dealer directory and homepage dealer strip** — built, switched off (`public/features.js` → `dealerDirectory`).
- SMS alerts; a daily digest option for dealer alerts.
- In-app messaging instead of sharing contact details.

## Business

- Microsoft 365 mailbox for carsfindme.com: waiting on Microsoft support to release the domain from the previous owner's tenant. Turn off Cloudflare Email Routing before adding Microsoft's records.
- Form the LLC; have a lawyer review the Terms and Privacy Policy and remove the "Draft" labels.
- Have a designer polish the final logo before printing merch or filing a trademark.
