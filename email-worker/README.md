# Reverlo purchase-email worker

This Worker receives `purchases@reverlo.nl`, parses MIME safely with `postal-mime`, and posts only normalized text, HTML, and attachment metadata to Reverlo's authenticated intake endpoint. It does not access D1 and never creates a purchase itself.

Configure these Worker secrets before deployment:

- `REVERLO_EMAIL_INGEST_SECRET` — must exactly match the secret in the Reverlo application.
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` — the Cloudflare Access service token permitted on `/api/track/email-ingest`.

The app also needs `REVERLO_EMAIL_INGEST_SECRET`. Do not place any secret in `wrangler.toml`.
