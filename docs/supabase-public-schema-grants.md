# Supabase public-schema table grants

Supabase's Data API will stop automatically granting API access to newly created
tables in the `public` schema for existing projects on **October 30, 2026**.
Existing tables retain their current grants. This project uses server-side
Supabase access for operational data and should not add blanket client grants.

## Required migration rule

Every migration that creates a table in `public` must explicitly document its
intended Data API permissions in that same migration:

- For intentionally server-only tables, enable RLS, explicitly revoke access
  from `PUBLIC`, `anon`, and `authenticated`, then grant only the privileges
  the server needs to `service_role`.
- For a deliberately client-accessible table, enable RLS, grant only the
  minimum required privileges to the intended role(s), and ensure policies
  constrain rows and operations.
- If a table should not be reachable through the Data API, do not grant
  `anon` or `authenticated` access merely to make a migration pass.
- Treat sequences and RPC/function execution privileges separately; table
  grants do not grant access to every related object.
- Keep these statements in the table-creating migration so fresh projects,
  preview branches, and local resets get the same permissions.

Example for a server-only table:

```sql
alter table public.example_table enable row level security;
revoke all on table public.example_table from public, anon, authenticated;
grant select, insert, update, delete on table public.example_table to service_role;
```

Choose the exact service-role privileges the server needs; the example is not a
requirement to grant CRUD to every table. Do not add global default privileges
or a blanket grant across all public tables as a shortcut.

The regression test starts checking new migrations dated **October 26, 2026**
so ACL and RLS decisions are enforced before the platform's October 30 change.
It skips qualified non-public schemas and treats an unqualified
`CREATE TABLE` as public, so migration authors should prefer schema-qualified
DDL. This is a static guard, not a replacement for live database policy review
or PostgreSQL integration tests.
