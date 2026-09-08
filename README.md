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

| Requirement | PavedPath AI |
| --- | --- |
| LLM | Workers AI with Llama 3.3 by default; optional Gemini or OpenAI-compatible local endpoint for development |
| Workflow / coordination | A Worker/Agent starts and observes a durable Cloudflare Workflow |
| User input | Browser chat/review interface |
| Memory / state | Per-agent Durable Object storage, including local SQL where implemented |

It also separates deterministic policy decisions from probabilistic explanations. The model may summarize and recommend, but policy IDs, severities, and evidence come from code. This makes results easier to test, audit, and trust.

## Architecture

```text
Browser chat
    │ HTTP / Agent connection
    ▼
Cloudflare Worker + Agent
    ├── conversation/review state (Durable Object / agent SQL)
    ├── deterministic policy engine
    ├── model adapter
    │     ├── Workers AI: Llama 3.3 (default)
    │     ├── Google Gemini (optional)
    │     └── OpenAI-compatible local endpoint (optional, development)
    └── Cloudflare Workflow
          ingest → normalize → evaluate → explain → persist
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

Workers AI is the submission-default provider and should use the Worker `AI` binding. The intended model is:

```text
@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

No third-party API key is needed for that path. For an optional Gemini adapter, store the key as a secret—never commit it or paste it into chat, screenshots, fixtures, or prompt history:

```bash
npx wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

For local development, use a `.dev.vars` file that is ignored by Git:

```dotenv
LLM_PROVIDER=gemini
GOOGLE_GENERATIVE_AI_API_KEY=replace-locally
GOOGLE_MODEL=gemini-model-id
```

An OpenAI-compatible local server can be selected by configuration when the adapter is present:

```dotenv
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1
OPENAI_COMPATIBLE_MODEL=local-model-name
```

Do not expose a machine-local model endpoint from a deployed Worker. A remote Worker cannot reach `127.0.0.1` on a developer laptop; this option is for local development unless a secured reachable inference service is supplied.

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

This repository is an assignment-scale prototype. Verify the current code and test output before presenting any item below as complete.

- Input is paste-first; GitHub App/webhook ingestion is a follow-up.
- Findings are advisory; automatic PR comments or code changes are not assumed.
- Voice input, production authentication, organization-level tenancy, and a full eval dashboard are out of the MVP.
- Provider adapters may not all be implemented. Workers AI remains the intended deployed path.
- Workflow durability and SQL-backed history must be demonstrated against the deployed bindings, not inferred from local mocks.
- LLM explanations can be wrong. The UI should distinguish deterministic evidence from model-generated advice.

## Submission materials

- [Architecture](docs/architecture.md)
- [Prompt history](docs/prompt-history.md)
- [Demo script](docs/demo-script.md)

## Official references

- [Cloudflare Agents](https://developers.cloudflare.com/agents/)
- [Agents and Workflows](https://developers.cloudflare.com/agents/concepts/workflows/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [Llama 3.3 on Workers AI](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)

