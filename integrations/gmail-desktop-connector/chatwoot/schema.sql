-- Additive tables owned exclusively by the desktop Gmail connector.
CREATE TABLE IF NOT EXISTS doon_gmail_links (
 id bigint PRIMARY KEY, account_id bigint NOT NULL, user_id bigint NOT NULL,
 inbox_id bigint UNIQUE NOT NULL, email text NOT NULL, heartbeat_at timestamptz,
 synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS doon_gmail_threads (
 id bigserial PRIMARY KEY, link_id bigint NOT NULL, gmail_id text NOT NULL,
 conversation_id bigint UNIQUE NOT NULL, UNIQUE(link_id,gmail_id)
);
CREATE TABLE IF NOT EXISTS doon_gmail_messages (
 id bigserial PRIMARY KEY, link_id bigint NOT NULL, gmail_id text NOT NULL,
 gmail_thread_id text NOT NULL, message_id bigint UNIQUE NOT NULL,
 conversation_id bigint NOT NULL, labels jsonb NOT NULL DEFAULT '[]',
 missing boolean NOT NULL DEFAULT false, UNIQUE(link_id,gmail_id)
);
CREATE TABLE IF NOT EXISTS doon_gmail_jobs (
 id uuid PRIMARY KEY, link_id bigint NOT NULL, kind text NOT NULL,
 message_id bigint UNIQUE, conversation_id bigint NOT NULL,
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'queued',
 lease uuid, lease_until timestamptz, reason text, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doon_gmail_jobs_state_idx ON doon_gmail_jobs(link_id,state,created_at);
CREATE INDEX IF NOT EXISTS doon_gmail_messages_conv_idx ON doon_gmail_messages(link_id,conversation_id);
