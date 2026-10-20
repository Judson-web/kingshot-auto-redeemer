# Supabase public-schema table grants

Supabase's Data API will stop automatically granting API access to newly created
tables in the `public` schema for existing projects on **October 30, 2026**.
Existing tables retain their current grants. This project uses server-side
Supabase access for operational data and should not add blanket client grants.

## Required migration rule

Every migration that creates a table in `public` must explicitly document its
intended Data API permissions in that same migration:

- For intentionally server-only tables, explicitly revoke access from
  `PUBLIC`, `anon`, and `authenticated`, then grant only the required
  privileges to `service_role`.
- For a deliberately client-accessible table, grant only the minimum required
  privileges to the intended role(s), and ensure RLS policies constrain rows
  and operations.
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

A regression test checks migrations dated October 30, 2026 or later for an
explicit grant/revoke decision on each new `public` table. Existing tables are
not rewritten by this change.
