CREATE TABLE IF NOT EXISTS monitor_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO monitor_state (id, payload) VALUES (1, '{}');
