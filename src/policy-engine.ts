import policyCatalog from "../policies/engineering-codex.json" with { type: "json" };

export type PolicySeverity = "low" | "medium" | "high" | "critical";

export type PolicyKind =
  | "migration-rollback"
  | "infrastructure-owner"
  | "auth-security-review"
  | "ci-failure"
  | "added-secret";

export interface PolicyRule {
  id: string;
  kind: PolicyKind;
  title: string;
  description: string;
  severity: PolicySeverity;
  remediation: string;
  enabled: boolean;
}

export interface ReviewContext {
  owner?: string;
  securityReviewApproved?: boolean;
  securityReviewReference?: string;
}

export interface PolicyInput {
  diff: string;
  ciLog?: string;
  context?: ReviewContext;
}

export interface PolicyEvidence {
  source: "diff" | "ci-log" | "context";
  excerpt: string;
  line?: number;
  targetLine?: number;
  file?: string;
}

export interface PolicyFinding {
  ruleId: string;
  title: string;
  description: string;
  severity: PolicySeverity;
  message: string;
  remediation: string;
  evidence: PolicyEvidence[];
}

export interface PolicyAnalysis {
  passed: boolean;
  findings: PolicyFinding[];
  evaluatedRuleIds: string[];
  summary: Record<PolicySeverity, number>;
}

interface DiffLine {
  rawLine: number;
  targetLine?: number;
  type: "added" | "removed" | "context" | "metadata";
  text: string;
}

interface ChangedFile {
  path: string;
  lines: DiffLine[];
}

export const DEFAULT_POLICY_RULES: readonly PolicyRule[] = policyCatalog as PolicyRule[];

const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate)(\/|$)|(?:^|\/)\d[^/]*\.sql$/i;
const INFRASTRUCTURE_PATH =
  /(^|\/)(infra|infrastructure|terraform|deploy|\.github\/workflows)(\/|$)|(^|\/)(wrangler(?:\.[^/]+)?\.(?:toml|jsonc?)|Dockerfile|.*\.tf)$/i;
const AUTH_PATH = /(^|\/)(auth|authentication|authorization|identity|oauth|sessions?|permissions?)(\/|[._-]|$)/i;
const AUTH_CODE = /\b(authenticate|authorization|oauth|jwt|session token|permission|password|passkey|api key)\b/i;
const OWNER_MARKER = /\b(owner|team|maintainer)\s*[:=]\s*[\w@./-]+/i;
const ROLLBACK_MARKER = /\b(rollback|down migration|revert|reversible|irreversible)\b|--\s*down\b/i;
const SECURITY_REVIEW_MARKER = /\bsecurity[- ]review(?:ed)?\s*[:=#-]?\s*[\w/-]+|\bsecurity[- ]approved\b/i;
const CI_FAILURE = /\b(fail(?:ed|ure|ures)?|error|panic|exception|timed out)\b/i;
const NEGATED_CI_FAILURE = /\b(?:0|no)\s+(?:failed|failures|errors)\b|\bwithout (?:failure|errors?)\b/i;

function normalizePath(path: string): string {
  return path.replace(/^[ab]\//, "");
}

function parseDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  let targetLine: number | undefined;

  diff.split(/\r?\n/).forEach((raw, index) => {
    const gitHeader = raw.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (gitHeader) {
      current = { path: normalizePath(gitHeader[2]), lines: [] };
      files.push(current);
      targetLine = undefined;
      return;
    }

    const newFile = raw.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (newFile && newFile[1] !== "/dev/null") {
      const path = normalizePath(newFile[1]);
      if (!current) {
        current = { path, lines: [] };
        files.push(current);
      } else {
        current.path = path;
      }
      return;
    }

    if (!current) return;

    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      targetLine = Number(hunk[1]);
      current.lines.push({ rawLine: index + 1, type: "metadata", text: raw });
      return;
    }

    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      current.lines.push({ rawLine: index + 1, targetLine, type: "added", text: raw.slice(1) });
      if (targetLine !== undefined) targetLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      current.lines.push({ rawLine: index + 1, type: "removed", text: raw.slice(1) });
    } else {
      current.lines.push({ rawLine: index + 1, targetLine, type: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw });
      if (targetLine !== undefined && !raw.startsWith("\\ No newline")) targetLine += 1;
    }
  });

  return files;
}

function evidenceForLine(source: "diff" | "ci-log", line: DiffLine | string, file?: string, lineNumber?: number): PolicyEvidence {
  if (typeof line === "string") {
    return { source, excerpt: line.trim().slice(0, 240), line: lineNumber, file };
  }
  return {
    source,
    excerpt: line.text.trim().slice(0, 240),
    line: line.rawLine,
    targetLine: line.targetLine,
    file,
  };
}

function finding(rule: PolicyRule, message: string, evidence: PolicyEvidence[]): PolicyFinding {
  return {
    ruleId: rule.id,
    title: rule.title,
    description: rule.description,
    severity: rule.severity,
    message,
    remediation: rule.remediation,
    evidence,
  };
}

