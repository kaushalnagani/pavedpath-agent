import { describe, expect, it } from "vitest";

import {
  analyzeChange,
  analyzePolicies,
  DEFAULT_POLICY_RULES,
  redactSecrets,
} from "../src/policy-engine";

function diff(path: string, addedLines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

describe("policy engine", () => {
  it("reports a clean ordinary change as passing", () => {
    const result = analyzePolicies({
      diff: diff("src/math.ts", ["export const add = (a: number, b: number) => a + b;"]),
      ciLog: "12 tests passed; 0 failures",
    });

    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.evaluatedRuleIds).toHaveLength(DEFAULT_POLICY_RULES.length);
  });

  it("requires rollback guidance for each migration", () => {
    const unsafe = analyzePolicies({
      diff: diff("db/migrations/001_drop_users.sql", ["DROP TABLE users;"]),
    });
    expect(unsafe.passed).toBe(false);
    expect(unsafe.findings[0].ruleId).toBe("DB-001");
    expect(unsafe.findings[0].evidence[0].file).toBe("db/migrations/001_drop_users.sql");
    expect(unsafe.findings[0].evidence[0].targetLine).toBe(1);

    const documented = analyzePolicies({
      diff: diff("db/migrations/002_add_index.sql", [
        "CREATE INDEX users_email ON users(email);",
        "-- Rollback: DROP INDEX users_email;",
      ]),
    });
    expect(documented.findings.some((finding) => finding.ruleId === "DB-001")).toBe(false);
  });

  it("accepts infrastructure ownership from metadata or the diff", () => {
    const change = diff("infra/worker.tf", ['resource "cloudflare_workers_script" "api" {}']);
    expect(analyzePolicies({ diff: change }).findings.some((finding) => finding.ruleId === "INFRA-001")).toBe(true);
    expect(
      analyzePolicies({ diff: change, context: { owner: "platform-team" } }).findings.some(
        (finding) => finding.ruleId === "INFRA-001",
      ),
    ).toBe(false);
    expect(
      analyzePolicies({
        diff: diff("wrangler.toml", ['# owner: edge-platform', 'name = "review-agent"']),
      }).findings.some((finding) => finding.ruleId === "INFRA-001"),
    ).toBe(false);
  });

  it("authentication code needs an explicit security review", () => {
    const authDiff = diff("src/auth/session.ts", [
      "export function validateJwt(token: string) {",
      "  return token.length > 0;",
      "}",
    ]);
    const blocked = analyzePolicies({ diff: authDiff });
    expect(blocked.findings.some((finding) => finding.ruleId === "AUTH-001")).toBe(true);

    const approved = analyzePolicies({
      diff: authDiff,
      context: { securityReviewApproved: true, securityReviewReference: "SEC-42" },
    });
    expect(approved.findings.some((finding) => finding.ruleId === "AUTH-001")).toBe(false);
  });

  it("extracts CI failure evidence but ignores a zero-failure summary", () => {
    const result = analyzePolicies({
      diff: "",
      ciLog: "build passed\nFAIL test/login.test.ts\nError: expected 200\n0 failures in lint",
    });
    const ci = result.findings.find((finding) => finding.ruleId === "CI-001");
    expect(ci).toBeDefined();
    expect(ci?.evidence).toHaveLength(2);
    expect(ci?.evidence.map((item) => item.line)).toEqual([2, 3]);
  });

  it("detects literal secrets only on added lines and ignores managed references", () => {
    const combined = [
      diff("src/config.ts", [
        "const key = process.env.API_KEY;",
        'const password = "replace-me-placeholder";',
        'const apiKey = "sk_live_1234567890abcdef";',
      ]),
      diff("src/old.ts", ["export const safe = true;"]).replace(
        "+export const safe = true;",
        '-const secret = "previously_committed_value";\n+export const safe = true;',
      ),
    ].join("\n");
    const result = analyzePolicies({ diff: combined });
    const secret = result.findings.find((finding) => finding.ruleId === "SEC-001");
    expect(secret).toBeDefined();
    expect(secret?.evidence).toHaveLength(1);
    expect(secret?.evidence[0].excerpt).toMatch(/sk_live/);
    expect(result.summary.critical).toBe(1);
  });

  it("disabled rules are not evaluated", () => {
    const rules = DEFAULT_POLICY_RULES.map((rule) =>
      rule.id === "CI-001" ? { ...rule, enabled: false } : rule,
    );
    const result = analyzePolicies({ diff: "", ciLog: "ERROR: build failed" }, rules);
    expect(result.passed).toBe(true);
    expect(result.evaluatedRuleIds).not.toContain("CI-001");
  });
});

describe("analyzeChange bridge", () => {
  it("maps a clean change to pass with UI findings", () => {
    const result = analyzeChange({
      diff: diff("src/math.ts", ["export const ok = 1;"]),
    });
    expect(result.verdict).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.policyVersion).toBe("engineering-codex-v1");
  });

  it("maps high findings to needs-attention and critical to block", () => {
    const migration = analyzeChange({
      diff: diff("db/migrations/001_drop_users.sql", ["DROP TABLE users;"]),
    });
    expect(migration.verdict).toBe("needs-attention");
    expect(migration.findings[0].ruleId).toBe("DB-001");
    expect(migration.findings[0].recommendation.length).toBeGreaterThan(0);

    const secret = analyzeChange({
      diff: diff("src/config.ts", ['const apiKey = "sk_live_1234567890abcdef";']),
    });
    expect(secret.verdict).toBe("block");
  });
});

describe("redactSecrets", () => {
  it("redacts private keys and long tokens", () => {
    const { redacted, redactionCount } = redactSecrets(
      'key="sk_live_1234567890abcdef"\n-----BEGIN PRIVATE KEY-----\nshort ok',
    );
    expect(redacted).not.toContain("sk_live_1234567890abcdef");
    expect(redacted).toContain("[REDACTED]");
    expect(redactionCount).toBeGreaterThanOrEqual(1);
  });
});
