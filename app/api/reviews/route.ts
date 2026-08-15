// Public review creation is intentionally disabled. Reviews can only be submitted
// through a server-issued, one-time /review/<token> link.
export async function POST() {
  return Response.json({ error: "Reviews can only be submitted through a valid Reverlo review link." }, { status: 410 });
}
