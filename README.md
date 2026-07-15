# Spartan

Construction operations for projects, employees, crews, schedules, timekeeping,
wages, punch work, and labor reporting.

## Deployments

- OpenAI Sites hosts a private visual preview; Render is the production runtime.
- Render deploys the web application from GitHub using `render.yaml`.
- Render uses Node 22, installs build tooling with `npm ci --include=dev`, builds with `npm run build`, and starts with `npm start` on the assigned port.
- Render groups the Starter web service and Basic-256mb PostgreSQL database under the Spartan / Production environment.
- PostgreSQL uses the 1 GB minimum storage allocation, managed PgBouncer, and private-network-only access.
- Render runs the checked-in Drizzle migration and idempotent demo seed before each deployment.
- Cloudflare R2 stores private field attachments. Render accesses the bucket through scoped server-only credentials; PostgreSQL remains authoritative for ownership, permissions, event context, and deletion state.

Render PostgreSQL is Spartan's production system of record. The database layer,
initial migration, organization-aware permission model, and realistic demo seed
and organization-aware operational modules are connected to persistent server-side services.

## Authentication and administration

Spartan uses app-owned email/password authentication backed by PostgreSQL.
Passwords are salted with scrypt, browser sessions are stored as token hashes,
and the raw session token is sent only in a secure HTTP-only cookie. Operational
pages resolve the active organization and server permissions before rendering.

Public browser pages are limited to login, invitation acceptance, and password
recovery. Company administration is available at `/settings` to memberships with
the required organization permissions. `/platform-admin` additionally requires
an active platform access record; organization roles never grant platform access.

Copy `.env.example` to `.env.local` for local development. Production variables
are documented in [the Render deployment guide](docs/deployment.md). Never commit
real passwords, email keys, database URLs, invitation tokens, reset tokens, or
session tokens.

## Attachments and Punch Walk

`/punch` supports protected field-photo evidence tied to punch items and, where possible, the exact workflow event that produced it. `/punch/walk` is a mobile-first rapid capture surface over the same punch-item command and event-history services. Its retained project, area, category, and assignee defaults are device-local conveniences; PostgreSQL and server authorization remain authoritative.

Attachment bytes are never public. `/api/attachments/:id` authenticates the request, verifies organization and underlying-record access, then retrieves the private R2 object server-side. Deletion soft-deletes PostgreSQL metadata and appends audit and punch events before object removal is attempted.

## Development foundation

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` defines the canonical PostgreSQL model
- `db/seed.ts` idempotently provisions the initial organization and demo records
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run db:migrate`: apply pending PostgreSQL migrations
- `npm run db:seed`: add the idempotent Spartan demo dataset

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle PostgreSQL Guide](https://orm.drizzle.team/docs/get-started-postgresql)
