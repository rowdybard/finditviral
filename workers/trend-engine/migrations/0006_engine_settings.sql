CREATE TABLE engine_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  max_output_tokens INTEGER NOT NULL DEFAULT 3000,
  max_candidates_per_lane INTEGER NOT NULL DEFAULT 2,
  search_context_size TEXT NOT NULL DEFAULT 'low' CHECK (search_context_size IN ('low', 'medium', 'high')),
  reasoning_effort TEXT NOT NULL DEFAULT 'medium' CHECK (reasoning_effort IN ('low', 'medium', 'high')),
  updated_at TEXT NOT NULL
);

INSERT INTO engine_settings (id, updated_at) VALUES (1, '1970-01-01T00:00:00.000Z');
