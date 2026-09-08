-- studypro.html cloud sync schema
create table if not exists public.study_progress (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create or replace function public.set_study_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists trg_study_progress_updated_at on public.study_progress;
create trigger trg_study_progress_updated_at
before update on public.study_progress
for each row
execute function public.set_study_progress_updated_at();

alter table public.study_progress enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_progress'
      and policyname = 'study_progress_select_all'
  ) then
    create policy study_progress_select_all
      on public.study_progress
      for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_progress'
      and policyname = 'study_progress_insert_all'
  ) then
    create policy study_progress_insert_all
      on public.study_progress
      for insert
      to anon, authenticated
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_progress'
      and policyname = 'study_progress_update_all'
  ) then
    create policy study_progress_update_all
      on public.study_progress
      for update
      to anon, authenticated
      using (true)
      with check (true);
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.study_progress to anon, authenticated;
