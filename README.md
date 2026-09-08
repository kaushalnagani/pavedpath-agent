# PavedPath AI

An AI-assisted pull-request and CI policy reviewer built for Cloudflare's AI application assignment.

**Paved path** is a platform-engineering term for the recommended, well-supported way to ship software. It is not a gate that replaces engineers: it makes the safe path easy, explains deviations, and leaves consequential decisions with a human. PavedPath AI applies that idea to pull-request diffs and CI logs.

## What it does

A developer pastes a PR diff and, optionally, CI output into chat. PavedPath AI then:

1. evaluates deterministic engineering policies;
2. asks an LLM to explain the evidence and suggest remediation;
3. records the review and conversation as durable agent state;
4. coordinates the review as a retryable multi-step process; and
5. presents findings for human review rather than silently changing code.

Example questions include:

- `Review this migration and CI log before I merge.`
- `Why did policy DB-001 fail?`
- `Show me the exact evidence for the security-review finding.`
- `What should I change to make this compliant?`

## Why this project

This is deliberately more than a generic chatbot. It demonstrates the four parts requested in the assignment:

| Requirement | PavedPath AI (implemented) |
| --- | --- |
| LLM | Workers AI Llama 3.3 (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) via `workers-ai-provider`; used for chat responses and workflow remediation summaries |
| Workflow / coordination | `PolicyReviewWorkflow extends AgentWorkflow`: normalize → policy scan → AI remediation (retry ×3) → persist; progress callbacks drive the UI trace |
| User input | React chat (`useAgentChat`) plus a paste-first review form (title/diff/optional CI log) and approval-gated exception recording |
| Memory / state | `PavedPathAgent extends AIChatAgent<Env, PavedPathState>`; conversation messages persisted by the platform (SQLite-backed Durable Object storage); review state (`currentReview`, `history` capped at 20, `approvedExceptions` capped at 50) via `setState`; no custom SQL tables |

It also separates deterministic policy decisions from probabilistic explanations. The model may summarize and recommend, but policy IDs, severities, and evidence come from code. This makes results easier to test, audit, and trust.

## Architecture

```text
Browser chat
    │ HTTP / Agent connection
    ▼
Cloudflare Worker + Agent
    ├── conversation/review state (Durable Object; platform SQLite-backed, no custom tables)
    ├── deterministic policy engine (5 rules: DB-001, INFRA-001, AUTH-001, CI-001, SEC-001)
    ├── secret redaction before model calls
    ├── model adapter
    │     └── Workers AI: Llama 3.3 (implemented default; Gemini/local are future-only, not implemented)
    └── Cloudflare Workflow (AgentWorkflow)
          normalize → policy scan → AI remediation → persist
```

See [docs/architecture.md](docs/architecture.md) for boundaries, data flow, threat model, and trade-offs.

## Local setup

Prerequisites:

- Node.js 20 or newer
- npm
- a Cloudflare account for Workers AI and deployed Workflows
- Wrangler authentication (`npx wrangler login`) for deployment

Install and inspect the available scripts:

```bash
npm install
npm run
```

The intended development commands are:

```bash
npm run dev
npm test
npm run typecheck
```

If a command is not listed by `npm run`, it is still a project TODO and should not be treated as implemented. The local URL is printed by Wrangler/Vite when the development server starts.

### Model configuration

Workers AI is the only implemented provider and uses the Worker `AI` binding. The model is:

```text
@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

No third-party API key is needed. Gemini and OpenAI-compatible local adapters are **not implemented**; they are documented only as future options. Do not add keys for them, and never commit secrets or paste them into chat, screenshots, fixtures, or prompt history. If a Gemini adapter is added later, its key must be stored via:

```bash
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

## Deploy

1. Review the bindings and migrations in `wrangler.jsonc` or `wrangler.toml`.
2. Authenticate with Cloudflare: `npx wrangler login`.
3. Add only the secrets required by the selected provider.
4. Run the repository's typecheck and tests.
5. Deploy with the package script if present:

```bash
npm run deploy
```

Otherwise use the Wrangler command documented by the final project configuration. After deployment, verify one clean review, one failing review, a refresh/state-recovery path, and redaction of credentials from logs.

## Testing strategy

The project should be judged on reproducible behavior, not only an attractive demo:

