import type { DbClient } from "@agents/db";
import {
  insertScheduledTask,
  getScheduledTaskByIdForUser,
  updateScheduledTaskStatusForUser,
} from "@agents/db";
import { getNextRunPair, validateCronExpression } from "./scheduled-cron";

export async function executeConfirmedScheduleCronTask(
  db: DbClient,
  userId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const task_prompt =
    typeof args.task_prompt === "string" ? args.task_prompt.trim() : "";
  const cron_expression =
    typeof args.cron_expression === "string" ? args.cron_expression.trim() : "";
  const timezone =
    typeof args.timezone === "string" && args.timezone.trim()
      ? args.timezone.trim()
      : "UTC";
  let preNotifyMinutes = 5;
  if (
    typeof args.pre_notify_minutes === "number" &&
    Number.isFinite(args.pre_notify_minutes)
  ) {
    preNotifyMinutes = Math.min(
      120,
      Math.max(1, Math.floor(args.pre_notify_minutes))
    );
  }

  if (!title || !task_prompt || !cron_expression) {
    return {
      error: "invalid_args",
      message: "Faltan title, task_prompt o cron_expression.",
    };
  }

  const v = validateCronExpression(cron_expression, timezone);
  if (!v.ok) {
    return { error: "invalid_cron", message: v.message };
  }

  const { next_run_at, next_pre_notify_at } = getNextRunPair(
    cron_expression,
    timezone,
    preNotifyMinutes,
    new Date()
  );

  const row = await insertScheduledTask(db, {
    user_id: userId,
    title,
    task_prompt,
    cron_expression,
    timezone,
    pre_notify_minutes: preNotifyMinutes,
    next_run_at,
    next_pre_notify_at,
  });

  return {
    message: "Tarea programada activa.",
    scheduled_task_id: row.id,
    title: row.title,
    next_run_at: row.next_run_at,
    next_pre_notify_at: row.next_pre_notify_at,
    cron_expression: row.cron_expression,
    pre_notify_minutes: row.pre_notify_minutes,
    timezone: row.timezone,
  };
}

const STATUS_VALUES = new Set(["active", "paused", "cancelled"]);

export async function executeConfirmedSetScheduledTaskStatus(
  db: DbClient,
  userId: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const scheduled_task_id =
    typeof args.scheduled_task_id === "string" ? args.scheduled_task_id.trim() : "";
  const statusRaw = typeof args.status === "string" ? args.status.trim().toLowerCase() : "";
  if (!scheduled_task_id || !STATUS_VALUES.has(statusRaw)) {
    return {
      error: "invalid_args",
      message: "Indica `scheduled_task_id` (UUID) y `status`: active | paused | cancelled.",
    };
  }
  const status = statusRaw as "active" | "paused" | "cancelled";

  const row = await getScheduledTaskByIdForUser(db, scheduled_task_id, userId);
  if (!row) {
    return { error: "not_found", message: "No hay ninguna tarea programada con ese id para tu usuario." };
  }

  if (row.status === status) {
    return {
      message: "La tarea ya estaba en ese estado.",
      scheduled_task_id: row.id,
      status: row.status,
      title: row.title,
    };
  }

  if (status === "active") {
    const { next_run_at, next_pre_notify_at } = getNextRunPair(
      row.cron_expression,
      row.timezone,
      row.pre_notify_minutes,
      new Date()
    );
    const updated = await updateScheduledTaskStatusForUser(db, scheduled_task_id, userId, {
      status: "active",
      next_run_at: next_run_at.toISOString(),
      next_pre_notify_at: next_pre_notify_at.toISOString(),
      pre_notify_sent: false,
    });
    return {
      message: "Tarea reactivada; próximas fechas recalculadas a partir de ahora.",
      scheduled_task_id: updated.id,
      status: updated.status,
      title: updated.title,
      next_run_at: updated.next_run_at,
      next_pre_notify_at: updated.next_pre_notify_at,
    };
  }

  const updated = await updateScheduledTaskStatusForUser(db, scheduled_task_id, userId, {
    status,
  });
  return {
    message:
      status === "paused"
        ? "Tarea pausada (no se ejecutará hasta que la reactives)."
        : "Tarea cancelada (no volverá a ejecutarse salvo que la reactives a activa).",
    scheduled_task_id: updated.id,
    status: updated.status,
    title: updated.title,
  };
}
