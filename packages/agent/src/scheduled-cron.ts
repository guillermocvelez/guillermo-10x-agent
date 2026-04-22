import { CronExpressionParser } from "cron-parser";

/** Convierte cron de 5 campos (min hor dom mes dow) a 6 (seg min …) para cron-parser. */
export function normalizeCronExpression(expr: string): string {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 5) return `0 ${parts.join(" ")}`;
  if (parts.length === 6) return parts.join(" ");
  throw new Error(`Invalid cron: expected 5 or 6 fields, got ${parts.length}`);
}

export function validateCronExpression(
  expr: string,
  timezone: string
): { ok: true } | { ok: false; message: string } {
  try {
    const norm = normalizeCronExpression(expr);
    CronExpressionParser.parse(norm, {
      currentDate: new Date(),
      tz: timezone?.trim() || "UTC",
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Invalid cron expression",
    };
  }
}

export function getNextRunPair(
  cronExpression: string,
  timezone: string,
  preNotifyMinutes: number,
  afterDate: Date
): { next_run_at: Date; next_pre_notify_at: Date } {
  const norm = normalizeCronExpression(cronExpression);
  const cursor = new Date(afterDate.getTime() + 1000);
  const interval = CronExpressionParser.parse(norm, {
    currentDate: cursor,
    tz: timezone?.trim() || "UTC",
  });
  const next_run_at = interval.next().toDate();
  const next_pre_notify_at = new Date(
    next_run_at.getTime() - preNotifyMinutes * 60 * 1000
  );
  return { next_run_at, next_pre_notify_at };
}
