# Robert Tacchini — Seller Reputation Profile

A fast seller verification website built for Cloudflare Pages and Cloudflare D1. It has no tracking or secrets.

## Run locally

Install Node.js 22 or newer, then run:

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. To create a deployment build, run `npm run build`.

## Edit seller information

Seller identity and official profile links are kept in [`app/data/seller.ts`](app/data/seller.ts):

- `seller`: name, location, account status, and trading start year.
- `profiles`: external platform names, handles, and official URLs.

Reviews and public reputation statistics are read from D1. Only reviews with the `approved` status are public. Do not add buyer addresses, emails, legal names, payment details, or tracking numbers.

## Change external profiles

Edit the `url` and `handle` fields inside the `profiles` array. External links automatically use safe new-tab settings (`noopener noreferrer`).

## Deploy to Cloudflare Pages

1. Push this project to a GitHub repository.
2. In Cloudflare, choose **Workers & Pages → Create application → Pages → Connect to Git**.
3. Select the repository. Use `npm run build` as the build command and `dist` as the output directory.
4. Deploy, then attach your custom domain in the Pages domain settings.

Bind the production D1 database as `DB` before deploying. Adding the website’s DNS record does not require changing your domain’s email or MX records.

## Social preview

`public/og.png` is the share preview image. The title, description, Open Graph, X card metadata, and favicon are configured in `app/layout.tsx`. Replace `metadataBase` with your final HTTPS domain before launch.

## Initialize review storage (Cloudflare D1)

The review form sends data to `POST /api/reviews`. Every entry is assigned a database-generated `REV-0001`-style ID and is stored with the `pending` status. The protected `/admin` panel manages approval and rejection. There is no public reviews API; the public profile reads only approved records directly from D1.

1. In the Cloudflare Pages project, add `reverlo-db` as a production binding named `DB`.
2. Log in locally with `npx wrangler login`.
3. Apply the included initial schema once (replace the placeholder with the real D1 database name):

```bash
npx wrangler d1 execute reverlo-db --remote --file=drizzle/0000_smart_sway.sql
```

The SQL creates the `reviews` table and its ID counter. Do not run the initial file again after it has succeeded. Future schema changes should be added as new files in `drizzle/` and applied with the same `wrangler d1 execute` pattern.