- **Unit tests:** normalization and deterministic policy rules.
- **Contract tests:** model output parsing and provider error handling.
- **Integration tests:** agent state and Workflow status transitions.
- **Evaluation set:** labeled safe/unsafe diffs, measuring rule precision/recall and explanation groundedness.
- **Manual smoke test:** submit, refresh, revisit a review, and exercise a provider failure.

Run the commands that exist in `package.json`:

```bash
npm test
npm run typecheck
```

## Safety and privacy

- Treat pasted diffs and CI output as untrusted data, not model instructions.
- Never include API keys, access tokens, or customer data in a demo submission.
- Redact common secret patterns before model calls and logging.
- Keep policy verdicts deterministic and attach evidence to every finding.
- Require explicit human approval before any future write-back to GitHub.
- Scope persisted state per agent/user and avoid sharing one global review history.

## Current scope and honest limitations

This repository is an assignment-scale prototype.

**Verified locally on 2026-09-08 (`npm run check`: typecheck + 10 vitest tests + `vite build` all pass):**

- 5 deterministic policy rules with evidence, unit-tested (`test/policy-engine.test.ts`).
- `analyzeChange` bridge maps engine findings to UI verdicts (`pass` / `needs-attention` / `block`).
- Secret redaction runs before workflow model prompts and is unit-tested.
- Agent chat tools (`inspectChange`, `getReviewMemory`, approval-gated `rememberException`) typecheck against the installed `agents`/`@cloudflare/ai-chat` SDKs.
- Workflow compiles: normalize → policy scan → remediation summary (3 retries, graceful `AI explanation unavailable` fallback) → persist via `saveReviewResult`.
- Client builds to `dist/client`.

**Deployed and verified live on 2026-09-08 (version `741b8921-a3b8-4608-bdcf-68c699e1c944`, 100% traffic):**

- URL: `https://pavedpath-ai.pavedpath-ai.workers.dev`
- `/` returns HTTP 200 `text/html` with the PavedPath app shell (title, `/assets/index-CSWbMjSi.js`, `/assets/index-D6nxSi00.css`).
- `/assets/index-CSWbMjSi.js` returns HTTP 200 `text/javascript` (487,790 bytes, matching the local build).
- `/agents/PavedPathAgent/review-demo` returns HTTP 400 `Invalid request` for both a plain GET and a bare WebSocket upgrade probe — the Worker and agent router are live; the route rejects requests that do not speak the agent protocol (expected).
- Bindings confirmed on the deployment: `env.PavedPathAgent` (Durable Object), `env.POLICY_REVIEW_WORKFLOW` (Workflow), `env.AI` (AI).
- Note: immediately after deploy, root checks briefly failed (one HTTP 502, then TLS handshake/transport errors); this was DNS/TLS propagation — the deploy output said DNS may take a few minutes. No workers.dev registration action was needed; the warning proved benign.
- Re-verified 2026-09-08 15:38 UTC (same version, no redeploy): `/` HTTP 200 `text/html`, JS asset HTTP 200 `text/javascript` 487,790 bytes, agent route HTTP 400 `Invalid request`; `wrangler deployments list` still 100% on `741b8921-…`; `wrangler workflows list` shows `policy-review-workflow` (script `pavedpath-ai`, class `PolicyReviewWorkflow`). `npm run check` passes (typecheck + 10 tests + build).

**Not verified / not implemented (do not present as complete):**

- No end-to-end chat turn, review workflow execution, Workers AI inference, or refresh-persistence exercised against the deployed bindings — those remain unverified.
- Input is paste-first; GitHub App/webhook ingestion is a follow-up.
- Findings are advisory; automatic PR comments or code changes are not implemented.
- No Gemini or OpenAI-compatible provider adapter exists in code.
- No custom SQL tables; durability relies on Agent `setState`/message persistence (platform SQLite-backed DO storage).
- Voice input, production authentication, organization-level tenancy, and a full eval dashboard are out of the MVP.
- LLM explanations can be wrong. The UI distinguishes deterministic evidence from model-generated advice.

## Submission materials

- [Architecture](docs/architecture.md)
- [Prompt history](docs/prompt-history.md)
- [Demo script](docs/demo-script.md)

## Official references

- [Cloudflare Agents](https://developers.cloudflare.com/agents/)
- [Agents and Workflows](https://developers.cloudflare.com/agents/concepts/workflows/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Llama 3.3 on Workers AI](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)

