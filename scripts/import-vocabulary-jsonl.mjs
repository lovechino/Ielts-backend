#!/usr/bin/env node
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const file = args.file ? resolve(args.file) : null;
const database = args.database || 'ielts_db';
const courseSlug = args.courseSlug || 'core-english-450k';
const courseTitle = args.courseTitle || 'Core English 450k';
const courseDescription = args.courseDescription || 'Imported 450k dictionary vocabulary';
const batchSize = Number(args.batchSize || 500);
const maxSqlChars = Number(args.maxSqlChars || 180000);
const limit = args.limit ? Number(args.limit) : Infinity;
const local = args.remote ? false : true;
const idMode = args.idMode || 'auto';
const dryRun = Boolean(args.dryRun);
const checkpointPath = resolve(args.checkpoint || `.vocab-import-${courseSlug}.checkpoint.json`);

if (!file || !existsSync(file)) {
  fail('Usage: npm run vocab:import -- --file ../../Tool/vocab_scraper/data/vocab_450k.seed.vi_filled.full.jsonl [--local|--remote] [--id-mode auto|uuid] [--batch-size 500]');
}
if (!Number.isFinite(batchSize) || batchSize < 1) fail('--batch-size must be a positive number');

const checkpoint = readCheckpoint(checkpointPath);
const courseId = checkpoint.courseId || randomUUID();
let seen = checkpoint.lines || 0;
let imported = checkpoint.imported || 0;
let skipped = checkpoint.skipped || 0;
let batch = [];
let batchCharEstimate = 0;

console.log(`[vocab-import] file=${file}`);
console.log(`[vocab-import] db=${database} mode=${local ? 'local' : 'remote'} course=${courseSlug} idMode=${idMode}`);
console.log(`[vocab-import] resume lines=${seen} imported=${imported} skipped=${skipped}`);

await ensureCourse();

