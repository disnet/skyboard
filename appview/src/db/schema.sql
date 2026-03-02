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
  status TEXT,                            -- "open" or "closed"
  open INTEGER NOT NULL DEFAULT 0,        -- permission flag: anyone can edit
  labelIds TEXT,                           -- JSON
  forkedFrom TEXT,                         -- AT URI of original task
  -- Legacy fields (for backward compat with old board-coupled tasks)
  columnId TEXT,
  boardUri TEXT,
  position TEXT,
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
  boardUri TEXT,                          -- Legacy: optional for backward compat
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_did_rkey ON comments(did, rkey);
CREATE INDEX IF NOT EXISTS idx_comments_boardUri ON comments(boardUri);
CREATE INDEX IF NOT EXISTS idx_comments_targetTaskUri ON comments(targetTaskUri);

CREATE TABLE IF NOT EXISTS approvals (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetUri TEXT NOT NULL,
  boardUri TEXT,                          -- Optional: for board-level approvals
  taskUri TEXT,                           -- Optional: for task-level approvals
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_did_rkey ON approvals(did, rkey);
CREATE INDEX IF NOT EXISTS idx_approvals_boardUri ON approvals(boardUri);
CREATE INDEX IF NOT EXISTS idx_approvals_targetUri ON approvals(targetUri);

CREATE TABLE IF NOT EXISTS reactions (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetTaskUri TEXT NOT NULL,
  boardUri TEXT,                          -- Legacy: optional for backward compat
  emoji TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_did_rkey ON reactions(did, rkey);
CREATE INDEX IF NOT EXISTS idx_reactions_boardUri ON reactions(boardUri);

-- New tables for the generalized task tracker model

CREATE TABLE IF NOT EXISTS placements (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  taskUri TEXT NOT NULL,
  boardUri TEXT NOT NULL,
  columnId TEXT NOT NULL,
  position TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_did_rkey ON placements(did, rkey);
CREATE INDEX IF NOT EXISTS idx_placements_boardUri ON placements(boardUri);
CREATE INDEX IF NOT EXISTS idx_placements_taskUri ON placements(taskUri);

CREATE TABLE IF NOT EXISTS placement_ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetPlacementUri TEXT NOT NULL,
  boardUri TEXT,                         -- Derived from target placement; nullable for new records
  fields TEXT NOT NULL DEFAULT '{}',    -- JSON
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_placement_ops_did_rkey ON placement_ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_placement_ops_boardUri ON placement_ops(boardUri);
CREATE INDEX IF NOT EXISTS idx_placement_ops_targetPlacementUri ON placement_ops(targetPlacementUri);

CREATE TABLE IF NOT EXISTS task_ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetTaskUri TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',    -- JSON
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_ops_did_rkey ON task_ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_task_ops_targetTaskUri ON task_ops(targetTaskUri);

CREATE TABLE IF NOT EXISTS task_trusts (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  taskUri TEXT NOT NULL,
  trustedDid TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_trusts_did_rkey ON task_trusts(did, rkey);
CREATE INDEX IF NOT EXISTS idx_task_trusts_taskUri ON task_trusts(taskUri);

CREATE TABLE IF NOT EXISTS projects (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  labels TEXT NOT NULL DEFAULT '[]',    -- JSON
  labelUris TEXT NOT NULL DEFAULT '[]', -- JSON array of AT URIs
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_did_rkey ON projects(did, rkey);

CREATE TABLE IF NOT EXISTS memberships (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  taskUri TEXT NOT NULL,
  projectUri TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_did_rkey ON memberships(did, rkey);
CREATE INDEX IF NOT EXISTS idx_memberships_projectUri ON memberships(projectUri);
CREATE INDEX IF NOT EXISTS idx_memberships_taskUri ON memberships(taskUri);

CREATE TABLE IF NOT EXISTS assignments (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  taskUri TEXT NOT NULL,
  assigneeDid TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_did_rkey ON assignments(did, rkey);
CREATE INDEX IF NOT EXISTS idx_assignments_taskUri ON assignments(taskUri);
CREATE INDEX IF NOT EXISTS idx_assignments_assigneeDid ON assignments(assigneeDid);

CREATE TABLE IF NOT EXISTS project_trusts (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  projectUri TEXT NOT NULL,
  trustedDid TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_trusts_did_rkey ON project_trusts(did, rkey);
CREATE INDEX IF NOT EXISTS idx_project_trusts_projectUri ON project_trusts(projectUri);

CREATE TABLE IF NOT EXISTS labels (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT,
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_did_rkey ON labels(did, rkey);

CREATE TABLE IF NOT EXISTS project_ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetProjectUri TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_ops_did_rkey ON project_ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_project_ops_targetProjectUri ON project_ops(targetProjectUri);

CREATE TABLE IF NOT EXISTS comment_ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetCommentUri TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_ops_did_rkey ON comment_ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_comment_ops_targetCommentUri ON comment_ops(targetCommentUri);

CREATE TABLE IF NOT EXISTS board_ops (
  uri TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  rkey TEXT NOT NULL,
  targetBoardUri TEXT NOT NULL,
  fields TEXT NOT NULL DEFAULT '{}',
  createdAt TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_board_ops_did_rkey ON board_ops(did, rkey);
CREATE INDEX IF NOT EXISTS idx_board_ops_targetBoardUri ON board_ops(targetBoardUri);

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
