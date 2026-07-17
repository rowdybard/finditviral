CREATE TABLE candidate_research_explanations (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  explanation_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
