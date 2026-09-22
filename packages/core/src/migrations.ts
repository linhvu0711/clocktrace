const v1 = `
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  external_id TEXT NOT NULL UNIQUE
);
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  bundle_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  title TEXT,
  url TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL
);
CREATE INDEX activities_started_at ON activities(started_at);
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  productive INTEGER NOT NULL
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  field TEXT NOT NULL,
  compare TEXT NOT NULL,
  value TEXT NOT NULL,
  effect TEXT NOT NULL,
  target TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const v2 = `
CREATE TABLE app_names (
  bundle_id TEXT PRIMARY KEY,
  name TEXT,
  genre TEXT,
  fetched_at TEXT NOT NULL
);
`;

export const migrations: ReadonlyArray<string> = [v1, v2];

export const schemaVersion: number = migrations.length;
