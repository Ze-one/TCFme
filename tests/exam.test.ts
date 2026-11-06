import { test } from "node:test";
import assert from "node:assert/strict";
import { officialNclc, remainingSeconds, practiceMinutes, wordCount, SKILLS } from "../lib/exam";
import { questionBank, answers } from "../lib/bank";
import { evaluationSchema } from "../lib/rubric";
test("official NCLC boundary values are skill-specific and bounded", () => {
  assert.equal(officialNclc("listening", 522), 8);
  assert.equal(officialNclc("listening", 523), 9);
  assert.equal(officialNclc("reading", 523), 8);
  assert.equal(officialNclc("reading", 524), 9);
  assert.equal(officialNclc("reading", 548), 9);
  assert.equal(officialNclc("reading", 549), 10);
  assert.equal(officialNclc("writing", 15), 9);
  assert.equal(officialNclc("speaking", 16), 10);
  for (const invalid of [-1, 700, NaN, 10.5])
    assert.equal(officialNclc("reading", invalid), null);
  assert.equal(officialNclc("writing", 21), null);
});
test("absolute deadline never grants extra time after reload or suspension", () => {
  const deadline = "2026-11-05T14:00:00Z";
  assert.equal(
    remainingSeconds(deadline, Date.parse("2026-11-05T13:59:40Z")),
    20,
  );
  assert.equal(
    remainingSeconds(deadline, Date.parse("2026-11-05T14:01:00Z")),
    0,
  );
});
test("French word counting uses documented whitespace rule", () => {
  assert.equal(wordCount("  Aujourd’hui, j’ai\n rendez-vous.  "), 3);
  assert.equal(wordCount(""), 0);
});
test("practice duration stops at the deadline when an expired session is resumed later", () => {
  const attempt = { started_at: "2026-11-05T10:00:00Z", deadline: "2026-11-05T10:35:00Z", submitted_at: "2026-11-06T10:00:00Z" };
  assert.equal(practiceMinutes(attempt), 35);
  assert.equal(practiceMinutes({ ...attempt, submitted_at: "2026-11-05T10:12:00Z" }), 12);
});
test("complete banks have four choices, one valid key, distinct IDs and progressive official levels", () => {
  for (const mode of ["official", "c2"] as const)
    for (const skill of SKILLS) {
      const qs = questionBank(skill.id, mode);
      assert.equal(qs.length, skill.count);
      assert.equal(new Set(qs.map((q) => q.id)).size, qs.length);
      for (const q of qs) {
        if (q.options.length) {
          assert.equal(q.options.length, 4);
          assert.equal(new Set(q.options).size, 4);
          assert.ok(answers[q.id]);
          assert.ok(answers[q.id].correct >= 0 && answers[q.id].correct <= 3);
        }
      }
    }
  const levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
  for (const skill of ["reading", "listening"] as const) {
    const qs = questionBank(skill);
    for (let i = 1; i < qs.length; i++)
      assert.ok(levels.indexOf(qs[i].level) >= levels.indexOf(qs[i - 1].level));
  }
});
test("official and custom writing constraints are deliberately separate", () => {
  assert.deepEqual(
    questionBank("writing").map((q) => [q.min_words, q.max_words]),
    [
      [60, 120],
      [120, 150],
      [120, 180],
    ],
  );
  assert.deepEqual(
    questionBank("writing", "c2").map((q) => [q.min_words, q.max_words]),
    [
      [40, 60],
      [120, 150],
      [150, 180],
    ],
  );
  assert.equal(
    questionBank("speaking").reduce((s, q) => s + q.duration_seconds!, 0),
    720,
  );
});
test("grading schema rejects inflated scores and unsupported levels", () => {
  assert.equal(
    evaluationSchema.safeParse({
      estimated_level: "C3",
      lexical_richness_score: 110,
    }).success,
    false,
  );
});
