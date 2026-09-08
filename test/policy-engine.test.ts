import assert from "node:assert/strict";
import test from "node:test";

import { analyzePolicies, DEFAULT_POLICY_RULES } from "../src/policy-engine.ts";

function diff(path: string, addedLines: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((line) => `+${line}`),
  ].join("\n");
}

test("reports a clean ordinary change as passing", () => {
  const result = analyzePolicies({ diff: diff("src/math.ts", ["export const add = (a: number, b: number) => a + b;"]), ciLog: "12 tests passed; 0 failures" });

  assert.equal(result.passed, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.evaluatedRuleIds.length, DEFAULT_POLICY_RULES.length);
});

test("requires rollback guidance for each migration", () => {
  const unsafe = analyzePolicies({ diff: diff("db/migrations/001_drop_users.sql", ["DROP TABLE users;"]) });
  assert.equal(unsafe.passed, false);
  assert.equal(unsafe.findings[0].ruleId, "DB-001");
  assert.equal(unsafe.findings[0].evidence[0].file, "db/migrations/001_drop_users.sql");
  assert.equal(unsafe.findings[0].evidence[0].targetLine, 1);

  const documented = analyzePolicies({ diff: diff("db/migrations/002_add_index.sql", ["CREATE INDEX users_email ON users(email);", "-- Rollback: DROP INDEX users_email;"]) });
  assert.equal(documented.findings.some((finding) => finding.ruleId === "DB-001"), false);
});

test("accepts infrastructure ownership from metadata or the diff", () => {
  const change = diff("infra/worker.tf", ["resource \"cloudflare_workers_script\" \"api\" {}"]);
  assert.equal(analyzePolicies({ diff: change }).findings.some((finding) => finding.ruleId === "INFRA-001"), true);
  assert.equal(analyzePolicies({ diff: change, context: { owner: "platform-team" } }).findings.some((finding) => finding.ruleId === "INFRA-001"), false);
  assert.equal(analyzePolicies({ diff: diff("wrangler.toml", ["# owner: edge-platform", "name = \"review-agent\""]) }).findings.some((finding) => finding.ruleId === "INFRA-001"), false);
});

test("authentication code needs an explicit security review", () => {
  const authDiff = diff("src/auth/session.ts", ["export function validateJwt(token: string) {", "  return token.length > 0;", "}"]);
  const blocked = analyzePolicies({ diff: authDiff });
  assert.equal(blocked.findings.some((finding) => finding.ruleId === "AUTH-001"), true);

  const approved = analyzePolicies({ diff: authDiff, context: { securityReviewApproved: true, securityReviewReference: "SEC-42" } });
  assert.equal(approved.findings.some((finding) => finding.ruleId === "AUTH-001"), false);
});

test("extracts CI failure evidence but ignores a zero-failure summary", () => {
  const result = analyzePolicies({ diff: "", ciLog: "build passed\nFAIL test/login.test.ts\nError: expected 200\n0 failures in lint" });
  const ci = result.findings.find((finding) => finding.ruleId === "CI-001");
  assert.ok(ci);
  assert.equal(ci.evidence.length, 2);
  assert.deepEqual(ci.evidence.map((item) => item.line), [2, 3]);
});

test("detects literal secrets only on added lines and ignores managed references", () => {
  const combined = [
    diff("src/config.ts", [
      "const key = process.env.API_KEY;",
      "const password = \"replace-me-placeholder\";",
      "const apiKey = \"sk_live_1234567890abcdef\";",
    ]),
    diff("src/old.ts", ["export const safe = true;"]).replace("+export const safe = true;", "-const secret = \"previously_committed_value\";\n+export const safe = true;"),
  ].join("\n");
  const result = analyzePolicies({ diff: combined });
  const secret = result.findings.find((finding) => finding.ruleId === "SEC-001");
  assert.ok(secret);
  assert.equal(secret.evidence.length, 1);
  assert.match(secret.evidence[0].excerpt, /sk_live/);
  assert.equal(result.summary.critical, 1);
});

test("disabled rules are not evaluated", () => {
  const rules = DEFAULT_POLICY_RULES.map((rule) => rule.id === "CI-001" ? { ...rule, enabled: false } : rule);
  const result = analyzePolicies({ diff: "", ciLog: "ERROR: build failed" }, rules);
  assert.equal(result.passed, true);
  assert.equal(result.evaluatedRuleIds.includes("CI-001"), false);
});
