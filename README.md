# TALORA — Premium Digital Ecosystem

A fully responsive, animated company landing page for **TALORA** — a premium ecosystem connecting clients with skilled people. Built with vanilla HTML, CSS and JavaScript, animated with GSAP and AOS.

## Features

- Smooth GSAP scroll-triggered animations and AOS reveals
- Fully responsive layout (mobile, tablet and desktop)
- Animated studio timeline and skills marquee
- Interactive "Build With TALORA" orbital card system
- Auto-rotating "Join TALORA" card
 - Contact form with audience selector plus GitHub / LinkedIn / Email cards
- **Real inquiry backend**: `POST /api/contact` with server-side validation, storing submissions in a SQLite database (`inquiries` table: id, name, email, subject, message, createdAt)

## Tech Stack

- **HTML5 / CSS3 / JavaScript (vanilla)**
- **GSAP + ScrollTrigger** for scroll animations
- **AOS** for on-scroll reveals
- **Boxicons** for icons
- **Node.js + better-sqlite3** for the contact API and database

## Project Structure

```
📁 Animated-Portfolio-main/
 ├📁 api/              # Serverless function (Vercel): POST /api/contact
 ├📁 images/          # Logo and static assets
 ├📁 videos/          # Background / hero videos
 ├📄 index.html       # Landing page
 ├📄 thankyou.html    # Form submission confirmation page
 ├📄 style.css        # All styling
 ├📄 app.js           # Animation & interaction system + form submission
 ├📄 contact-core.js  # Shared validation + SQLite storage logic
 └📄 serve.js         # Local Node server: static files + POST /api/contact
```

## Running Locally

```bash
npm install
npm start

# Then open
http://localhost:5501
```

The local server exposes the same API as production:

```bash
# Valid submission -> 201
curl -X POST http://localhost:5501/api/contact -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","subject":"Start a Project","message":"This is a test inquiry."}'

# Missing/invalid fields -> 400, nothing stored
curl -X POST http://localhost:5501/api/contact -H "Content-Type: application/json" -d '{}'
```

Submissions are stored in `talora.db` (SQLite). Inspect with:

```bash
node -e "console.log(require('better-sqlite3')('talora.db').prepare('SELECT * FROM inquiries').all())"
```

## Deploying (Vercel)

Production uses a **hosted PostgreSQL database (Neon)** — provisioned via the Vercel Marketplace integration and wired to the project as `DATABASE_URL` (plus `POSTGRES_*` variables). Credentials live only in Vercel's encrypted environment variables — never in code. The serverless function `api/contact.js` uses the same validation + storage logic (`contact-core.js`) as local development.

```bash
npm install -g vercel
vercel login        # one-time authentication
npm run deploy      # deploy to production
```

Then test on the live URL:

```bash
curl -X POST https://<your-app>.vercel.app/api/contact -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","subject":"Start a Project","message":"This is a test inquiry."}'
```

> **Persistence:** production submissions are stored permanently in Neon Postgres — they survive cold starts, redeployments and new serverless invocations. To verify the contents out-of-band, run `node check-db.js` locally (reads `.env.production`, which is gitignored).

> **Deployment protection:** the project's Vercel Authentication (SSO) protection is disabled so the API and site are publicly reachable for evaluation. Re-enable it in Project Settings → Deployment Protection if you need privacy later.

Alternatively, open `index.html` directly in a browser.
