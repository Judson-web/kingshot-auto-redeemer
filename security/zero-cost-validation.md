# Zero-cost migration validation

This migration uses a strict no-new-spend policy.

## Allowed validation resources

- GitHub Actions on this public repository, using standard hosted runners.
- Disposable PostgreSQL service containers inside CI.
- Disposable local Supabase CLI containers inside CI, with local Auth and PostgREST.
- Local Worker runtime tests and Wrangler `--dry-run` builds.
- Existing Cloudflare account configuration read through the account API.

Cloudflare documents Workers VPC as a public beta available free to all Workers plans. This does not authorize enabling paid add-ons, provisioning paid infrastructure, or exceeding any account's included usage. Any future remote probe must first confirm the exact feature and request are within included free usage.

## Explicitly prohibited without separate approval

- Supabase development branches or additional Supabase projects.
- Neon branches or additional Neon projects.
- Cloudflare paid add-ons, paid tunnels, paid logging destinations, or paid network services.
- Production database writes, schema migrations, or data changes.
- Production Worker deployments, DNS changes, domain cutovers, or live redemption requests.
- Any CI workflow that links to the production Supabase project or imports production credentials.

## CI enforcement

`scripts/verify-zero-cost-ci.mjs` checks the migration workflow for local-only Supabase use, loopback database endpoints, absence of paid branch provisioning and production credentials, bounded job timeouts, and Wrangler dry-run-only deployment commands.

The PostgreSQL and Supabase local-stack jobs use disposable containers and are destroyed when the job ends. The Supabase job applies only the V4 migration slice to a minimal test fixture because the repository's historical migration chain is not yet a complete version-aligned copy of the live project.

## Current state

- The paid Supabase branch estimate was inspected but not confirmed. No branch was created.
- The existing Supabase project has no development branches.
- The V4 migrations remain unapplied to production.
- No Neon resource was created.
- No new Cloudflare logging destination or tunnel was created.
- Gateway policies already configured in the account remain scoped to Mesh and Workers VPC traffic separately.
- Runtime Gateway matching remains an outstanding verification step. Webhook dispatch stays fail-closed until that verification can be completed without paid infrastructure.
