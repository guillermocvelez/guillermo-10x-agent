import type { DbClient } from "../client";
import type { ScheduledTask } from "@agents/types";
import { supabaseErrorMessage } from "../errors";

export type InsertScheduledTaskInput = {
  user_id: string;
  title: string;
  task_prompt: string;
  cron_expression: string;
  timezone: string;
  pre_notify_minutes: number;
  next_run_at: Date;
  next_pre_notify_at: Date;
};

export async function insertScheduledTask(
  db: DbClient,
  input: InsertScheduledTaskInput
): Promise<ScheduledTask> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .insert({
      user_id: input.user_id,
      title: input.title,
      task_prompt: input.task_prompt,
      cron_expression: input.cron_expression,
      timezone: input.timezone,
      pre_notify_minutes: input.pre_notify_minutes,
      status: "active",
      next_run_at: input.next_run_at.toISOString(),
      next_pre_notify_at: input.next_pre_notify_at.toISOString(),
      pre_notify_sent: false,
    })
    .select()
    .single();
  if (error) throw new Error(supabaseErrorMessage(error));
  return data as ScheduledTask;
}

export async function listScheduledTasksDueForMainRun(
  db: DbClient,
  nowIso: string
): Promise<ScheduledTask[]> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("status", "active")
    .lte("next_run_at", nowIso);
  if (error) throw new Error(supabaseErrorMessage(error));
  return (data ?? []) as ScheduledTask[];
}

export async function listScheduledTasksDueForPreNotify(
  db: DbClient,
  nowIso: string
): Promise<ScheduledTask[]> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("status", "active")
    .eq("pre_notify_sent", false)
    .lte("next_pre_notify_at", nowIso)
    .gt("next_run_at", nowIso);
  if (error) throw new Error(supabaseErrorMessage(error));
  return (data ?? []) as ScheduledTask[];
}

export async function advanceScheduledTaskAfterMainRun(
  db: DbClient,
  taskId: string,
  nextRunAt: Date,
  nextPreNotifyAt: Date
): Promise<void> {
  const { error } = await db
    .from("scheduled_tasks")
    .update({
      next_run_at: nextRunAt.toISOString(),
      next_pre_notify_at: nextPreNotifyAt.toISOString(),
      pre_notify_sent: false,
      last_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (error) throw new Error(supabaseErrorMessage(error));
}

export async function markScheduledTaskPreNotified(
  db: DbClient,
  taskId: string
): Promise<void> {
  const { error } = await db
    .from("scheduled_tasks")
    .update({
      pre_notify_sent: true,
      last_pre_notify_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  if (error) throw new Error(supabaseErrorMessage(error));
}

export async function listScheduledTasksForUser(
  db: DbClient,
  userId: string
): Promise<ScheduledTask[]> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(supabaseErrorMessage(error));
  return (data ?? []) as ScheduledTask[];
}

export async function getScheduledTaskByIdForUser(
  db: DbClient,
  taskId: string,
  userId: string
): Promise<ScheduledTask | null> {
  const { data, error } = await db
    .from("scheduled_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(supabaseErrorMessage(error));
  return (data as ScheduledTask) ?? null;
}

export type ScheduledTaskStatus = "active" | "paused" | "cancelled";

export async function updateScheduledTaskStatusForUser(
  db: DbClient,
  taskId: string,
  userId: string,
  patch: {
    status: ScheduledTaskStatus;
    next_run_at?: string;
    next_pre_notify_at?: string;
    pre_notify_sent?: boolean;
  }
): Promise<ScheduledTask> {
  const updateRow: Record<string, unknown> = {
    status: patch.status,
    updated_at: new Date().toISOString(),
  };
  if (patch.next_run_at !== undefined) updateRow.next_run_at = patch.next_run_at;
  if (patch.next_pre_notify_at !== undefined) {
    updateRow.next_pre_notify_at = patch.next_pre_notify_at;
  }
  if (patch.pre_notify_sent !== undefined) {
    updateRow.pre_notify_sent = patch.pre_notify_sent;
  }
  const { data, error } = await db
    .from("scheduled_tasks")
    .update(updateRow)
    .eq("id", taskId)
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw new Error(supabaseErrorMessage(error));
  return data as ScheduledTask;
}
