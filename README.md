# SciMate

SciMate is a Next.js 16 app for running CFD jobs through E2B sandboxes, gated by Supabase authentication and one-time run tokens.

## Stack

- Next.js 16 App Router
- Supabase Auth + Postgres + Storage
- E2B sandboxes for long-running CFD execution
- Vercel for deployment

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in the Supabase, E2B, and Anthropic environment variables.
3. In Supabase SQL Editor, run [`supabase/schema.sql`](./supabase/schema.sql).
4. Mark at least one user as admin:

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

5. Install dependencies and start development:

```bash
npm install
npm run dev
```

## Run-token flow

- Users sign in with Supabase email magic links.
- Admins generate random run tokens from `/admin/tokens`.
- A user redeems a token on `/redeem`.
- Each call to `/api/cfd` consumes exactly one redeemed token before starting the sandbox.
- Output files are persisted to Supabase Storage and downloaded through the protected `/api/files` route.

## Vercel deployment

1. Create a Vercel project from this repository.
2. Connect the same Supabase project you used locally.
3. Add all variables from `.env.example` to Vercel Project Settings.
4. Run the SQL in [`supabase/schema.sql`](./supabase/schema.sql) on production.
5. In Supabase Auth settings, set the site URL and redirect URL to:

```text
https://your-domain.com/auth/confirm
```

## Important note

The existing `.env.local` in this workspace currently contains real secrets. Move them into Vercel environment variables and rotate them before publishing the project.
