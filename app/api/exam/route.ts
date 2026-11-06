import { z } from "zod";
import { authenticated, failure, jsonBody, rpcError } from "@/lib/server";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    skill: z.enum(["listening", "reading", "writing", "speaking"]),
    mode: z.enum(["official", "c2"]),
  }),
  z.object({
    action: z.enum([
      "save",
      "submit",
      "read",
      "audio",
      "integrity",
      "review",
      "recording",
    ]),
    attempt_id: z.string().uuid(),
    answers: z.record(z.string().max(12000)).optional(),
    question_id: z.string().max(80).optional(),
    type: z
      .enum(["focus_lost", "fullscreen_exit", "reloaded", "audio_error"])
      .optional(),
  }),
]);
export async function POST(request: Request) {
  try {
    const { db } = await authenticated(request);
    const body = input.parse(await jsonBody(request));
    if (body.action === "start") {
      const { data: attempt, error } = await db.rpc("begin_attempt", {
        p_test: `${body.mode}-${body.skill}`,
      });
      rpcError(error);
      const { data: questions, error: qError } = await db
        .from("questions")
        .select("*")
        .eq("test_id", attempt.test_id)
        .order("position");
      rpcError(qError);
      return Response.json({
        attempt,
        questions,
        server_now: new Date().toISOString(),
      });
    }
    if (body.action === "review") {
      const { data, error } = await db.rpc("review_attempt", {
        p_attempt: body.attempt_id,
      });
      rpcError(error);
      return Response.json(data);
    }
    if (body.action === "recording") {
      const { data, error } = await db.rpc("register_recording", {
        p_attempt: body.attempt_id,
        p_question: body.question_id,
      });
      rpcError(error);
      return Response.json(data);
    }
    const { data, error } = await db.rpc("exam_action", {
      p_attempt: body.attempt_id,
      p_action: body.action,
      p_payload: {
        answers: body.answers,
        question_id: body.question_id,
        type: body.type,
      },
    });
    rpcError(error);
    if (body.action === "audio") {
      if (!data.path)
        return Response.json(
          { error: "Le temps est écoulé." },
          { status: 409 },
        );
      const signed = await db.storage
        .from("exam-audio")
        .createSignedUrl(data.path, 90);
      rpcError(signed.error);
      return Response.json({ url: signed.data?.signedUrl });
    }
    return Response.json(data);
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  try {
    const { db } = await authenticated(request);
    const { data: attempts, error } = await db
      .from("attempts")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);
    rpcError(error);
    const { data: logs, error: logError } = await db
      .from("ai_scoring_logs")
      .select("attempt_id,question_id,result")
      .eq("status", "complete");
    rpcError(logError);
    return Response.json({
      attempts: attempts?.map((a) => ({
        ...a,
        evaluations:
          logs
            ?.filter((l) => l.attempt_id === a.id)
            .map((l) => ({ ...l.result, question_id: l.question_id })) ?? [],
      })),
    });
  } catch (error) {
    return failure(error);
  }
}
