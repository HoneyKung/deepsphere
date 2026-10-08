import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'sound-manifest.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8'));
const code = fs.readFileSync(path.join(root, 'twin', 'twin.js'), 'utf8');
const catalogById = new Map(catalog.twin_cues.map((entry) => [entry.cue_id, entry]));
const codeTokens = new Set([...code.matchAll(/['"]([a-z][a-z0-9_]+)['"]/g)].map((match) => match[1]));
const errors = [];

if (manifest.schema !== 2) errors.push('Expected manifest schema 2.');
if (catalog.twin_catalog_version !== 2) errors.push('Expected twin_catalog_version 2.');
if (catalogById.size !== catalog.twin_cues.length) errors.push('Twin catalog contains duplicate cue IDs.');

const expected = new Set(Object.keys(manifest.sfx));
for (const id of Object.keys(manifest.music)) expected.add('music_' + id);
for (const id of Object.keys(manifest.bridges)) expected.add('bridge_' + id);
for (const id of ['welcome', 'zone_mid', 'zone_deep', 'scan_hit', 'scan_miss', 'on_frame', 'collect',
  'duplicate', 'nothing', 'tray_empty', 'analyze', 'max_depth', 'surface', 'complete']) expected.add('vo_' + id);

for (const id of expected) {
  if (!catalogById.has(id)) errors.push('Missing catalog entry: ' + id);
}
for (const entry of catalog.twin_cues) {
  if (!expected.has(entry.cue_id)) errors.push('Unexpected catalog entry: ' + entry.cue_id);
  if (!['file', 'draft', 'none'].includes(entry.source)) errors.push('Invalid source field for ' + entry.cue_id);
  const paths = Array.isArray(entry.files) ? entry.files : Object.values(entry.files || {});
  if (entry.source === 'file' && paths.length === 0) errors.push('File source has no file: ' + entry.cue_id);
  for (const file of paths) {
    if (file.includes('..') || /(^|\/)(temp|legacy)(\/|$)/i.test(file)) errors.push('Forbidden asset path: ' + file);
    if (!fs.existsSync(path.join(directory, file))) errors.push('Missing file for ' + entry.cue_id + ': ' + file);
  }
}

for (const id of Object.keys(manifest.sfx)) {
  const dynamic = id.startsWith('life_') ? /cue\('life_'\s*\+\s*species\s*\+\s*'_'/m.test(code) :
    id.startsWith('ambient_') ? /const nextId\s*=\s*'ambient_'\s*\+\s*zone/m.test(code) : false;
  if (!codeTokens.has(id) && !dynamic) errors.push('Cue is not referenced by twin.js: ' + id);
}
for (const id of Object.keys(manifest.music)) {
  if (!codeTokens.has(id)) errors.push('Music theme is not referenced by twin.js: ' + id);
}
for (const id of Object.keys(manifest.bridges)) {
  if (!codeTokens.has(id)) errors.push('Bridge is not referenced by twin.js: ' + id);
}
if (/new\s+Audio\s*\(/.test(code)) errors.push('Legacy HTMLAudio playback remains in twin.js.');
if (/(^|["'])\.\.\/assets\/audio\/(?:temp|legacy)(?:\/|["'])/i.test(code)) errors.push('Forbidden temp or legacy path is referenced in twin.js.');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Catalog validation passed: ' + expected.size + ' cue IDs and all referenced audio files exist.');
}
