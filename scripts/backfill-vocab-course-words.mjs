#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = parseArgs(process.argv.slice(2));
const database = args.database || 'DB';
const local = args.remote ? false : true;
const dryRun = Boolean(args.dryRun);
const includeMaster = Boolean(args.includeMaster);
const masterSlug = args.masterSlug || 'core-english-450k';

const countSql = `
SELECT
  COUNT(*) as legacy_count
FROM vocabulary
LEFT JOIN vocab_courses c ON c.id = vocabulary.vocab_course_id
WHERE vocabulary.vocab_course_id IS NOT NULL
  AND vocabulary.vocab_course_id != ''
  AND vocabulary.is_deleted = 0
  ${includeMaster ? '' : `AND COALESCE(c.slug, '') != '${escapeSql(masterSlug)}'`}
`;

const missingSql = `
SELECT
  COUNT(*) as missing_mapping_count
FROM vocabulary v
LEFT JOIN vocab_courses c ON c.id = v.vocab_course_id
WHERE v.vocab_course_id IS NOT NULL
  AND v.vocab_course_id != ''
  AND v.is_deleted = 0
  ${includeMaster ? '' : `AND COALESCE(c.slug, '') != '${escapeSql(masterSlug)}'`}
  AND NOT EXISTS (
    SELECT 1
    FROM vocab_course_words cw
    WHERE cw.course_id = v.vocab_course_id
      AND cw.vocab_id = v.id
  );
`;

const backfillSql = `
INSERT OR IGNORE INTO vocab_course_words (id, course_id, vocab_id, order_index, section, is_featured)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(2))) || '-' ||
  lower(hex(randomblob(6))) as id,
  v.vocab_course_id as course_id,
  v.id as vocab_id,
  ROW_NUMBER() OVER (PARTITION BY v.vocab_course_id ORDER BY v.is_priority DESC, v.word ASC) - 1 as order_index,
  NULL as section,
  CASE WHEN v.is_priority THEN 1 ELSE 0 END as is_featured
FROM vocabulary v
LEFT JOIN vocab_courses c ON c.id = v.vocab_course_id
WHERE v.vocab_course_id IS NOT NULL
  AND v.vocab_course_id != ''
  AND v.is_deleted = 0
  ${includeMaster ? '' : `AND COALESCE(c.slug, '') != '${escapeSql(masterSlug)}'`}
`;

console.log(`[course-backfill] db=${database} mode=${local ? 'local' : 'remote'} dryRun=${dryRun} includeMaster=${includeMaster}`);
console.log('[course-backfill] legacy rows:');
runSql(countSql);
console.log('[course-backfill] missing mappings before:');
runSql(missingSql);

if (!dryRun) {
  console.log('[course-backfill] inserting mappings...');
  runSql(backfillSql);
  console.log('[course-backfill] missing mappings after:');
  runSql(missingSql);
} else {
  console.log('[course-backfill] dry-run only; no rows inserted.');
}

function runSql(sql) {
  const file = join(tmpdir(), `vocab-course-backfill-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(file, sql, 'utf8');
  const command = ['wrangler', 'd1', 'execute', database];
  if (local) command.push('--local');
  command.push('--file', file);

  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  try {
    rmSync(file, { force: true });
  } catch {}

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('--')) continue;
    const key = raw.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}
