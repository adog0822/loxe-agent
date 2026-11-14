-- How Loxe sends chat messages to an agent: 'messages' (OpenAI shape, the default) or
-- 'ui-messages' (Vercel AI SDK v5 useChat routes). Set by the endpoint check when an agent is added.
alter table agents add column if not exists wire_format text not null default 'messages';
