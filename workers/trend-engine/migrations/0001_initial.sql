PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('push', 'json_feed')),
  endpoint_url TEXT,
  independence_key TEXT NOT NULL,
  catalog_host_allowlist_json TEXT NOT NULL DEFAULT '[]',
  trust_weight REAL NOT NULL DEFAULT 0.5 CHECK (trust_weight >= 0 AND trust_weight <= 1),
  poll_interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_minutes BETWEEN 5 AND 10080),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_poll_at TEXT,
  lease_until TEXT,
  last_polled_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'push' AND endpoint_url IS NULL)
    OR (kind = 'json_feed' AND endpoint_url IS NOT NULL AND next_poll_at IS NOT NULL)
  )
);

CREATE INDEX idx_sources_due
  ON sources (enabled, kind, next_poll_at, lease_until);

CREATE TABLE source_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  external_run_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('push', 'scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_code TEXT,
  UNIQUE (source_id, external_run_id)
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug_suggestion TEXT NOT NULL,
  brand TEXT,
  gtin TEXT,
  category TEXT,
  topic_name TEXT NOT NULL,
  topic_slug TEXT NOT NULL,
  topic_description TEXT,
  product_url TEXT,
  product_url_verified INTEGER NOT NULL DEFAULT 0 CHECK (product_url_verified IN (0, 1)),
  image_url TEXT,
  search_terms_json TEXT NOT NULL DEFAULT '[]',
  availability_status TEXT CHECK (
    availability_status IS NULL
    OR availability_status IN ('available', 'backorder', 'preorder', 'announced', 'limited', 'retired')
  ),
  metadata_trust_weight REAL NOT NULL DEFAULT 0 CHECK (metadata_trust_weight >= 0 AND metadata_trust_weight <= 1),
  release_date TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  review_overrides_json TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_candidates_review ON candidates (review_status, last_seen_at DESC);
CREATE INDEX idx_candidates_topic ON candidates (topic_slug, last_seen_at DESC);

CREATE TABLE candidate_aliases (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

CREATE INDEX idx_candidate_aliases_candidate ON candidate_aliases (candidate_id);

CREATE TABLE viral_signals (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  source_run_id TEXT NOT NULL,
  external_observation_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (
    signal_type IN (
      'search_interest',
      'social_velocity',
      'marketplace_rank',
      'editorial_mentions',
      'fiv_demand',
      'manual'
    )
  ),
  signal_value REAL NOT NULL CHECK (signal_value >= 0 AND signal_value <= 100),
  velocity REAL CHECK (velocity IS NULL OR (velocity >= -1 AND velocity <= 1)),
  rank_value INTEGER CHECK (rank_value IS NULL OR rank_value >= 1),
  previous_rank INTEGER CHECK (previous_rank IS NULL OR previous_rank >= 1),
  sample_size INTEGER CHECK (sample_size IS NULL OR sample_size >= 0),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_url TEXT NOT NULL,
  evidence_hash TEXT,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (source_id, external_observation_id)
);

CREATE INDEX idx_viral_signals_candidate_time
  ON viral_signals (candidate_id, observed_at DESC);
CREATE INDEX idx_viral_signals_expiry
  ON viral_signals (expires_at);

CREATE TABLE current_scores (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  previous_score REAL,
  momentum REAL NOT NULL CHECK (momentum >= -1 AND momentum <= 1),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_count INTEGER NOT NULL CHECK (source_count >= 0),
  signal_count INTEGER NOT NULL CHECK (signal_count >= 0),
  state TEXT NOT NULL CHECK (state IN ('candidate', 'emerging', 'trending', 'cooling', 'archived')),
  explanation_json TEXT NOT NULL,
  score_version TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE INDEX idx_current_scores_rank
  ON current_scores (state, score DESC, confidence DESC, candidate_id);

CREATE TABLE score_snapshots (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  previous_score REAL,
  momentum REAL NOT NULL CHECK (momentum >= -1 AND momentum <= 1),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_count INTEGER NOT NULL,
  signal_count INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('candidate', 'emerging', 'trending', 'cooling', 'archived')),
  explanation_json TEXT NOT NULL,
  score_version TEXT NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE INDEX idx_score_snapshots_candidate_time
  ON score_snapshots (candidate_id, computed_at DESC);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  overrides_json TEXT,
  decided_at TEXT NOT NULL
);

CREATE INDEX idx_review_decisions_candidate_time
  ON review_decisions (candidate_id, decided_at DESC);

CREATE TABLE catalog_links (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE RESTRICT,
  fiv_product_id TEXT,
  fiv_product_slug TEXT,
  fiv_trend_id TEXT,
  fiv_trend_slug TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    status = 'inactive'
    OR (
      fiv_product_id IS NOT NULL
      AND fiv_product_slug IS NOT NULL
      AND fiv_trend_id IS NOT NULL
      AND fiv_trend_slug IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_catalog_links_fiv_product_id
  ON catalog_links (fiv_product_id)
  WHERE fiv_product_id IS NOT NULL;

CREATE UNIQUE INDEX idx_catalog_links_fiv_product_slug
  ON catalog_links (fiv_product_slug)
  WHERE fiv_product_slug IS NOT NULL;

CREATE TABLE patches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('shadow', 'review', 'autopilot')),
  status TEXT NOT NULL CHECK (status IN ('building', 'draft', 'ready', 'exported', 'applied', 'failed', 'superseded')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  target TEXT NOT NULL DEFAULT 'finditviral',
  score_version TEXT NOT NULL,
  checksum TEXT,
  manifest_json TEXT,
  operation_count INTEGER NOT NULL DEFAULT 0 CHECK (operation_count >= 0),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  exported_at TEXT,
  applied_at TEXT,
  error_code TEXT,
  delivery_token TEXT,
  lease_until TEXT,
  export_attempts INTEGER NOT NULL DEFAULT 0 CHECK (export_attempts >= 0)
);

CREATE INDEX idx_patches_outbox ON patches (status, created_at);

CREATE TABLE patch_operations (
  id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL REFERENCES patches(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  action TEXT NOT NULL CHECK (action IN ('ensure_trend', 'add_product')),
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  before_json TEXT,
  after_json TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  reversible INTEGER NOT NULL CHECK (reversible IN (0, 1)),
  UNIQUE (patch_id, sequence_number),
  UNIQUE (patch_id, idempotency_key)
);

CREATE INDEX idx_patch_operations_candidate ON patch_operations (candidate_id, action);

CREATE TABLE patch_candidate_claims (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action = 'add_product'),
  patch_id TEXT NOT NULL REFERENCES patches(id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, action)
);

CREATE TABLE cron_runs (
  execution_key TEXT PRIMARY KEY,
  cron_expression TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX idx_cron_runs_claimed ON cron_runs (claimed_at);

CREATE TABLE source_poll_jobs (
  job_key TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  execution_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'pending', 'completed')),
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (source_id, execution_key)
);

CREATE INDEX idx_source_poll_jobs_status_lease
  ON source_poll_jobs (status, lease_until);

CREATE TABLE change_log (
  sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('viral_signal', 'score_snapshot', 'catalog_patch')),
  entity_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_change_log_cursor ON change_log (sequence_number);

CREATE TRIGGER viral_signals_change_log
AFTER INSERT ON viral_signals
BEGIN
  INSERT INTO change_log (event_type, entity_id, occurred_at, payload_json)
  VALUES ('viral_signal', NEW.id, NEW.received_at, NEW.payload_json);
END;

CREATE TRIGGER score_snapshots_change_log
AFTER INSERT ON score_snapshots
BEGIN
  INSERT INTO change_log (event_type, entity_id, occurred_at, payload_json)
  VALUES (
    'score_snapshot',
    NEW.id,
    NEW.computed_at,
    json_object(
      'schema_version', 1,
      'kind', 'score_snapshot',
      'candidate_id', NEW.candidate_id,
      'score', NEW.score,
      'previous_score', NEW.previous_score,
      'momentum', NEW.momentum,
      'confidence', NEW.confidence,
      'source_count', NEW.source_count,
      'signal_count', NEW.signal_count,
      'state', NEW.state,
      'score_version', NEW.score_version,
      'computed_at', NEW.computed_at,
      'explanation', json(NEW.explanation_json)
    )
  );
END;
