create table if not exists public.study_ai_credentials (
  sync_id text primary key,
  encrypted_key text not null,
  encryption_iv text not null,
  access_token_hashes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint study_ai_credentials_sync_id_length check (char_length(sync_id) between 1 and 120),
  constraint study_ai_credentials_token_hashes_array check (jsonb_typeof(access_token_hashes) = 'array')
);

alter table public.study_ai_credentials enable row level security;

revoke all on table public.study_ai_credentials from anon, authenticated;

comment on table public.study_ai_credentials is
  'Server-only encrypted AI provider keys. Never expose this table through client policies.';
