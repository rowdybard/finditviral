-- 1. Create new table with extended statuses
CREATE TABLE research_runs_new (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused_rate_limit', 'finalizing', 'succeeded', 'failed')),
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
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT
);

-- 2. Copy all existing rows
INSERT INTO research_runs_new (id, request_key, trigger_type, status, model, prompt_version,
  created_at, started_at, completed_at, lease_until, received_count, accepted_count,
  duplicate_count, rejected_count, candidate_ids_json, evidence_json, error_code)
SELECT id, request_key, trigger_type, status, model, prompt_version,
  created_at, started_at, completed_at, lease_until, received_count, accepted_count,
  duplicate_count, rejected_count, candidate_ids_json, evidence_json, error_code
FROM research_runs;

-- 3. Drop old index and table
DROP INDEX IF EXISTS idx_research_runs_one_active;
DROP INDEX IF EXISTS idx_research_runs_created;
DROP TABLE research_runs;

-- 4. Rename
ALTER TABLE research_runs_new RENAME TO research_runs;

-- 5. Recreate indexes
CREATE INDEX idx_research_runs_created ON research_runs (created_at DESC);
CREATE UNIQUE INDEX idx_research_runs_one_active
  ON research_runs (
    CASE WHEN status IN ('queued', 'running', 'paused_rate_limit', 'finalizing')
      THEN 1 ELSE NULL END
  );

-- 6. Lane checkpoints table
CREATE TABLE research_lane_checkpoints (
  run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  lane TEXT NOT NULL CHECK (lane IN ('social', 'search_demand', 'commerce', 'trend_media')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'retry_wait', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until TEXT,
  next_retry_at TEXT,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  usage_json TEXT NOT NULL DEFAULT '{}',
  rate_limit_diagnostics_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, lane)
);

CREATE INDEX idx_research_lane_checkpoints_retry
  ON research_lane_checkpoints (next_retry_at, status)
  WHERE status IN ('pending', 'retry_wait') AND next_retry_at IS NOT NULL;
