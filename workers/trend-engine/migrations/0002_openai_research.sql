INSERT OR IGNORE INTO sources (
  id, name, kind, endpoint_url, independence_key, catalog_host_allowlist_json,
  trust_weight, poll_interval_minutes, enabled, next_poll_at, created_at, updated_at
) VALUES (
  'openai-research', 'OpenAI research', 'push', NULL, 'openai-research', '[]',
  0.35, 240, 1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  lease_until TEXT,
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT
);

CREATE INDEX idx_research_runs_created ON research_runs (created_at DESC);
CREATE UNIQUE INDEX idx_research_runs_one_active
  ON research_runs ((CASE WHEN status IN ('queued', 'running') THEN 1 ELSE NULL END));
