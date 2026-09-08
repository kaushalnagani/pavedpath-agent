import { FormEvent, useMemo, useState } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowRight,
  Check,
  CircleNotch,
  Code,
  PaperPlaneTilt,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { PavedPathAgent } from "./server";
import type { Finding, PavedPathState } from "./types";

const SAMPLE_DIFF = `diff --git a/migrations/0042_users.sql b/migrations/0042_users.sql
new file mode 100644
--- /dev/null
+++ b/migrations/0042_users.sql
@@ -0,0 +1,3 @@
+DROP TABLE legacy_users;
+ALTER TABLE accounts ADD COLUMN owner_id TEXT;
+-- deploy immediately`;

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <article className="finding-row">
      <div className={`severity severity-${finding.severity}`}>{finding.severity}</div>
      <div>
        <div className="finding-heading">
          <strong>{finding.title}</strong>
          <code>{finding.ruleId}</code>
        </div>
        <p>{finding.evidence}</p>
        <span>{finding.recommendation}</span>
      </div>
    </article>
  );
}

function ChatMessage({
  message,
  approve,
}: {
  message: UIMessage;
  approve: (response: { id: string; approved: boolean }) => void;
}) {
  return (
    <div className={`message message-${message.role}`}>
      {message.parts.map((part, index) => {
        if (part.type === "text") return <p key={index}>{part.text}</p>;
        if (!isToolUIPart(part)) return null;
        const name = getToolName(part);
        if ("approval" in part && part.state === "approval-requested") {
          const id = (part.approval as { id?: string }).id;
          return (
            <div className="approval" key={index}>
              <strong>Approval required</strong>
              <span>{name} will change durable memory.</span>
              <div>
                <button onClick={() => id && approve({ id, approved: true })}><Check />Approve</button>
                <button className="quiet" onClick={() => id && approve({ id, approved: false })}><X />Reject</button>
              </div>
            </div>
          );
        }
        return (
          <div className="tool-trace" key={index}>
            <Code /> {name} · {part.state.replaceAll("-", " ")}
          </div>
        );
      })}
    </div>
  );
}

export function App() {
  const [state, setState] = useState<PavedPathState>({
    currentReview: null,
    history: [],
    approvedExceptions: [],
  });
  const [title, setTitle] = useState("Remove legacy users table");
  const [diff, setDiff] = useState(SAMPLE_DIFF);
  const [ciLog, setCiLog] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [starting, setStarting] = useState(false);
  const [formError, setFormError] = useState("");

  const agent = useAgent<PavedPathAgent, PavedPathState>({
    agent: "PavedPathAgent",
    name: "review-demo",
    onStateUpdate: (next) => setState(next),
  });
  const { messages, sendMessage, addToolApprovalResponse, status } = useAgentChat({ agent });

  const current = state.currentReview;
  const findings = current?.result?.findings ?? [];
  const counts = useMemo(
    () => ({
      blocking: findings.filter((item) => item.severity === "critical" || item.severity === "high").length,
      advisory: findings.filter((item) => item.severity === "medium" || item.severity === "low").length,
    }),
    [findings],
  );

  async function runReview(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    setStarting(true);
    try {
      await agent.stub.startReview({ title, diff, ciLog });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not start the review.");
    } finally {
      setStarting(false);
    }
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    sendMessage({ role: "user", parts: [{ type: "text", text }] });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark"><span /><span /><span /></div>
        <div className="brand-copy"><strong>PavedPath</strong><small>Engineering review agent</small></div>
        <div className="connection"><i /> Durable session</div>
        <div className="model-label">Llama 3.3 · Workers AI</div>
      </header>

      <section className="workspace">
        <aside className="intake-panel">
          <div className="panel-title">
            <span>Change input</span>
            <ShieldCheck size={19} />
          </div>
          <form onSubmit={runReview}>
            <label>Change title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Pull-request diff<textarea className="diff-input" value={diff} onChange={(e) => setDiff(e.target.value)} spellCheck={false} /></label>
            <label>CI output <em>optional</em><textarea value={ciLog} onChange={(e) => setCiLog(e.target.value)} placeholder="Paste the failing section of a CI log…" /></label>
            {formError && <div className="form-error"><Warning />{formError}</div>}
            <button className="primary-action" disabled={starting || !diff.trim()}>
              {starting ? <CircleNotch className="spin" /> : <ArrowRight />}
              {starting ? "Starting durable review" : "Run policy review"}
            </button>
          </form>
          <p className="input-note">Input stays inside this durable agent session. The demo does not write to a repository.</p>
        </aside>

        <section className="review-panel">
          <div className="review-header">
            <div><span>Review evidence</span><h1>{current?.title ?? "Awaiting a change"}</h1></div>
            <div className={`verdict verdict-${current?.result?.verdict ?? "pending"}`}>
              {current?.result?.verdict?.replaceAll("-", " ") ?? "not reviewed"}
            </div>
          </div>

          <div className="execution-trace">
            <div className="trace-copy">
              <span>{current?.phase ?? "Ready for a pull-request diff"}</span>
              <strong>{Math.round((current?.progress ?? 0) * 100)}%</strong>
            </div>
            <div className="track"><div style={{ width: `${(current?.progress ?? 0) * 100}%` }} /></div>
            <div className="trace-steps"><span className={current ? "active" : ""}>Normalize</span><span className={current?.progress && current.progress >= .2 ? "active" : ""}>Policy scan</span><span className={current?.progress && current.progress >= .6 ? "active" : ""}>AI reasoning</span><span className={current?.status === "complete" ? "active" : ""}>Persist</span></div>
          </div>

          {current?.status === "error" ? (
            <div className="empty-evidence"><Warning size={28} /><h2>Review stopped</h2><p>{current.error}</p></div>
          ) : current?.status !== "complete" ? (
            <div className="empty-evidence"><Code size={28} /><h2>Evidence appears here</h2><p>Start the sample review to see deterministic rules and AI remediation work together.</p></div>
          ) : (
            <div className="results">
              <div className="summary-line"><p>{current.result?.summary}</p><div><span>{counts.blocking}<small>blocking</small></span><span>{counts.advisory}<small>advisory</small></span></div></div>
              <div className="findings">{findings.length ? findings.map((finding) => <FindingRow key={finding.ruleId} finding={finding} />) : <div className="clear-state"><ShieldCheck />No policy violations detected.</div>}</div>
            </div>
          )}
        </section>

        <aside className="chat-panel">
          <div className="panel-title"><span>Reviewer chat</span><div className="live-dot">live</div></div>
          <div className="messages">
            {messages.length === 0 && <div className="chat-empty"><ShieldCheck /><strong>Ask about the evidence</strong><p>I remember review history and require approval before recording exceptions.</p><button onClick={() => sendMessage({ role: "user", parts: [{ type: "text", text: "Explain the safest remediation for the current review." }] })}>Explain this review</button></div>}
            {messages.map((message) => <ChatMessage key={message.id} message={message} approve={addToolApprovalResponse} />)}
          </div>
          <form className="chat-form" onSubmit={sendChat}>
            <textarea value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Ask about a finding or request an exception…" />
            <button aria-label="Send message" disabled={!chatInput.trim() || status === "streaming"}><PaperPlaneTilt /></button>
          </form>
        </aside>
      </section>
    </main>
  );
}
