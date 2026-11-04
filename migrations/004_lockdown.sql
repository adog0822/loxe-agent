-- Lockdown: only the Loxe server (table owner) reads or writes. On Supabase, the anon and
-- authenticated roles get nothing, and every table has RLS on with no policies (deny by default).
-- New agents are private until the owner turns their public link on.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
  end if;
end $$;

drop policy if exists "service_all" on agents;
drop policy if exists "service_all" on runs;
drop policy if exists "service_all_select" on ledger;
drop policy if exists "service_all_insert" on ledger;
drop policy if exists "service_all" on vendor_requests;
drop policy if exists "service_all" on settings;

alter table agents alter column is_public set default false;
