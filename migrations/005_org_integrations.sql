-- Integrations a team connects itself (Slack today). Secrets (the webhook URL) are sealed with
-- AES-256-GCM like agent auth headers; settings and last delivery status are plain.
create table if not exists org_integrations (
  org_id text not null,
  kind text not null,
  config text not null,
  settings jsonb not null default '{}'::jsonb,
  last_status text,
  last_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, kind)
);
alter table org_integrations enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on org_integrations from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on org_integrations from authenticated'; end if;
end $$;
