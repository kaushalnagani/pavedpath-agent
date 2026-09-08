export type Severity = "critical" | "high" | "medium" | "low";
export type ReviewStatus = "idle" | "queued" | "scanning" | "reasoning" | "complete" | "error";

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  evidence: string;
  recommendation: string;
  line?: number;
}

export interface ReviewInput {
  reviewId: string;
  title: string;
  diff: string;
  ciLog?: string;
}

export interface ReviewResult {
  reviewId: string;
  title: string;
  verdict: "pass" | "needs-attention" | "block";
  findings: Finding[];
  summary: string;
  completedAt: string;
}

export interface CurrentReview {
  reviewId: string;
  workflowId?: string;
  title: string;
  status: ReviewStatus;
  progress: number;
  phase: string;
  result?: ReviewResult;
  error?: string;
}

export interface PavedPathState {
  currentReview: CurrentReview | null;
  history: ReviewResult[];
  approvedExceptions: Array<{ ruleId: string; reason: string; approvedAt: string }>;
}

export interface ReviewProgress {
  phase: string;
  percent: number;
  message: string;
}
