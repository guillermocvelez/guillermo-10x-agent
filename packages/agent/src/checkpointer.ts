import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

let checkpointerPromise: Promise<BaseCheckpointSaver> | null = null;

/**
 * LangGraph checkpointer: Postgres (Supabase/direct URL) when `LANGGRAPH_POSTGRES_URL`
 * or `DATABASE_URL` is set, otherwise in-memory. Call once per process; Postgres runs `setup()`.
 */
export function getGraphCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      const conn =
        process.env.LANGGRAPH_POSTGRES_URL?.trim() ||
        process.env.DATABASE_URL?.trim() ||
        process.env.SUPABASE_DB_URL?.trim() ||
        "";
      if (!conn) {
        return new MemorySaver();
      }
      const { PostgresSaver } = await import(
        "@langchain/langgraph-checkpoint-postgres"
      );
      const saver = PostgresSaver.fromConnString(conn);
      await saver.setup();
      return saver;
    })();
  }
  return checkpointerPromise;
}
