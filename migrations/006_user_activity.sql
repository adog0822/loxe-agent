-- When each user was last active, for the owner stats page (/admin). Updated on every signed-in
-- request; existing users start from their sign-up time.
alter table users add column if not exists last_seen_at timestamptz;
update users set last_seen_at = created_at where last_seen_at is null;
create index if not exists users_created_at_idx on users (created_at);
create index if not exists users_last_seen_at_idx on users (last_seen_at);
