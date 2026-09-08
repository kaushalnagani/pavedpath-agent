# PavedPath AI demo script

Target length: 4–5 minutes. Use synthetic fixtures only. Do not improvise with a real private repository or expose dashboard secrets.

## Before recording

- Deploy the exact commit being submitted.
- Run tests/typecheck and keep the successful output available.
- Prepare one compliant fixture and one intentionally non-compliant fixture.
- Use a clean browser profile with no tokens visible.
- Confirm review persistence after refresh.
- Confirm the Workflow and Workers AI bindings in the deployed environment.
- Remove or verbally qualify any UI element that is still mocked.

## 0:00–0:30 — Problem and thesis

> “PavedPath AI helps developers understand whether a pull request follows an engineering team's supported path. A paved path is the recommended, well-supported way to ship software. The tool does not replace code owners: deterministic policies produce verdicts, and AI explains the evidence and suggests a fix.”

Show the home/review screen and briefly point out the four assignment components: chat input, Agent state, Workflow coordination, and the LLM.

## 0:30–1:20 — Submit a review

Paste the prepared unsafe diff and CI log. Use a natural prompt:

> “Review this migration before I merge it. Explain any blocking issue and give me the smallest safe remediation.”

Show progress states if implemented. Say only what is visible and verified:

> “The Agent starts a durable review. The Workflow normalizes input, runs the policy engine, asks Workers AI to explain grounded findings, and persists the result.”

If real-time progress is not implemented, say the UI polls persisted status. Do not call polling “streaming.”

## 1:20–2:15 — Explain one failure

Use a fixture containing a destructive migration without rollback guidance. Point to:

- policy ID and severity;
- exact line/evidence;
- deterministic verdict; and
- separately labeled AI explanation/remediation.

Ask a follow-up:

> “Why is this unsafe, and what rollback would you expect?”

Explain that source text is untrusted content. A malicious code comment cannot authorize tools or change policy.

## 2:15–2:50 — Memory and recovery

Refresh the page or close/reopen the review. Show that the result and conversation remain available.

> “The browser is not the source of truth. The review belongs to the Agent's durable state, so reconnecting does not reconstruct the session from client memory.”

Only use that wording after verifying deployed persistence. Otherwise, show the current local behavior and identify durable persistence as unfinished.

## 2:50–3:25 — Passing case and degraded behavior

Submit the compliant fixture, or show its recorded review, and demonstrate that the same policy passes.

If a provider-failure fixture exists, show that deterministic findings remain available while the explanation is marked unavailable. This is a stronger reliability story than pretending model calls never fail.

## 3:25–4:05 — Architecture and Cloudflare fit

Show the compact architecture diagram from the README.

> “Workers AI runs Llama 3.3 for the deployed path. The Agent owns conversation and review state. A Cloudflare Workflow makes multi-step analysis retryable. The policy engine stays model-independent, and a narrow provider adapter lets me test locally or optionally use Gemini without changing verdict logic.”

Mention one deliberate trade-off: paste-first input made the core behavior testable within the assignment; a GitHub App is the next integration, not hidden unfinished work.

## 4:05–4:30 — Verification and close

Show passing tests or the eval summary.

> “I evaluate deterministic rule precision and recall separately from explanation groundedness. Every finding has traceable evidence, and no automated repository write occurs without a future human-approval flow.”

Close with the prompt-history document and mention one AI suggestion you changed through human judgment.

## Backup plan

If live inference fails during the demo:

1. show the explicit degraded state;
2. show that deterministic findings survived;
3. open a previously persisted successful review; and
4. explain the provider boundary and retry policy.

This demonstrates the failure mode instead of hiding it.

## Claims checklist

Do not make a claim unless the recording proves it or the repository contains a passing test:

- [ ] Deployed on Cloudflare
- [ ] Workers AI/Llama 3.3 call is real
- [ ] Workflow execution is real and durable
- [ ] Agent state persists across refresh/reconnect
- [ ] SQL-backed state is actually used
- [ ] UI progress is streaming (not polling)
- [ ] Gemini adapter works
- [ ] Local provider adapter works
- [ ] Policy test/eval metrics are reproducible
- [ ] Secret redaction is implemented and tested

