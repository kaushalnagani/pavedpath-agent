import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import { analyzeChange } from "./policy-engine";
import type { PavedPathAgent } from "./server";
import type { AppEnv } from "./env";
import type { ReviewInput, ReviewProgress, ReviewResult } from "./types";

export class PolicyReviewWorkflow extends AgentWorkflow<
  PavedPathAgent,
  ReviewInput,
  ReviewProgress,
  AppEnv
> {
  async run(event: AgentWorkflowEvent<ReviewInput>, step: AgentWorkflowStep) {
    const input = event.payload;

    await this.reportProgress({
      phase: "normalize",
      percent: 0.12,
      message: "Normalizing the change set",
    });

    const normalized = await step.do("normalize-input", async () => ({
      ...input,
      title: input.title.trim() || "Untitled change",
      diff: input.diff.replaceAll("\r\n", "\n"),
      ciLog: input.ciLog?.replaceAll("\r\n", "\n") ?? "",
    }));

    await this.reportProgress({
      phase: "policy-scan",
      percent: 0.42,
      message: "Evaluating deterministic controls",
    });

    const scan = await step.do("run-policy-engine", async () =>
      analyzeChange({ diff: normalized.diff, ciLog: normalized.ciLog }),
    );

    await this.reportProgress({
      phase: "reasoning",
      percent: 0.72,
      message: "Generating actionable remediation",
    });

    const aiSummary = await step.do(
      "generate-remediation-summary",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const workersai = createWorkersAI({ binding: this.env.AI });
        const findingText = scan.findings.length
          ? scan.findings
              .map((finding) => `${finding.ruleId} (${finding.severity}): ${finding.evidence}`)
              .join("\n")
          : "No deterministic violations were found.";
        const { text } = await generateText({
          model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),
          system:
            "You are a staff platform engineer. Summarize review evidence without inventing facts. Give the developer a short verdict and the next safest action. Keep it under 120 words.",
          prompt: `Change: ${normalized.title}\n\nPolicy evidence:\n${findingText}`,
        });
        return text;
      },
    );

    const result: ReviewResult = {
      reviewId: normalized.reviewId,
      title: normalized.title,
      verdict: scan.verdict,
      findings: scan.findings,
      summary: aiSummary,
      completedAt: new Date().toISOString(),
    };

    await this.reportProgress({
      phase: "persist",
      percent: 0.92,
      message: "Saving the review record",
    });

    await step.do("save-review", async () => {
      await this.agent.saveReviewResult(result);
    });

    await step.reportComplete(result);
    return result;
  }
}
