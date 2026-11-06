import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authenticated(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token)
    throw new ApiError(
      401,
      "Connectez-vous pour enregistrer une tentative vérifiée.",
    );
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, "Session expirée. Reconnectez-vous.");
  return { db, user: data.user };
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new ApiError(415, "JSON requis.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Corps manquant.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 96000) {
      await reader.cancel();
      throw new ApiError(413, "Requête trop volumineuse.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "JSON invalide.");
  }
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError")
    return Response.json({ error: "Données invalides." }, { status: 400 });
  console.error(
    "TCF API failure",
    error instanceof Error ? error.message : "unknown",
  );
  return Response.json(
    { error: "Opération impossible. Réessayez." },
    { status: 500 },
  );
}
export function rpcError(error: { message: string } | null) {
  if (error)
    throw new ApiError(
      /expired|deadline|closed/.test(error.message) ? 409 : 400,
      error.message,
    );
}
