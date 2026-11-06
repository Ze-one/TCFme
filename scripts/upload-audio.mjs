import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://lmkogwjrbdtzanxzmyqm.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key)
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in your local environment.");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (const name of (await fs.readdir("public/audio")).filter((n) =>
  n.endsWith(".wav"),
)) {
  const { error } = await db.storage
    .from("exam-audio")
    .upload(name, await fs.readFile("public/audio/" + name), {
      contentType: "audio/wav",
      upsert: true,
    });
  if (error) throw new Error(name + ": " + error.message);
}
console.log(
  "39 original audio assets provisioned in the private exam-audio bucket.",
);
