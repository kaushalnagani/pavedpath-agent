import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { callable, routeAgentRequest } from "agents";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { analyzeChange } from "./policy-engine";
import type {
  PavedPathState,
  ReviewInput,
  ReviewProgress,
  ReviewResult,
} from "./types";

export { PolicyReviewWorkflow } from "./workflow";
export type { PavedPathState } from "./types";

const SYSTEM_PROMPT = `You are PavedPath, an engineering policy review agent.
Your job is to help developers ship changes safely without becoming a gatekeeping bot.
Ground every claim in a policy finding or supplied CI evidence. Separate deterministic evidence from judgment.
Use inspectChange when the user shares a diff or CI log. Explain the smallest safe remediation first.
Use rememberException only when the user explicitly asks to record an exception; it requires human approval.
Never claim that code was deployed, merged, or changed. Keep responses concise and practical.`;

export class PavedPathAgent extends AIChatAgent<Env, PavedPathState> {
  initialState: PavedPathState = {
    currentReview: null,
    history: [],
    approvedExceptions: [],
  };

  maxPersistedMessages = 100;
  chatRecovery = true;

  @callable()
  async startReview(input: Omit<ReviewInput, "reviewId">) {
    if (!input.diff.trim() && !input.ciLog?.trim()) {
      throw new Error("Add a pull-request diff or CI log before starting a review.");
    }
    if (input.diff.length + (input.ciLog?.length ?? 0) > 150_000) {
      throw new Error("The combined diff and CI log must be smaller than 150 KB.");
    }

    const reviewId = crypto.randomUUID();
    this.setState({
      ...this.state,
      currentReview: {
        reviewId,
        title: input.title.trim() || "Untitled change",
        status: "queued",
        progress: 0.04,
        phase: "queued",
      },
    });

    const workflowId = await this.runWorkflow("POLICY_REVIEW_WORKFLOW", {
      ...input,
      reviewId,
    });

    this.setState({
      ...this.state,
      currentReview: this.state.currentReview
        ? { ...this.state.currentReview, workflowId }
        : null,
    });
    return { reviewId, workflowId };
  }

  async saveReviewResult(result: ReviewResult) {
    const withoutDuplicate = this.state.history.filter(
      (review: ReviewResult) => review.reviewId !== result.reviewId,
    );
    this.setState({
      ...this.state,
      currentReview: {
        reviewId: result.reviewId,
        workflowId: this.state.currentReview?.workflowId,
        title: result.title,
        status: "complete",
        progress: 1,
        phase: "complete",
        result,
      },
      history: [result, ...withoutDuplicate].slice(0, 20),
    });
  }

  async onWorkflowProgress(
    _workflowName: string,
    instanceId: string,
    progress: unknown,
  ) {
    const update = progress as ReviewProgress;
    const current = this.state.currentReview;
    if (!current) return;
    this.setState({
      ...this.state,
      currentReview: {
        ...current,
        workflowId: current.workflowId ?? instanceId,
        status: update.phase === "reasoning" ? "reasoning" : "scanning",
        progress: update.percent,
        phase: update.message,
      },
    });
  }

  async onWorkflowError(
    _workflowName: string,
    instanceId: string,
    error: string,
  ) {
    const current = this.state.currentReview;
    if (!current) return;
    this.setState({
      ...this.state,
      currentReview: {
        ...current,
        workflowId: current.workflowId ?? instanceId,
        status: "error",
        phase: "Review failed",
        error,
      },
    });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        sessionAffinity: this.sessionAffinity,
      }),
      system: SYSTEM_PROMPT,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message",
      }),
      tools: {
        inspectChange: tool({
          description: "Run deterministic Engineering Codex policies against a diff and optional CI log.",
          inputSchema: z.object({
            diff: z.string().describe("Unified pull-request diff"),
            ciLog: z.string().optional().describe("Relevant CI log output"),
          }),
          execute: async ({ diff, ciLog }: { diff: string; ciLog?: string }) =>
            analyzeChange({ diff, ciLog }),
        }),
        getReviewMemory: tool({
          description: "Read the current review, recent verdicts, and approved policy exceptions.",
          inputSchema: z.object({}),
          execute: async () => ({
            currentReview: this.state.currentReview,
            recentReviews: this.state.history.slice(0, 5),
            approvedExceptions: this.state.approvedExceptions,
          }),
        }),
        rememberException: tool({
          description: "Record a human-approved policy exception in durable agent memory.",
          inputSchema: z.object({
            ruleId: z.string(),
            reason: z.string().min(12),
          }),
          needsApproval: true,
          execute: async ({ ruleId, reason }: { ruleId: string; reason: string }) => {
            const exception = {
              ruleId,
              reason,
              approvedAt: new Date().toISOString(),
            };
            this.setState({
              ...this.state,
              approvedExceptions: [exception, ...this.state.approvedExceptions].slice(0, 50),
            });
            return exception;
          },
        }),
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
    });
    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
