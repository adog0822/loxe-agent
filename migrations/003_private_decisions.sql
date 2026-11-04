-- Decision details stay private to the org. The public ledger entry binds them by hash only
-- (noteHash, opaque user id), so a decision is still verifiable without exposing who wrote what.
create table if not exists decisions (
  id text primary key,
  org_id text not null,
  agent_id text not null,
  run_id text not null,
  probe_id text not null,
  state text not null,
  note text not null default '',
  by_user text not null,
  by_label text not null,
  ledger_seq int not null,
  entry_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists decisions_run_idx on decisions(run_id);
