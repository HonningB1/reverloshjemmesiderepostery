# Reverlo purchase-email worker

This Worker receives `purchases@reverlo.nl`, parses MIME safely with `postal-mime`, and posts only normalized email text plus PDF text-layer extraction results to Reverlo's authenticated intake endpoint. It does not access D1 and never creates a purchase itself.

PDFs are handled transiently in the Worker. Only `application/pdf` files with a valid PDF signature are considered; the Worker sends extracted text, a SHA-256 fingerprint, and extraction metadata onward—never the PDF binary. The current limits are 2 MB per PDF, 4 MB across PDFs, 24 attachments, 12 PDF pages, and 40,000 extracted characters per PDF. Image-only PDFs are kept review-first with a `PDF_NO_TEXT_LAYER` reason; OCR is intentionally not used.

The Worker uses `unpdf`, which supports the Cloudflare Workers runtime, for text-layer extraction. Keep the package dependency bundled when deploying this Worker.

Configure these Worker secrets before deployment:

- `REVERLO_EMAIL_INGEST_SECRET` — must exactly match the secret in the Reverlo application.
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` — the Cloudflare Access service token permitted on `/api/track/email-ingest`.

The app also needs `REVERLO_EMAIL_INGEST_SECRET`. Do not place any secret in `wrangler.toml`.
