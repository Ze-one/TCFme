# TCFme C2 Pro

A French-language TCF Canada practice application built with **Next.js App Router, TypeScript, Supabase and AI SDK**. The interface uses forest/mint gradients, rounded white cards, lime pill buttons and an original 3D study illustration.

## Run locally

Requires Node.js 24 and pnpm 11.25.0 (pinned in `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Discovery mode works without credentials: timed exercises, all 39 original listening clips, 39 reading questions, writing/speaking practice, raw QCM results, local history and the official-score NCLC converter. Sign in with a Supabase account for database-backed attempts and private recording storage.

```sh
pnpm typecheck
pnpm test
pnpm build:next
pnpm start
```

## Vercel deployment

Import **Ze-one/TCFme** into Vercel. The repository root is the application root; `vercel.json` selects native Next.js, `pnpm install --frozen-lockfile`, and `pnpm build:next`. No Cloudflare adapter is used by the Vercel build.

1. Set the variables below in Vercel Project Settings → Environment Variables. Keep secrets server-only.
2. In Supabase Auth → URL Configuration, set the final application Site URL and allow only required preview/production redirect URLs. Configure SMTP and verify confirmation email delivery.
3. Deploy, create a candidate account, complete a short test attempt, then run a writing and audio correction with the configured model provider.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Optional override of the provisioned project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional public-key override. RLS remains authoritative. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only scoring-log writes and private audio access for grading. |
| `AI_GATEWAY_API_KEY` | Server-only Vercel AI Gateway credential. |
| `AI_GRADING_MODEL` | Current provider/model ID supporting structured text output. |
| `AI_AUDIO_MODEL` | Current provider/model ID supporting native audio plus structured output. |

Use `.env.example` as a template for `.env.local`. The UI never receives the service-role or AI key. No paid model credential is included. Until configured, `/api/evaluate` returns an explicit 503 and preserves the candidate's work; it does not fabricate feedback. Select models from the [current AI Gateway catalog](https://ai-gateway.vercel.sh/v1/models) and verify audio format support before enabling speaking evaluation.

## Supabase

The dedicated **tcfme-c2-pro** project (`lmkogwjrbdtzanxzmyqm`, Canada Central) has been provisioned with the migrations, eight test variants, 168 question rows and 39 private audio files. Public coordinates are in `lib/config.ts`; they are not privileged credentials.

For a fresh project:

```sh
pnpm exec supabase login
pnpm exec supabase link --project-ref YOUR_PROJECT_REF
pnpm exec supabase db push --include-seed
# With the target URL and service-role key in your local environment:
node --env-file=.env.local scripts/upload-audio.mjs
```

Apply tracked migrations in order. `supabase/seed.sql` is repeatable and contains the original content. `node scripts/seed-content.mjs` regenerates it from `lib/bank.ts`; it also prepares scripts for the optional Windows `scripts/generate-audio.ps1`. The checked-in WAV files work on every supported platform. Do not run database reset against the hosted project.

Run `supabase/security-tests.sql` as an administrator against a staging database to test authorization and timing; every fixture is rolled back. It checks owner visibility, cross-account denial, hidden answer keys, immutable deadlines/submissions, one-time audio claims and rejection of late answers.

## Modules

- `supabase/migrations/`: complete schema, RLS, private answer keys, atomic attempt transitions, storage policies, scoring logs and deadline hardening.
- `components/exam-runner.tsx`: absolute timers, reading split view, autosaved writing with word counts, single-play HTML5 audio, focus-loss reporting, microphone recording and speaking phases.
- `app/api/evaluate/route.ts` + `lib/rubric.ts`: authenticated structured evaluation, evidence grounding, retryable/idempotent logs, C2 rewrite and explicit model limitations.
- `components/dashboard.tsx`: skill indices, history, JSON export, official-score converter, account UI, resources and preferences.
- `docs/ARCHITECTURE.md`: security boundaries, reference sources, limitations and production launch gates.

## Assessment scope

Format TCF uses the verified FEI task structure. The alternative ranges and persuasion task in the original brief are retained under **Atelier C2**, explicitly separate from official format. All passages and scripts are original. Difficulty labels require examiner review and statistical calibration; practice accuracy is never falsely converted into a TCF score. The app is independent of FEI and does not issue certificates.

Browsers cannot prevent operating-system focus changes or make replay technically impossible outside the UI. Focus events are logged, server deadlines are enforced, and repeated audio claims are denied. Speaking is a timed autonomous rehearsal with scripted interlocutor responses, not an adaptive human interview. Initial audio uses metropolitan French synthetic voices; broader accent coverage remains a content-development task.

## Optional private Sites preview

The same source includes the retained Sites/Vinext hosting adapter. This is independent of Vercel:

```sh
pnpm dev:sites
# macOS/Linux
TCF_BUILD_TARGET=sites pnpm build
# PowerShell
$env:TCF_BUILD_TARGET='sites'; pnpm build
```

The `.openai/hosting.json` identity belongs to this app's private preview. Runtime secrets are configured in the hosting platform, never in that manifest. `pnpm build` without `TCF_BUILD_TARGET=sites` builds native Next.js. Keep `.env.local`, `.sites-runtime`, `.next`, `dist`, `work` and `node_modules` out of Git.

## Validation

Type checking, seven domain tests, native Next.js production compilation, the Sites adapter build, database authorization tests and browser reading/listening submission and writing autosave were verified during implementation. The database contains all 39 audio objects. Live paid-provider grading, cross-browser microphone recording, email delivery and load testing still require deployment-specific configuration and validation.
