# AI assistance and prompt history

Cloudflare's assignment explicitly allows AI-assisted coding and asks candidates to submit prompt history. This file is an audit trail, not a claim that AI output was accepted without review.

## Recording rules

- Add entries chronologically; do not rewrite failed attempts into a perfect story.
- Preserve exact prompts when available. If only a summary is available, label it **paraphrased**.
- Never include API keys, access tokens, private employer code, or personal data.
- Record what was accepted, changed, rejected, and how it was verified.
- Link a commit or changed files when practical.

## Entries

### 2026-09-08 — Choosing the assignment concept

**Tool/model:** OpenAI Codex (exact model/version not captured in the available transcript)

**User prompt (verbatim wording; links normalized to plain URLs and rich-text markup removed):**

> hi i am applying for clouldflare :
>
> We plan to fast track candidates who complete an assignment to build a type of AI-powered application on Cloudflare. An AI-powered application should include the following components:
>
> - LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
> - Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
> - User input via chat or voice (recommend using Pages or Realtime)
> - Memory or state
>
> Find additional documentation here: https://developers.cloudflare.com/agents/.
>
> Note: AI-assisted coding is encouraged, but you have to submit prompt history.
>
> https://job-boards.greenhouse.io/cloudflare/jobs/8168623?gh_jid=8168623
>
> https://agents.cloudflare.com/
>
> can you help with assignment and what should i build

**Assistant response (abridged; exact opening retained, remainder condensed):**

> Yes—I’d build **PavedPath AI**, an AI-powered pull-request and CI policy reviewer for engineering teams.
>
> It fits this Cloudflare role unusually well because the team builds developer tooling, CI/CD systems, MCP servers, AI agents, and automated Engineering Codex controls—not just generic chatbots.
>
> A developer submits a pull-request diff, CI log, or repository URL through chat. The agent detects failed checks and policy violations, explains the issue, suggests remediation, asks for human approval before risky actions, remembers accepted exceptions and team preferences, and shows durable workflow progress.
>
> The proposed architecture uses Workers AI with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, a Cloudflare Agent and multi-step Workflow, a React chat interface, and Durable Object-backed state. The recommended MVP supports pasted diffs/CI output, three policy-as-code rules, grounded explanation/remediation, Workflow progress, approval flow, persistent history, and a small evaluation suite.
>
> Keep the first version focused: avoid GitHub OAuth, voice, Kubernetes, or a large RAG pipeline until the core is reliable. Potential follow-ups include GitHub webhooks, PR comments, MCP tools, failure injection, an evaluation dashboard, evidence/confidence views, and an approval audit trail.

The complete response—including links, the feature table, and illustrative repository tree—remains in the original application transcript and should be supplied alongside this curated log if the submission supports an attachment.

**Candidate decision:** Accepted PavedPath AI as the project direction and asked for implementation help.

**Human judgment / changes:** The design is being tightened so deterministic code owns policy verdicts while the model only explains evidence and proposes remediation. This is more testable than allowing the model to be the sole policy judge.

**Verification:** Architecture reviewed against the official Cloudflare Agents, Workflows, and Workers AI model documentation. Implementation verification was not complete at the time of this entry.

### 2026-09-08 — Starting implementation

**Tool/model:** OpenAI Codex; the user's phrase “MOS 1.3” was ambiguous and no such provider/model is asserted here.

**User prompt (exact, with original speech-to-text wording):**

> Can you help me in building that? What is a path? Yeah, can you help me in building that as well? And you can use OpenAI code and use MOS 1.3 for free implementation. So you can, like these guys all tasks, submit all tasks to them. Okay, we are building. Can you build that? Yeah. And we can use Google API. I will give you the Google API key and any free model of Google. We can point to them on local LLM. Yeah.

**Interpretation (explicitly paraphrased because parts of the transcript are ambiguous):** The user asked to start building PavedPath AI, authorized AI-assisted implementation, and proposed a Google model/API or local LLM. “MOS 1.3” was not mapped to a known provider or model without confirmation.

**AI plan (paraphrased):**

Build the MVP in parallel workstreams: Cloudflare application/runtime wiring, deterministic policy engine/tests, platform-pattern research, and submission documentation. Keep Workers AI as the deployed default while making alternate providers optional.

**Security decision:** The user should not send a Google API key in chat or commit it. Configure it through `wrangler secret put` for deployment or an ignored `.dev.vars` file for local work.

**Accepted:** Cloudflare-native deployed architecture; optional Gemini/local adapter boundary; documentation and honest limitations.

**Not yet verified at entry time:** End-to-end deployment, Workflow binding, agent SQL persistence, Gemini/local adapters, and UI behavior.

## Entry template

Copy this block for every material AI-assisted change:

```markdown
### YYYY-MM-DD — Short task name

**Tool/model:**

**Prompt (exact unless labeled paraphrased):**

> Prompt text with all secrets removed

**AI proposal/output:**

**Accepted:**

**Changed or rejected:**

**Human reasoning:**

**Verification performed:**

**Files/commit:**
```

## Final-submission reminder

Export or attach the original conversation transcript if the application form permits it. Keep this curated log alongside it so reviewers can quickly see the candidate's decisions, corrections, and verification. Before submission, add the implementation prompts and test/deployment outcomes that occur after these initial entries.
