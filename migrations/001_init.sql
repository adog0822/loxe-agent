-- Loxe schema — append-only ledger with immutability trigger

create table if not exists agents (
  id text primary key,
  name text not null,
  url text not null,
  headers text, -- JSON string of auth headers (encrypted at rest via Supabase)
  owner_id text not null default 'default',
  current_grade text,
  last_run_id text,
  last_run_at timestamptz,
  sentinel_enabled boolean not null default false,
  sentinel_interval_hours int not null default 24,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists runs (
  id text primary key,
  agent_id text not null references agents(id) on delete cascade,
  status text not null default 'queued',
  grade text,
  report text, -- JSON report card
  library_hash text,
  library_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists runs_agent_idx on runs(agent_id, started_at desc);

create table if not exists ledger (
  id text not null unique,
  agent_id text not null references agents(id) on delete cascade,
  seq int not null,
  prev_hash text not null,
  payload_hash text not null,
  entry_hash text not null unique,
  payload text not null, -- JSON evidence object
  created_at timestamptz not null default now(),
  primary key (agent_id, seq)
);
create index if not exists ledger_run_idx on ledger((payload::jsonb->>'runId'));

create table if not exists vendor_requests (
  id text primary key,
  run_id text not null,
  probe_id text not null,
  request_kind text not null,
  response_body text,
  status_code int,
  latency_ms int,
  created_at timestamptz not null default now()
);
create index if not exists vr_run_idx on vendor_requests(run_id);

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Append-only enforcement: block UPDATE and DELETE on ledger
create or replace function ledger_immutable() returns trigger language plpgsql as $$
begin raise exception 'ledger is append-only'; end $$;
drop trigger if exists ledger_no_update on ledger;
create trigger ledger_no_update before update or delete on ledger
  for each row execute function ledger_immutable();

-- RLS (policies will be added when auth is wired up)
alter table agents enable row level security;
alter table runs enable row level security;
alter table ledger enable row level security;
alter table vendor_requests enable row level security;
alter table settings enable row level security;

-- Allow service role full access (for the app server)
create policy "service_all" on agents for all using (true) with check (true);
create policy "service_all" on runs for all using (true) with check (true);
create policy "service_all_select" on ledger for select using (true);
create policy "service_all_insert" on ledger for insert with check (true);
create policy "service_all" on vendor_requests for all using (true) with check (true);
create policy "service_all" on settings for all using (true) with check (true);
