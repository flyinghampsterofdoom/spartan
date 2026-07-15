# Render deployment and authentication

Render deploys the web service from `main`. The pre-deploy command applies checked-in
Drizzle migrations and runs the idempotent seed before the new release starts. A
failed migration prevents the unhealthy release from replacing the current service.

## Required environment variables

| Variable | Secret | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Render PostgreSQL pooled private connection string. Managed by the Blueprint. |
| `APP_URL` | No | Canonical HTTPS URL used in invitation and reset links. Production uses `https://simplyspartan.com`. |
| `SESSION_TTL_HOURS` | No | Absolute server-session lifetime. Defaults to 12 hours. |
| `SPARTAN_BOOTSTRAP_EMAIL` | No | Email for the initial seeded Owner and platform administrator. |
| `SPARTAN_BOOTSTRAP_PASSWORD` | Yes | Optional initial Owner password. Set in Render and never in source. When omitted for an unactivated Owner, the seed writes a single-use 24-hour activation link to restricted Render deploy logs. |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account containing Spartan's private attachment bucket. |
| `R2_ACCESS_KEY_ID` | Yes | R2 S3 API token access-key ID, scoped to the attachment bucket. |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 S3 API token secret. Never expose it to browser code. |
| `R2_BUCKET_NAME` | Yes | Private R2 bucket used for field attachments. |

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
- R2 remains private. Image retrieval passes through authenticated Spartan routes; do not enable a public bucket URL.
- The R2 token should be limited to object read/write on the single Spartan attachment bucket.

## R2 attachment setup

1. Create a private Cloudflare R2 bucket dedicated to Spartan attachments.
2. Create an R2 S3 API token with object read/write access limited to that bucket.
3. Set the four `R2_*` variables above on the Render web service.
4. Redeploy the current commit. No R2 value belongs in GitHub or a client-visible environment variable.

PostgreSQL retains attachment metadata after deletion for auditability. Spartan immediately hides soft-deleted records, attempts to remove the R2 object, and flags a failed object removal for later cleanup rather than silently losing the audit record.

The Render health check calls `/api/health`. At most once every 15 minutes, that health pass retries up to 50 pending R2 deletions. Once per day per organization it also compares R2 object keys with authoritative PostgreSQL attachment records. Reconciliation writes orphan and missing-object counts and up to 100 affected keys to `audit_events`; it does not automatically delete orphaned objects.

After changing the schema, run `npm run db:generate`, inspect the SQL, and commit the
migration. Validate with `npm test`, `npm run lint`, and `npx tsc --noEmit`.
