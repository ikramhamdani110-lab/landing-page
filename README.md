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

---

# Role-Based Access Control (RBAC)

Implemented in `rbac-core.js` and enforced **on the backend** for every protected
API operation. The frontend only mirrors the rules for UX; the API is authoritative.

## Roles

Defined in `rbac-core.js` as a closed enum, stored in `users.role`:

| Role | Description |
|---|---|
| `ADMIN` | Full CMS access, including deletion, website settings and user/role management. |
| `EMPLOYEE` | Read records and edit permitted fields only. |

Self-registration always creates an `EMPLOYEE`. There is no public endpoint that
writes a `role`, so nobody can promote themselves.

## Permissions

`ROLE_PERMISSIONS` in `rbac-core.js` is the single source of truth:

| Permission | ADMIN | EMPLOYEE |
|---|:--:|:--:|
| `content:read` | yes | yes |
| `content:create` | yes | no |
| `content:update` | yes | yes (permitted fields only) |
| `content:delete` | yes | no |
| `services:read` (admin CMS) | yes | no |
| `services:create` / `update` / `delete` | yes | no |
| `settings:read` / `settings:update` | yes | no |
| `users:read` / `users:manage` | yes | no |

**Field-level rule:** an EMPLOYEE update may change `title`, `description`,
`category` and `section` only. `status` (publish/unpublish) is ADMIN-only. Any
omitted field is carried over from the stored record, so a partial payload can
neither blank out nor escalate a column — see `mergeContentFields()`.

## Where authentication happens

Unchanged from before — RBAC reuses it, it does not replace it:

- `POST /api/auth/login` — the env-configured CMS admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), signed with `ADMIN_TOKEN_SECRET`.
- `POST /api/auth/user-login` — a `users` table account, scrypt-hashed password, signed with `USER_TOKEN_SECRET`.
- `auth-user-core.js` verifies the signature, expiry and logout revocation, then loads the user row.

## Where authorization happens

`rbac-core.js` exposes the reusable guards used by **both** `serve.js` (local) and
`api/*.js` (Vercel):

- `getPrincipal(req)` — resolves the caller from the request: the admin token maps
  to `ADMIN`; a user token maps to the role stored in the **database row**. The
  role is never read from the request body, query string or token payload, so a
  forged or stale token cannot escalate. Returns `null` when unauthenticated.
- `requireAuth(req, res)` — 401 unless a principal exists.
- `requireRole(req, res, 'ADMIN')` — 403 unless the principal's role matches.
- `requirePermission(req, res, 'content:delete')` — 403 unless the role holds it.
- `restrictContentFields(fields, role)` / `mergeContentFields(...)` — field-level enforcement.

## Protected endpoints

| Endpoint | Permission | EMPLOYEE |
|---|---|---|
| `GET /api/content`, `GET /api/content/:id` | `content:read` | 200 |
| `POST /api/content` | `content:create` | 403 |
| `PUT\|PATCH /api/content/:id` | `content:update` | 200 (fields filtered) |
| `DELETE /api/content/:id` | `content:delete` | 403 |
| `GET /api/admin/services` | `services:read` | 403 |
| `POST /api/admin/services` | `services:create` | 403 |
| `PUT\|PATCH /api/admin/services/:id` | `services:update` | 403 |
| `DELETE /api/admin/services/:id` | `services:delete` | 403 |
| `GET /api/website-settings` | `settings:read` | 403 |
| `PUT\|PATCH /api/website-settings` | `settings:update` | 403 |
| `GET /api/admin/users` | `users:read` | 403 |
| `PUT /api/admin/users/:id` | `users:manage` | 403 |
| `GET\|PUT /api/user/profile` | own account only | 200 |

Public and unchanged: `POST /api/contact`, `GET /api/website-content`,
`GET /api/services`, `POST /api/auth/register`, `POST /api/auth/user-login`,
`POST /api/auth/logout`, `GET /api/auth/me`.

## 401 vs 403

- **401** — no valid session (missing, malformed, expired or revoked token).
- **403** — a valid session whose role lacks the permission. An employee calling
  an admin-only endpoint by hand gets 403, not a redirect or a silent success.

The existing response shapes are preserved: `{ success: false, message }` for the
CMS API and `{ error }` for the auth/user API.

## Demo accounts

```bash
node seed-rbac-users.js
```

Creates one `ADMIN` and one `EMPLOYEE` in the local SQLite database. Addresses and
passwords come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
`SEED_EMPLOYEE_EMAIL` / `SEED_EMPLOYEE_PASSWORD`; the script refuses to run when
`NODE_ENV=production` or `VERCEL=1`. No real secret is committed to the repository.

## How RBAC was tested

`test-rbac-e2e.mjs` drives the real HTTP API (no browser), so the backend is
proven authoritative:

```bash
node serve.js
node test-rbac-e2e.mjs
```

35 assertions covering: unauthenticated access → 401; ADMIN create / read / update /
delete; EMPLOYEE read and permitted update, with `status` proven unchanged;
EMPLOYEE create / delete / settings / user-management → 403; employee self-escalation
through `PUT /api/user/profile` and `PUT /api/admin/users/:id` blocked; invalid role
values rejected with 400; and no password hash in any response.

