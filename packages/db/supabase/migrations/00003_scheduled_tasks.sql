-- Allow dedicated sessions for proactive / cron-driven runs
alter table public.agent_sessions
  drop constraint if exists agent_sessions_channel_check;

alter table public.agent_sessions
  add constraint agent_sessions_channel_check
  check (channel in ('web', 'telegram', 'scheduled'));

-- ============================================================
-- scheduled_tasks (proactive agent jobs; HITL on creation via tool_calls)
-- ============================================================
create table public.scheduled_tasks (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  title                text not null,
  task_prompt          text not null,
  cron_expression      text not null,
  timezone             text not null default 'UTC',
  pre_notify_minutes   integer not null default 5
    check (pre_notify_minutes >= 1 and pre_notify_minutes <= 120),
  status               text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  next_run_at          timestamptz not null,
  next_pre_notify_at   timestamptz not null,
  pre_notify_sent      boolean not null default false,
  last_run_at          timestamptz,
  last_pre_notify_at   timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index scheduled_tasks_main_due_idx
  on public.scheduled_tasks (status, next_run_at)
  where status = 'active';

create index scheduled_tasks_pre_due_idx
  on public.scheduled_tasks (status, next_pre_notify_at, pre_notify_sent, next_run_at)
  where status = 'active';

alter table public.scheduled_tasks enable row level security;

create policy "Users manage own scheduled tasks"
  on public.scheduled_tasks for all
  using (auth.uid() = user_id);
