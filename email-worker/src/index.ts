import PostalMime from "postal-mime";

interface Env {
  REVERLO_EMAIL_INGEST_URL: string;
  REVERLO_EMAIL_INGEST_SECRET: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}
type IncomingEmailMessage = {
  rawSize: number; raw: ReadableStream; from: string; to: string; headers: Headers;
  setReject(reason: string): void;
};
type EmailWorkerHandler = { email(message: IncomingEmailMessage, env: Env): Promise<void> };

const MAX_RAW_BYTES = 1_000_000;
const MAX_BODY_CHARS = 120_000;

function limited(value: string | null | undefined) { return (value ?? "").slice(0, MAX_BODY_CHARS); }
function firstAddress(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === "object" && typeof (first as { address?: unknown }).address === "string" ? (first as { address: string }).address.slice(0, 320) : "";
}
function forwardedSender(text: string, envelopeSender: string) {
  const match = text.match(/(?:forwarded message|videresendt besked)[\s\S]{0,700}?^\s*from:\s*[^<\n]*<([^>\n]+)>/im) ?? text.match(/(?:forwarded message|videresendt besked)[\s\S]{0,700}?^\s*from:\s*([^\n]+)/im);
  return match ? match[1].trim().slice(0, 320) : envelopeSender;
}

export default {
  async email(message, env): Promise<void> {
    if (message.rawSize > MAX_RAW_BYTES) { message.setReject("Purchase email is too large to process."); return; }
    const parsed = await PostalMime.parse(message.raw);
    const textBody = limited(parsed.text); const htmlBody = limited(parsed.html);
    const originalSender = forwardedSender(textBody, firstAddress(parsed.from) || message.from);
    const attachments = (parsed.attachments ?? []).slice(0, 24).map((attachment) => ({
      name: String(attachment.filename ?? "").slice(0, 240), contentType: String(attachment.mimeType ?? "").slice(0, 120),
      size: attachment.content instanceof Uint8Array ? attachment.content.byteLength : null,
    }));
    const headers = new Headers({ "content-type": "application/json", "x-reverlo-email-ingest-secret": env.REVERLO_EMAIL_INGEST_SECRET });
    if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
      headers.set("CF-Access-Client-Id", env.CF_ACCESS_CLIENT_ID); headers.set("CF-Access-Client-Secret", env.CF_ACCESS_CLIENT_SECRET);
    }
    const response = await fetch(env.REVERLO_EMAIL_INGEST_URL, { method: "POST", headers, body: JSON.stringify({
      from: originalSender, forwardedBy: message.from, to: message.to, subject: parsed.subject ?? message.headers.get("subject") ?? "",
      messageId: message.headers.get("message-id") ?? "", emailDate: message.headers.get("date") ?? "", textBody, htmlBody, attachments,
    }) });
    if (!response.ok && response.status !== 409) throw new Error(`Purchase ingestion failed with ${response.status}.`);
  },
} satisfies EmailWorkerHandler;
