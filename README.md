# Robert Tacchini — Seller Reputation Profile

A fast, static seller verification website built for Cloudflare Pages. It has no database, tracking, or secrets: public information is stored in one editable data file.

## Run locally

Install Node.js 22 or newer, then run:

```bash
npm install
npm run dev
```

Open the local address shown in the terminal. To create a deployment build, run `npm run build`.

## Edit seller information

All profile content is deliberately kept in [`app/data/seller.ts`](app/data/seller.ts):

- `seller`: name, location, account status, trading start year, and headline statistics.
- `profiles`: external platform names, handles, and official URLs.
- `deals`: completed deal records. Add a new object to the array; the table and deal-ID search update automatically.
- `vouches`: buyer references. Use only genuine references and add the public original link when one is available.

Before sharing the website, replace the sample records and the account URLs. Do not add buyer addresses, emails, legal names, payment details, or tracking numbers.

## Change external profiles

Edit the `url` and `handle` fields inside the `profiles` array. External links automatically use safe new-tab settings (`noopener noreferrer`).

## Deploy to Cloudflare Pages

1. Push this project to a GitHub repository.
2. In Cloudflare, choose **Workers & Pages → Create application → Pages → Connect to Git**.
3. Select the repository. Use `npm run build` as the build command and `dist` as the output directory.
4. Deploy, then attach your custom domain in the Pages domain settings.

This is a static site; it does not require environment variables. Adding the website’s DNS record does not require changing your domain’s email or MX records.

## Social preview

`public/og.png` is the share preview image. The title, description, Open Graph, X card metadata, and favicon are configured in `app/layout.tsx`. Replace `metadataBase` with your final HTTPS domain before launch.