const rl = createInterface({
  input: createReadStream(file, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

let lineNo = 0;
for await (const line of rl) {
  lineNo += 1;
  if (lineNo <= seen) continue;
  if (imported >= limit) break;

  const item = parseLine(line, lineNo);
  if (!item) {
    skipped += 1;
    seen = lineNo;
    continue;
  }

  const rowEstimate = estimateRowSqlChars(item);
  if (batch.length > 0 && (batch.length >= batchSize || batchCharEstimate + rowEstimate > maxSqlChars)) {
    await flush();
  }

  batch.push(item);
  batchCharEstimate += rowEstimate;
  seen = lineNo;

  if (imported + batch.length >= limit) {
    await flush();
    break;
  }
}

await flush();
writeCheckpoint();
console.log(`[vocab-import] done lines=${seen} imported=${imported} skipped=${skipped}`);

async function ensureCourse() {
  const sql = [
    'CREATE TABLE IF NOT EXISTS vocab_courses (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, thumbnail_url TEXT, created_at INTEGER DEFAULT CURRENT_TIMESTAMP);',
    `INSERT INTO vocab_courses (id,title,slug,description,thumbnail_url,created_at) VALUES (${q(courseId)},${q(courseTitle)},${q(courseSlug)},${q(courseDescription)},NULL,strftime('%s','now')) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, description=excluded.description;`,
  ].join('\n');
  runSql(sql);
  writeCheckpoint();
}

async function flush() {
  if (batch.length === 0) return;
  runVocabularyRows(batch);
  imported += batch.length;
  batch = [];
  batchCharEstimate = 0;
  writeCheckpoint();
  if (imported % (batchSize * 10) === 0) {
    console.log(`[vocab-import] imported=${imported} lines=${seen} skipped=${skipped}`);
  }
}

function runVocabularyRows(rows) {
  const sql = buildVocabularySql(rows);
  if (sql.length > maxSqlChars && rows.length > 1) {
    const midpoint = Math.ceil(rows.length / 2);
    runVocabularyRows(rows.slice(0, midpoint));
    runVocabularyRows(rows.slice(midpoint));
    return;
  }
  if (sql.length > maxSqlChars) {
    console.warn(`[vocab-import] very large single row SQL (${sql.length} chars), attempting anyway: ${rows[0]?.word}`);
  }
  runSql(sql);
}

function estimateRowSqlChars(item) {
  return [
    item.word,
    item.definition,
    item.definition_vi,
    item.example,
    item.example_vi,
    item.topic,
    item.pronunciation,
    item.part_of_speech,
    item.level,
    JSON.stringify(item.synonyms || []),
    JSON.stringify(item.antonyms || []),
  ].reduce((total, value) => total + String(value || '').length + 64, 256);
}

function buildVocabularySql(rows) {
  const now = Math.floor(Date.now() / 1000);
  const columns = [
    ...(idMode === 'uuid' ? ['id'] : []),
    'vocab_course_id',
    'word',
    'definition',
    'definition_vi',
    'example',
    'example_vi',
    'topic',
    'pronunciation',
    'part_of_speech',
    'synonyms',
    'antonyms',
    'level',
    'is_priority',
    'is_academic',
    'status',
    'updated_at',
    'is_deleted',
  ];

  const values = rows.map((item) => {
    const synonyms = Array.isArray(item.synonyms) ? JSON.stringify(item.synonyms) : null;
    const antonyms = Array.isArray(item.antonyms) ? JSON.stringify(item.antonyms) : null;
    return `(${[
      ...(idMode === 'uuid' ? [q(randomUUID())] : []),
      q(courseId),
      q(item.word),
      q(item.definition || ''),
      q(item.definition_vi || ''),
      q(item.example || ''),
      q(item.example_vi || ''),
      q(item.topic || 'General'),
      q(item.pronunciation || ''),
      q(item.part_of_speech || ''),
      q(synonyms),
      q(antonyms),
      q(item.level || ''),
      item.is_priority ? 1 : 0,
      item.is_academic ? 1 : 0,
      q(args.status || 'draft'),
      now,
      0,
    ].join(',')})`;
  }).join(',\n');

  return `
INSERT INTO vocabulary (${columns.join(',')}) VALUES
${values}
ON CONFLICT(word) DO UPDATE SET
  vocab_course_id=excluded.vocab_course_id,
  definition=excluded.definition,
  definition_vi=excluded.definition_vi,
  example=excluded.example,
  example_vi=excluded.example_vi,
  topic=excluded.topic,
  pronunciation=excluded.pronunciation,
  part_of_speech=excluded.part_of_speech,
  synonyms=excluded.synonyms,
  antonyms=excluded.antonyms,
  level=excluded.level,
  is_priority=excluded.is_priority,
  is_academic=excluded.is_academic,
  status=excluded.status,
  updated_at=excluded.updated_at,
  is_deleted=0;
`;
}

function parseLine(line, lineNo) {
  if (!line.trim()) return null;
  try {
    const raw = JSON.parse(line);
    const word = String(raw.word || raw.normalized_word || '').trim();
    if (!word) return null;
    return {
      ...raw,
      word,
      definition: raw.definition || '',
      definition_vi: raw.definition_vi || '',
      topic: raw.topic || 'General',
      level: raw.level || '',
      part_of_speech: raw.part_of_speech || '',
      pronunciation: raw.pronunciation || '',
      is_priority: Boolean(raw.is_priority || raw.is_core),
      is_academic: Boolean(raw.is_academic),
    };
  } catch (error) {
    console.warn(`[vocab-import] skip invalid json line=${lineNo}: ${error.message}`);
    return null;
  }
}

function runSql(sql) {
  if (dryRun) return;
  const dir = resolve(tmpdir(), 'talko-vocab-import');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `batch-${Date.now()}-${Math.random().toString(16).slice(2)}.sql`);
  writeFileSync(path, sql, 'utf8');
  const wranglerArgs = ['d1', 'execute', database, local ? '--local' : '--remote', '--file', path];
  const isWindows = /^win/.test(process.platform);
  const wranglerBin = resolve(process.cwd(), 'node_modules', '.bin', isWindows ? 'wrangler.cmd' : 'wrangler');
  const result = isWindows
    ? spawnSync([cmdQuote(wranglerBin), ...wranglerArgs.map(cmdQuote)].join(' '), { cwd: process.cwd(), stdio: 'inherit', shell: true })
    : spawnSync(wranglerBin, wranglerArgs, { cwd: process.cwd(), stdio: 'inherit' });
  rmSync(path, { force: true });
  if (result.status !== 0) {
    const detail = result.error ? ` error=${result.error.message}` : result.signal ? ` signal=${result.signal}` : '';
    fail(`wrangler d1 execute failed with status ${result.status}${detail}`);
  }
}

function cmdQuote(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function q(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function readCheckpoint(path) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeCheckpoint() {
  const data = { file, database, local, courseId, courseSlug, lines: seen, imported, skipped, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(checkpointPath, JSON.stringify(data, null, 2), 'utf8');
}

function fail(message) {
  console.error(`[vocab-import] ${message}`);
  process.exit(1);
}
