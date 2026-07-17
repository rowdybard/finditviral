-- Stores a bounded, secret-free audit trail for each OpenAI research run.
ALTER TABLE research_runs ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '{}';
