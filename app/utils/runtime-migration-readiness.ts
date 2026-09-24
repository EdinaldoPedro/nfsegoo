import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

export type RuntimeMigrationRow = {
  name: string;
  finished: boolean;
  rolledBack: boolean;
};

export async function readRuntimeMigrationNames(rootDir = process.cwd()) {
  const directory = path.join(rootDir, 'prisma', 'migrations');
  const entries = await readdir(directory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{14}_[a-z0-9_]+$/.test(entry.name)) continue;
    await access(path.join(directory, entry.name, 'migration.sql'));
    names.push(entry.name);
  }
  return names.sort();
}

export function compareRuntimeMigrations(expectedNames: string[], rows: RuntimeMigrationRow[]) {
  const expected = new Set(expectedNames);
  const applied = new Set(rows.filter(row => row.finished && !row.rolledBack).map(row => row.name));
  const unfinished = rows.filter(row => !row.finished && !row.rolledBack).length;
  const missing = expectedNames.filter(name => !applied.has(name));
  const unknown = [...applied].filter(name => !expected.has(name));
  return {
    ok: expectedNames.length > 0 && missing.length === 0 && unknown.length === 0 && unfinished === 0,
    expected: expectedNames.length,
    applied: applied.size,
    missing: missing.length,
    unknown: unknown.length,
    unfinished,
  };
}
