-- Orgs, users, API keys; org scoping; async run progress; ledger kinds + run index.

create table if not exists orgs (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,            -- clerk user id, or dev-<sha> in dev auth
  email text not null,
  name text,
  org_id text not null references orgs(id),
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  key_hash text not null unique,  -- sha256 of the full key; the key itself is shown once
  prefix text not null,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

insert into orgs (id, name) values ('default', 'Default org') on conflict (id) do nothing;

alter table agents add column if not exists org_id text not null default 'default';
alter table agents add column if not exists source text not null default 'url';
alter table agents add column if not exists maritime_agent_id text;
alter table agents add column if not exists archived_at timestamptz;
alter table agents add column if not exists sentinel_next_run_at timestamptz;
create index if not exists agents_org_idx on agents(org_id);

alter table runs add column if not exists org_id text not null default 'default';
alter table runs add column if not exists progress text;   -- JSON {done,total,current}
alter table runs add column if not exists error text;
alter table runs add column if not exists trigger text not null default 'manual';
alter table runs add column if not exists signature text; -- JSON signed ledger head

-- 'evidence' rows come from the verifier; 'decision' rows record who accepted/fixed a finding.
alter table ledger add column if not exists kind text not null default 'evidence';
alter table ledger add column if not exists run_id text;
create index if not exists ledger_run_id_idx on ledger(run_id);
create index if not exists ledger_payload_hash_idx on ledger(payload_hash);

alter table vendor_requests add column if not exists request_body text;
