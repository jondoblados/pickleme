# PickleMe

Pickleball game sign-ups that replace the WhatsApp copy-and-paste list: a player cap, a first-come-first-served waitlist,
and automatic promotion when someone withdraws.

- Live site: https://jon.doblados.net/pickleme/
- Frontend: React + TypeScript + Vite, hosted on GitHub Pages (this repo, deployed by `.github/workflows/deploy.yml`)
- Backend: Supabase project `pickleme` (`bzxkbulljurizjrpixdm`, Singapore) — Auth (email magic links), Postgres with RLS, Realtime

## How it works

- Players sign in with a passwordless email link, choose a display name, and join the group via an organiser's invite link.
- All writes go through Postgres functions (`join_game`, `withdraw_game`, `remove_registration`, `create_game`, …) that lock the
  game row, so the queue order is decided by the database. Positions 1–capacity are playing; the rest are the waitlist.
- Tables are read-only to clients and protected by Row Level Security; only group members can see rosters, and emails are never exposed.
- URLs are query-based (`?game=<id>`, `?invite=<token>`, `?view=members`) so everything resolves to `/pickleme/index.html`.

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | React app (screens, Supabase client, RPC wrappers) |
| `supabase/migrations/` | Schema, RLS, functions, seed group — already applied to the project |
| `supabase/tests/acceptance.sql` | Database acceptance tests (self-rolling-back) |
| `supabase/templates/magic_link.html` | Custom email template for magic links |
| `changelog.md` | Log of work done |
| `feature-requests.md` | Requested features and their status |

## Local development

```bash
npm install
npm run dev        # http://localhost:5173/pickleme/
npm run build
```

The Supabase URL and publishable key in `.env` are public by design (protected by RLS). Never commit a service-role key or SMTP password.

## Supabase Auth settings (dashboard)

- Authentication → URL Configuration: Site URL `https://jon.doblados.net/pickleme/`; Redirect URLs `https://jon.doblados.net/pickleme/**` and `http://localhost:5173/pickleme/**`
- Authentication → Emails → SMTP: Resend (`smtp.resend.com`, port 465, user `resend`, password = Resend API key)
- Authentication → Email Templates: paste `supabase/templates/magic_link.html` into **Magic Link** and **Confirm signup**
