import { generateText, Output } from "ai";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  authenticated,
  ApiError,
  failure,
  jsonBody,
  rpcError,
} from "@/lib/server";
import { SUPABASE_URL } from "@/lib/config";
import {
  evaluationSchema,
  EXAMINER_PROMPT,
  RUBRIC_VERSION,
} from "@/lib/rubric";
import { wordCount } from "@/lib/exam";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const { db, user } = await authenticated(request);
    const { attempt_id, question_id } = z
      .object({
        attempt_id: z.string().uuid(),
        question_id: z.string().min(1).max(80),
      })
      .parse(await jsonBody(request));
    if (
      !process.env.AI_GATEWAY_API_KEY ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      !process.env.AI_GRADING_MODEL
    )
      throw new ApiError(
        503,
        "La correction IA n’est pas encore activée. Vos productions restent sauvegardées.",
      );
    const { data: attempt, error } = await db
      .from("attempts")
      .select("*")
      .eq("id", attempt_id)
      .single();
    rpcError(error);
    if (
      !attempt ||
      attempt.status === "active" ||
      !["writing", "speaking"].includes(attempt.skill)
    )
      throw new ApiError(409, "Une épreuve d’expression terminée est requise.");
    const { data: question, error: qError } = await db
      .from("questions")
      .select("*")
      .eq("test_id", attempt.test_id)
      .eq("id", question_id)
      .single();
    rpcError(qError);
    if (!question) throw new ApiError(404, "Tâche introuvable.");
    const admin = createClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: existing } = await admin
      .from("ai_scoring_logs")
      .select("*")
      .eq("attempt_id", attempt_id)
      .eq("question_id", question_id)
      .eq("rubric_version", RUBRIC_VERSION)
      .maybeSingle();
    if (existing?.status === "complete") return Response.json(existing.result);
    if (
      existing?.status === "pending" &&
      Date.now() - Date.parse(existing.updated_at) < 180000
    )
      throw new ApiError(409, "Correction déjà en cours.");
    const { count, error: countError } = await admin
      .from("ai_scoring_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - 86400000).toISOString());
    rpcError(countError);
    if ((count ?? 0) >= 24 && !existing)
      throw new ApiError(429, "Limite quotidienne de corrections atteinte.");
    const model = process.env.AI_GRADING_MODEL;
    let claimedId: string;
    if (existing) {
      const { data: claim, error: claimError } = await admin
        .from("ai_scoring_logs")
        .update({
          status: "pending",
          updated_at: new Date().toISOString(),
          error_code: null,
        })
        .eq("id", existing.id)
        .eq("updated_at", existing.updated_at)
        .select("id")
        .maybeSingle();
      rpcError(claimError);
      if (!claim) throw new ApiError(409, "Correction déjà en cours.");
      claimedId = claim.id;
    } else {
      const { data: claim, error: claimError } = await admin
        .from("ai_scoring_logs")
        .insert({
          attempt_id,
          question_id,
          user_id: user.id,
          model,
          rubric_version: RUBRIC_VERSION,
          status: "pending",
        })
        .select("id")
        .single();
      if (claimError?.code === "23505")
        throw new ApiError(409, "Correction déjà en cours.");
      rpcError(claimError);
      claimedId = claim!.id;
    }
    try {
      const text = attempt.answers[question_id] || "";
      const context = JSON.stringify({
        task: question,
        pedagogical_mode: attempt.mode,
        word_count: wordCount(text),
        candidate_response: text,
      });
      const content: (
        | { type: "text"; text: string }
        | { type: "file"; data: Uint8Array; mediaType: string }
      )[] = [{ type: "text", text: context }];
      if (attempt.skill === "speaking") {
        const { data: recording, error: recordingError } = await db
          .from("recordings")
          .select("path,mime_type")
          .eq("attempt_id", attempt_id)
          .eq("question_id", question_id)
          .single();
        rpcError(recordingError);
        if (!recording) throw new ApiError(422, "Enregistrement manquant.");
        const { data: blob, error: downloadError } = await admin.storage
          .from("speaking-recordings")
          .download(recording.path);
        rpcError(downloadError);
        if (!blob || blob.size > 15728640)
          throw new ApiError(422, "Audio invalide.");
        content.push({
          type: "file",
          data: new Uint8Array(await blob.arrayBuffer()),
          mediaType: recording.mime_type,
        });
      } else if (wordCount(text) < 5)
        throw new ApiError(422, "Production insuffisante pour une correction.");
      const result = await generateText({
        model:
          attempt.skill === "speaking"
            ? process.env.AI_AUDIO_MODEL || model
            : model,
        system: EXAMINER_PROMPT,
        messages: [{ role: "user", content }],
        output: Output.object({ schema: evaluationSchema }),
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(95000),
      });
      const validated = evaluationSchema.parse(result.output);
      if (
        attempt.skill === "writing" &&
        validated.evidence.some((e) => !text.includes(e.excerpt))
      )
        throw new Error("Ungrounded evidence");
      const { error: saveError } = await admin
        .from("ai_scoring_logs")
        .update({
          status: "complete",
          result: validated,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimedId);
      rpcError(saveError);
      return Response.json(validated);
    } catch (e) {
      await admin
        .from("ai_scoring_logs")
        .update({
          status: "failed",
          error_code:
            e instanceof ApiError
              ? String(e.status)
              : "provider_or_validation_failure",
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimedId);
      throw e;
    }
  } catch (error) {
    return failure(error);
  }
}
