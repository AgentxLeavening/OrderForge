This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Database migrations

This project uses SQL migrations in `db/migrations/`. After pulling changes that add or modify migrations, apply them to your Supabase/Postgres database before starting the app.

### Recommended: `npm run migrate`

A small Node runner (`scripts/migrate.mjs`, uses the `pg` driver — no `psql` needed) applies every pending migration in filename order and records applied ones in a `schema_migrations` table, so it's safe to run repeatedly.

1. Add your database connection string to `.env.local` (get it from Supabase → **Project Settings → Database → Connection string → URI**):

   ```bash
   SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.<ref>.supabase.co:5432/postgres"
   ```

   > Tip: if the direct `db.<ref>.supabase.co` host isn't reachable on your network (it's IPv6-only), use the **Session pooler** connection string from the same page instead.

2. Run:

   ```bash
   npm run migrate
   ```

All migrations are idempotent, so the first run against a database where some were already applied by hand is safe — it re-applies and then records them.

### Alternative: Supabase SQL editor

Copy/paste the contents of each migration file (in order) into the Supabase SQL editor and run them. `SUPABASE_DB_URL` is not needed for this route.

