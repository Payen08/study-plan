-- AI study buddy setup for studyplan-github.html
--
-- Important:
-- 1. Do NOT put your DeepSeek sk key in SQL tables.
-- 2. Put it in Supabase Dashboard -> Edge Functions -> Secrets:
--      DEEPSEEK_API_KEY = sk-...
--      DEEPSEEK_BASE_URL = https://api.deepseek.com
--      DEEPSEEK_MODEL_FLASH = deepseek-v4-flash
--      DEEPSEEK_MODEL_PRO = deepseek-v4-pro
--      SERVERCHAN_SENDKEY = SCT...                 -- Server 酱 SendKey
--      STUDY_PUSH_SYNC_ID = default                -- 你的同步 ID；如果页面里改过 ID，就填那个 ID
--      STUDY_PUSH_TIMEZONE = Asia/Shanghai
--      MAIMEMO_API_TOKEN = ...                     -- 墨墨开放 API 用户 Token
--      MAIMEMO_ALLOWED_ORIGINS = https://payen08.github.io  -- 可选，逗号分隔
-- 3. This SQL only ensures the existing app state table can store AI
--    profile, messages, generated reminders, and normal calendar data.
-- 4. Deploy the Edge Functions after editing:
--      supabase functions deploy study-buddy
--      supabase functions deploy study-push
--      supabase functions deploy maimemo-proxy
-- 5. Optional scheduled WeChat push:
--    Replace <PROJECT_REF> and <ANON_KEY>, then run the block at the bottom.

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


-- Optional: schedule the Server 酱 daily push from Supabase.
-- Supabase SQL editor can run this after pg_cron/pg_net are enabled for the project.
-- 08:00 Asia/Shanghai equals 00:00 UTC. Adjust the cron expression if you choose another time.
--
-- create extension if not exists pg_cron with schema extensions;
-- create extension if not exists pg_net with schema extensions;
--
-- select cron.unschedule('daily-study-serverchan-push')
-- where exists (
--   select 1 from cron.job where jobname = 'daily-study-serverchan-push'
-- );
--
-- select cron.schedule(
--   'daily-study-serverchan-push',
--   '0 0 * * *',
--   $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/study-push',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'apikey', '<ANON_KEY>',
--       'Authorization', 'Bearer <ANON_KEY>'
--     ),
--     body := jsonb_build_object(
--       'mode', 'daily',
--       'syncId', 'default'
--     )
--   ) as request_id;
--   $$
-- );
