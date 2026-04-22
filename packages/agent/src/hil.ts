import { Command } from "@langchain/langgraph";

/**
 * Build a LangGraph {@link https://docs.langchain.com/oss/javascript/langgraph/human-in-the-loop | Command}
 * to resume after `interrupt()`. This app’s medium/high-risk tools use DB-backed `pending_confirmation`
 * and deferred execution in the web layer (`approvePendingToolCall`); use `commandResume` when you add
 * a native `interrupt()` path that must continue the same compiled graph thread.
 */
export function commandResume(resume: unknown): Command {
  return new Command({ resume });
}
