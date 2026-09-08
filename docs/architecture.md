# PavedPath AI architecture

## Design goal

PavedPath AI turns a pull-request diff and CI log into an explainable, durable engineering-policy review. Its key design choice is to keep **decision logic deterministic** and use the LLM for **interpretation and communication**.

A model is useful for explaining an unfamiliar migration or turning raw evidence into actionable guidance. It should not invent policy IDs, silently lower severity, or decide that a required security review can be skipped.

## Components

### Web client

The client accepts chat messages, pasted diffs, and CI logs. It renders review progress, policy findings, evidence, and suggested remediation. A finding should visibly separate:

- the deterministic verdict;
- the source evidence and policy version; and
- the model-generated explanation.

The MVP is paste-first to keep the assignment focused. GitHub authentication and webhook ingestion can be added without changing the policy or workflow core.

### Worker and Agent

The Worker is the public HTTP boundary. The Cloudflare Agent provides a durable identity for a review conversation and owns its state. It validates input, enforces size limits, dispatches work, and serves status/history.

The intended persistent entities are:

```text
review
  id, created_at, status, input_digest, policy_version, workflow_id

finding
  review_id, policy_id, severity, message, evidence, location

message
  review_id, role, content, created_at

approval (future write actions)
  review_id, action, decision, actor, created_at
```

Only metadata needed for the product should be retained. Raw diffs/logs should have a documented retention policy before production use.

### Deterministic policy engine

The policy engine normalizes inputs and evaluates named rules. Example rules include:

- a database migration requires rollback guidance;
- infrastructure changes require an owner;
- authentication-sensitive changes require security review.

Each result is structured and testable:

```json
{
  "policyId": "DB-001",
  "status": "fail",
  "severity": "high",
  "message": "Destructive migration lacks rollback guidance",
  "evidence": [{ "line": 14, "excerpt": "DROP COLUMN legacy_id" }]
}
```

Model output must not overwrite these fields. It may attach an explanation, remediation, caveats, and confidence about its own interpretation.

### Cloudflare Workflow

The review is modeled as idempotent durable steps:

1. **Ingest** — validate limits, redact likely secrets, compute an input digest.
2. **Normalize** — split diff/log sections and extract useful metadata.
3. **Evaluate** — run deterministic policies and store structured findings.
4. **Explain** — send minimal relevant evidence to the selected model.
5. **Persist/finalize** — atomically make the completed review visible.

The input digest plus policy version provides an idempotency key. Retrying `explain` must not duplicate findings. If model inference fails, the review can still return deterministic results with an explicit `explanation_unavailable` state.

A future remediation/write-back flow should be a separate workflow that pauses for an external approval event. The MVP must not imply that write actions are active unless they have been implemented and tested.

### Model provider boundary

The application uses a small provider interface rather than embedding vendor logic in the policy engine:

```ts
interface ExplanationProvider {
  explain(input: GroundedReviewContext): Promise<ReviewExplanation>;
}
```

Provider priority:

1. **Workers AI / Llama 3.3** for the deployed Cloudflare submission.
2. **Gemini** as an optional adapter when a secret is configured.
3. **OpenAI-compatible endpoint** for local-only development against tools such as Ollama or LM Studio.

The prompt contains structured findings and bounded evidence, not the entire repository by default. Provider responses are parsed against a schema. Invalid or ungrounded output is rejected or displayed as unavailable rather than quietly accepted.

## Data flow

```text
User
  │ paste diff/log + ask question
  ▼
Worker input boundary
  │ validate, redact, route
  ▼
Agent instance ───────────────► durable conversation/review state
  │ start review workflow                    ▲
  ▼                                          │
Workflow: ingest → normalize → policy engine ┤
                                  │ findings │
                                  ▼          │
                         LLM explanation ────┘
                                  │
                                  ▼
                         status/result to UI
```

## State model

The Agent/Durable Object boundary provides per-conversation serialization and storage locality. Agent SQL is appropriate for review history because the data is relational and queried by review ID/status. Workflow state is execution state, not the long-term source of truth for user-visible review history.

State transitions should be monotonic:

```text
queued → ingesting → evaluating → explaining → completed
                                              └→ completed_with_warnings
any non-final state → failed
```

The client can reconnect and read the latest persisted state. It should not depend on an uninterrupted browser request to complete a review.

## Trust boundaries and abuse cases

| Risk | Mitigation |
| --- | --- |
| Prompt injection inside code comments or CI logs | Treat artifacts as quoted data; fixed system instruction; never expose tools based on artifact text |
| Secret leakage | Pre-inference redaction; minimal evidence; no raw artifact logging; documented retention |
| Hallucinated violation | Verdicts originate in deterministic rules; explanation is labeled AI-generated |
| Cross-user state leakage | Per-user/agent routing and authorization before production |
| Oversized/expensive input | Byte/line limits, truncation notice, bounded tokens and timeouts |
| Duplicate Workflow delivery | Idempotency key and upsert semantics |
| Provider outage | Preserve deterministic findings; explicit degraded result; retry only safe steps |
| Dangerous automated action | No write-back in MVP; later actions require scoped credentials and human approval |

## Observability

Log structured metadata—not raw source—using a correlation ID shared by Agent and Workflow. Useful fields are `review_id`, `workflow_id`, `policy_version`, `provider`, `step`, `duration_ms`, `finding_count`, and error category. Track:

- end-to-end and per-step latency;
- provider error and schema-rejection rate;
- finding count by policy/version;
- Workflow retries and terminal failures;
- redaction count; and
- eval precision/recall for deterministic rules.

## Evaluation plan

The minimum useful evaluation corpus contains labeled diffs for each rule, hard negatives, multiline edge cases, adversarial comments, truncated logs, and malformed diffs. Metrics are:

- rule-level precision and recall;
- evidence-location accuracy;
- explanation groundedness (does each claim cite an existing finding/evidence item?);
- provider schema-validity rate;
- latency and approximate inference cost.

Evaluation fixtures must contain synthetic data and no credentials or employer code.

## Trade-offs

- **Paste-first vs GitHub integration:** less impressive integration, but faster to audit and demo reliably.
- **Rules before embeddings/RAG:** narrower coverage, but deterministic and testable. Policy retrieval can be introduced when the corpus outgrows the MVP.
- **One Agent per conversation:** simple isolation and real-time state; organization-wide reporting would need a separate indexed store.
- **Workers AI default with adapters:** showcases the target platform while preserving local testability and avoiding provider lock-in in core logic.
- **Advisory findings:** safer for an assignment. Automated write-back deserves a separate threat model and approval workflow.

## Delivery phases

### MVP

- chat/paste input;
- at least three deterministic policies;
- Workers AI explanation path;
- durable review state;
- Workflow progress and retry behavior;
- unit tests and a small labeled eval set.

### Follow-up

- GitHub App/webhooks and check runs;
- organization policy packs and versioning;
- human-approved suggested patches;
- MCP policy/review tools;
- authentication, tenancy, retention controls, and eval dashboard.

## Verification checklist

Before claiming a capability in the final submission, capture evidence that:

- the deployed Worker responds;
- a failing and a passing fixture produce expected findings;
- a refresh retains review history;
- the bound Workflow runs and reaches a terminal state;
- an inference failure degrades cleanly;
- no secret appears in browser, Worker, or Workflow logs; and
- the README commands pass from a clean checkout.

