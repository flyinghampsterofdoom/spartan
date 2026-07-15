# Render deployment and authentication

Render deploys the web service from `main`. The pre-deploy command applies checked-in
Drizzle migrations and runs the idempotent seed before the new release starts. A
failed migration prevents the unhealthy release from replacing the current service.

## Required environment variables

| Variable | Secret | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Render PostgreSQL pooled private connection string. Managed by the Blueprint. |
| `APP_URL` | No | Canonical HTTPS URL used in invitation and reset links. |
| `SESSION_TTL_HOURS` | No | Absolute server-session lifetime. Defaults to 12 hours. |
| `SPARTAN_BOOTSTRAP_EMAIL` | No | Email for the initial seeded Owner and platform administrator. |
| `SPARTAN_BOOTSTRAP_PASSWORD` | Yes | Initial Owner password. Set in Render and never in source. |

## Email variables

The application uses a provider-neutral email service. Without a provider, the
development adapter records delivery metadata and writes the message to server logs.
Production delivery uses `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, and the secret
`RESEND_API_KEY`. Provider-specific code is isolated in `lib/email/service.ts`.

## Production security assumptions

- Render terminates HTTPS; production cookies are Secure, HTTP-only, same-site, and
  use server-controlled expiration.
- Session, reset, and invitation identifiers are stored only as hashes.
- Reset and invitation links expire and are single-use.
- Disabling a user, membership, or organization revokes affected sessions.
- Mutation routes reject cross-site browser requests and re-check server authorization.
- PostgreSQL is private-network-only through Render's managed pooler.

After changing the schema, run `npm run db:generate`, inspect the SQL, and commit the
migration. Validate with `npm test`, `npm run lint`, and `npx tsc --noEmit`.
