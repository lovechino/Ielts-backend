#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const manifestPath = args.manifest ? resolve(args.manifest) : null;
const apiBase = args.apiBase || process.env.API_BASE_URL || 'http://localhost:8787/api/v1';
const token = args.token || process.env.ADMIN_TOKEN;

if (!manifestPath || !token) {
  console.error('Usage: node scripts/set-dictionary-version.mjs --manifest path/to/manifest.json --token <admin-jwt> [--api-base http://localhost:8787/api/v1]');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.version || !manifest.url) {
  console.error('Manifest must include version and url. Fill url after uploading dictionary.db to CDN/R2.');
  process.exit(1);
}

const body = {
  version: manifest.version,
  url: manifest.url,
  checksum: manifest.checksum ?? null,
  size: manifest.size ?? null,
  word_count: manifest.word_count ?? null,
  current_version: manifest.current_version ?? null,
  isFullUpdate: manifest.isFullUpdate ?? true,
  patchUrl: manifest.patchUrl ?? null,
  patchSize: manifest.patchSize ?? null,
};

const res = await fetch(`${apiBase.replace(/\/$/, '')}/dictionary/version`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`[dictionary-version] failed ${res.status}: ${text}`);
  process.exit(1);
}

console.log(text);

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
