# Reverlo

Reverlo is a Cloudflare Worker + D1 reputation profile. Public pages show only approved reviews and administrator-configured social profiles. The `/admin` page and every `/api/admin/*` endpoint are protected by Cloudflare Access.

## Review links

Reviews are submitted exclusively through a secure, one-time link generated in `/admin`:

1. Enter the product/deal and optionally preselect a platform.
2. Send the generated `/review/<token>` link to the buyer.
3. The submission API reads the product/deal from D1, not from the browser.
4. A single atomic D1 batch creates the pending review and marks the link as used. Concurrent submissions cannot create two reviews from one link.

`/createreview` and `POST /api/reviews` are intentionally disabled.

## D1 migrations

The existing production database binding must remain `DB → reverlo-db`.

The original schema was initialized from SQL files, so apply this new migration once after the original schema has already been applied:

```powershell
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0001_mysterious_cammi.sql
```

For a local D1 verification database:

```powershell
npx wrangler d1 execute reverlo-db --local --file=drizzle/0001_mysterious_cammi.sql
```

The new `drizzle/0001_mysterious_cammi.sql` migration adds `review_links`, `social_profiles`, and a non-destructive `review_link_id` column on `reviews`. It does not delete existing reviews.

## Cloudflare Access

Keep `/admin` protected. Ensure `/api/admin/*` has the same Cloudflare Access application/policy. Do not protect `/review/*` or the public profile, because buyers need to open their issued review links.

## Run locally

```powershell
npm install
npm run dev
```

Run a production build with:

```powershell
npm run build
```
