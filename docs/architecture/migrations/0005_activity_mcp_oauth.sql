-- PAU-44: authorization-code replay protection for ChatGPT Activity MCP OAuth.
-- The token endpoint inserts the signed code JTI atomically; a duplicate is rejected.

create table if not exists oauth_authorization_code_uses (
  jti text primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

create index if not exists oauth_authorization_code_uses_expiry_idx
  on oauth_authorization_code_uses (expires_at);