function addedLines(file: ChangedFile): DiffLine[] {
  return file.lines.filter((line) => line.type === "added");
}

function inspectMigrationRollback(rule: PolicyRule, files: ChangedFile[]): PolicyFinding[] {
  return files.filter((file) => MIGRATION_PATH.test(file.path)).flatMap((file) => {
    const additions = addedLines(file);
    if (additions.length === 0 || additions.some((line) => ROLLBACK_MARKER.test(line.text))) return [];
    return [finding(rule, `Migration ${file.path} has no rollback guidance.`, [
      evidenceForLine("diff", additions[0], file.path),
    ])];
  });
}

function inspectInfrastructureOwner(rule: PolicyRule, files: ChangedFile[], context?: ReviewContext): PolicyFinding[] {
  const infraFiles = files.filter((file) => INFRASTRUCTURE_PATH.test(file.path) && addedLines(file).length > 0);
  if (infraFiles.length === 0 || context?.owner?.trim()) return [];
  const hasOwner = infraFiles.some((file) => addedLines(file).some((line) => OWNER_MARKER.test(line.text)));
  if (hasOwner) return [];
  return [finding(rule, "Infrastructure changes do not identify a rollout owner.", infraFiles.slice(0, 3).map((file) =>
    evidenceForLine("diff", addedLines(file)[0], file.path),
  ))];
}

function inspectAuthReview(rule: PolicyRule, files: ChangedFile[], input: PolicyInput): PolicyFinding[] {
  const authFiles = files.filter((file) => {
    const additions = addedLines(file);
    return additions.length > 0 && (AUTH_PATH.test(file.path) || additions.some((line) => AUTH_CODE.test(line.text)));
  });
  if (authFiles.length === 0 || input.context?.securityReviewApproved) return [];
  const suppliedText = `${input.diff}\n${input.ciLog ?? ""}`;
  if (SECURITY_REVIEW_MARKER.test(suppliedText)) return [];
  return [finding(rule, "Authentication-sensitive changes have no security-review approval.", authFiles.slice(0, 3).map((file) => {
    const relevant = addedLines(file).find((line) => AUTH_CODE.test(line.text)) ?? addedLines(file)[0];
    return evidenceForLine("diff", relevant, file.path);
  }))];
}

function inspectCiFailures(rule: PolicyRule, ciLog?: string): PolicyFinding[] {
  if (!ciLog?.trim()) return [];
  const matches = ciLog.split(/\r?\n/)
    .map((text, index) => ({ text, index }))
    .filter(({ text }) => CI_FAILURE.test(text) && !NEGATED_CI_FAILURE.test(text))
    .slice(0, 5);
  if (matches.length === 0) return [];
  return [finding(rule, `CI reported ${matches.length} failure signal${matches.length === 1 ? "" : "s"}.`, matches.map(({ text, index }) =>
    evidenceForLine("ci-log", text, undefined, index + 1),
  ))];
}

function looksLikeSecret(text: string): boolean {
  if (/process\.env|import\.meta\.env|\$\{\{\s*secrets\.|(?:secret|env)\s*reference/i.test(text)) return false;
  if (/(?:example|placeholder|replace[_ -]?me|dummy|test[_ -]?only|\*{3,}|x{6,})/i.test(text)) return false;
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return true;
  return /\b(?:api[_-]?key|secret|access[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{12,}/i.test(text);
}

function inspectAddedSecrets(rule: PolicyRule, files: ChangedFile[]): PolicyFinding[] {
  const exposed = files.flatMap((file) => addedLines(file)
    .filter((line) => looksLikeSecret(line.text))
    .map((line) => evidenceForLine("diff", line, file.path)))
    .slice(0, 5);
  if (exposed.length === 0) return [];
  return [finding(rule, `Found ${exposed.length} possible committed secret${exposed.length === 1 ? "" : "s"}.`, exposed)];
}

export function analyzePolicies(input: PolicyInput, rules: readonly PolicyRule[] = DEFAULT_POLICY_RULES): PolicyAnalysis {
  const files = parseDiff(input.diff ?? "");
  const enabledRules = rules.filter((rule) => rule.enabled);
  const findings = enabledRules.flatMap((rule) => {
    switch (rule.kind) {
      case "migration-rollback": return inspectMigrationRollback(rule, files);
      case "infrastructure-owner": return inspectInfrastructureOwner(rule, files, input.context);
      case "auth-security-review": return inspectAuthReview(rule, files, input);
      case "ci-failure": return inspectCiFailures(rule, input.ciLog);
      case "added-secret": return inspectAddedSecrets(rule, files);
      default: return [];
    }
  });

  const summary: Record<PolicySeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  findings.forEach((result) => { summary[result.severity] += 1; });
  return {
    passed: findings.length === 0,
    findings,
    evaluatedRuleIds: enabledRules.map((rule) => rule.id),
    summary,
  };
}
