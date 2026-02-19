CREATE TABLE IF NOT EXISTS boards (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  columns TEXT NOT NULL DEFAULT '[]',   -- JSON
  labels TEXT NOT NULL DEFAULT '[]',    -- JSON
  open INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_did_rkey ON boards(did, rkey);

CREATE TABLE IF NOT EXISTS tasks (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  columnId TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  position TEXT,
  labelIds TEXT,                         -- JSON
  "order" INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_did_rkey ON tasks(did, rkey);
CREATE INDEX IF NOT EXISTS idx_tasks_boardUri ON tasks(boardUri);

CREATE TABLE IF NOT EXISTS ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetTaskUri TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',    -- JSON
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_did_rkey ON ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_ops_boardUri ON ops(boardUri);
CREATE INDEX IF NOT EXISTS idx_ops_targetTaskUri ON ops(targetTaskUri);

CREATE TABLE IF NOT EXISTS trusts (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  trustedDid TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trusts_did_rkey ON trusts(did, rkey);
CREATE INDEX IF NOT EXISTS idx_trusts_boardUri ON trusts(boardUri);

CREATE TABLE IF NOT EXISTS comments (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetTaskUri TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_did_rkey ON comments(did, rkey);
CREATE INDEX IF NOT EXISTS idx_comments_boardUri ON comments(boardUri);
CREATE INDEX IF NOT EXISTS idx_comments_targetTaskUri ON comments(targetTaskUri);

CREATE TABLE IF NOT EXISTS approvals (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetUri TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_did_rkey ON approvals(did, rkey);
CREATE INDEX IF NOT EXISTS idx_approvals_boardUri ON approvals(boardUri);

CREATE TABLE IF NOT EXISTS reactions (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetTaskUri TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  emoji TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_did_rkey ON reactions(did, rkey);
CREATE INDEX IF NOT EXISTS idx_reactions_boardUri ON reactions(boardUri);

CREATE TABLE IF NOT EXISTS board_participants (
  did TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  discoveredAt TEXT NOT NULL,
  lastFetchedAt TEXT,
  PRIMARY KEY (did, boardUri)
);

CREATE TABLE IF NOT EXISTS jetstream_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor INTEGER NOT NULL
);
