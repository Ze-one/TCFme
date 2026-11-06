import { z } from "zod";
import { questionBank, answers } from "@/lib/bank";
import { failure, jsonBody } from "@/lib/server";
// Preview practice has no verified score, and no server-persisted candidate work.
export async function POST(request: Request) {
  try {
    const body = z
      .object({
        skill: z.enum(["reading", "listening", "writing", "speaking"]),
        mode: z.enum(["official", "c2"]),
        answers: z.record(z.string().max(12000)).optional(),
      })
      .parse(await jsonBody(request));
    const questions = questionBank(body.skill, body.mode);
    if (body.answers) {
      const review = questions
        .filter((q) => answers[q.id])
        .map((q) => ({
          question_id: q.id,
          ...answers[q.id],
          script: q.skill === "listening" ? q.passage : null,
        }));
      return Response.json({
        score: review.filter(
          (q) => body.answers![q.question_id] === String(q.correct),
        ).length,
        review,
      });
    }
    return Response.json({ questions });
  } catch (error) {
    return failure(error);
  }
}
