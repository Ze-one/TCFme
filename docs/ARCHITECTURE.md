# TCFme C2 Pro

The same Next.js App Router and TypeScript source runs natively on Vercel and through the optional Vinext adapter for the private Sites preview. Supabase is the system of record in both deployments.

## Request boundaries

1. Browser authenticates with Supabase email/password. The publishable key is public; it cannot access candidate data without a valid user token and ownership policies.
2. `/api/exam` validates the bearer token with `getUser`, validates JSON with Zod, and calls user-scoped PostgreSQL functions. Cookies are not used as API authorization, so cross-site forms cannot authorize mutations.
3. Public RPC wrappers run as invokers. Narrow, private-schema definer functions check `auth.uid()`, lock the attempt row, and enforce ownership, deadlines, valid question IDs, answer ranges, immutable submission, and atomic single-play claims. Default PUBLIC/anon execution is revoked.
4. Tests and prompts contain no answer keys. Correct choices, rationales and listening transcripts live in `private.answer_keys`. Candidates receive review content only for completed attempts. This is a reusable training corpus, not a secret high-stakes item bank.
5. Recordings use private Storage paths `user_id/attempt_id/question_id.webm`. MIME types are recorded separately; the path suffix is stable even when Safari produces MP4. Upload policies check ownership and the task's time window. Existing objects cannot be overwritten by candidates.
6. `/api/evaluate` loads an owned, submitted response, claims a unique scoring log, invokes AI SDK `generateText` with `Output.object`, validates the output and exact evidence quotes for writing, and persists an immutable-by-client result. Server credentials are used only here. Native audio requires an audio-capable model configured separately.

## Format and timing

| Skill | Duration | Items |
|---|---:|---:|
| Listening | 35 minutes | 39 |
| Reading | 60 minutes | 39 |
| Writing | 60 minutes | 3 |
| Speaking | 12 minutes | 3 |

Official-format writing uses 60–120 / 120–150 / 120–180 words. Task 3 comprises a 40–60 word comparison and an 80–120 word position. Speaking has 2 minutes interview, 2 minutes preparation plus 3.5 minutes information-seeking interaction, then 4.5 minutes opinion without preparation. The custom C2 workshop preserves the alternative tasks and word ranges in the original brief. Those are never labeled official format.

The browser uses an absolute deadline synchronized to the server. Server validation is authoritative after reload, sleep or clock manipulation. Focus changes are logged and covered by a resume overlay; browsers cannot prevent OS-level tab switching. Fullscreen is optional, initiated by the candidate. Native controls are hidden and application replay is locked. A signed URL or public practice clip is not DRM; external recording or deliberate browser tampering cannot be prevented by a web application.

## Honest assessment

- 78 original receptive items plus 6 original expressive tasks, reused in two modes; no scraped official questions or copyrighted press extracts.
- The A1–C2 labels are editorial difficulty targets, **not psychometric calibration**. A human examiner review and candidate pilot dataset are required before validated C2-readiness claims.
- Reading/listening report raw accuracy. AI scores are internal 1–100 rubric indices. Neither is converted into a fabricated score out of 699 or 20.
- The NCLC converter takes only a user-entered official TCF score. NCLC 10+ includes a score band and is not identical to CEFR C2.
- Speaking is independent recording practice with scripted task-2 interlocutor responses. It is not an adaptive live examiner interview. The initial 39 recordings use French metropolitan synthetic voices; Quebec/Canadian accent coverage requires additional licensed recordings.

## Operations and remaining production gates

The database and original audio are provisioned. AI provider credentials are intentionally absent. Configure the documented environment variables and run a real-provider integration test before enabling paid corrections. Tune provider quotas and add a distributed per-user billing/rate limit before opening a large public service; the current implementation has an attempt/day cap, unique per-task scoring claims and a daily scoring-log cap, but the multi-task daily count is not a global concurrency transaction.

Configure Supabase SMTP, confirmation Site URL and redirect allowlist for the final domain; validate email delivery. Define a retention/deletion policy and a candidate data-deletion workflow before a public launch. Add monitoring, backups, accessibility review with assistive technology, examiner validation, browser microphone tests across Safari/Firefox/Chrome and an audio-processing consent policy appropriate to the deployment. Do not advertise this repository as an FEI-certified exam or an independently audited proctoring platform.

Local practice histories are capped at 100 attempts and stay in browser storage. Practice audio recordings remain in memory while the session is open and can be downloaded; they are not retained after closing it. Verified recordings are stored privately in Supabase.

## References (checked 2026-11-05)

- [FEI candidate manual](https://www.france-education-international.fr/document/manuelcandidattoutes20dc3a9clinaisonsi)
- [Council of Europe CEFR descriptors](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-descriptors)
- [IRCC TCF/NCLC table](https://www.canada.ca/fr/immigration-refugies-citoyennete/services/immigrer-canada/entree-express/documents/examen-linguistique.html)
