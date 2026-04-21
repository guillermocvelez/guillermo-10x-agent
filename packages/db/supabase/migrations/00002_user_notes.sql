-- Private notes per user (confirmed via deferred tool flow)
create table public.user_notes (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null default '',
  content    text not null,
  created_at timestamptz not null default now()
);

create index user_notes_user_id_created_at_idx
  on public.user_notes (user_id, created_at desc);

alter table public.user_notes enable row level security;

create policy "Users can view own notes"
  on public.user_notes for select
  using (auth.uid() = user_id);

create policy "Users can insert own notes"
  on public.user_notes for insert
  with check (auth.uid() = user_id);

create policy "Users can update own notes"
  on public.user_notes for update
  using (auth.uid() = user_id);

create policy "Users can delete own notes"
  on public.user_notes for delete
  using (auth.uid() = user_id);
