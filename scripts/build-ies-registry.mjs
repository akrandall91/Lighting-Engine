import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIES } from '../src/ies-parser.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iesRoot = path.join(projectRoot, 'photometry', 'ies');
const outputFile = path.join(projectRoot, 'data', 'ies-registry.json');

async function walk(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.toLowerCase().endsWith('.ies')) files.push(full);
  }
  return files;
}

function inferDistribution(text) {
  const upper = text.toUpperCase();
  for (const distribution of ['T2M', 'T2L', 'T3M', 'T3S', 'T4M', 'T4']) {
    if (upper.includes(distribution)) return distribution;
  }
  if (/\bT2\b/.test(upper)) return 'T2L';
  if (/\bT3\b/.test(upper)) return 'T3S';
  return 'UNKNOWN';
}

function inferNominalWatts(text, measuredWatts) {
  const matches = [...text.matchAll(/(\d{2,3})\s*W/gi)].map((match) => Number(match[1]));
  if (!matches.length) return Math.round(measuredWatts || 0);
  return matches.reduce((best, value) =>
    Math.abs(value - measuredWatts) < Math.abs(best - measuredWatts) ? value : best,
  matches[0]);
}

function inferFamily(text) {
  const upper = text.toUpperCase();
  if (upper.includes('FI-PRO') || upper.includes('FIPRO')) return 'FI-PRO';
  if (upper.includes('XSPSM')) return 'XSPSM';
  return 'PHOTOMETRIC';
}

const files = await walk(iesRoot);
const seenHashes = new Map();
const records = [];

for (const file of files) {
  const bytes = await readFile(file);
  const text = bytes.toString('utf8');
  const parsed = parseIES(text, file);
  const relative = path.relative(projectRoot, file).replaceAll(path.sep, '/');
  const searchable = [
    path.basename(file),
    parsed.metadata.LUMCAT,
    parsed.metadata.LUMINAIRE,
    parsed.metadata.LAMP,
  ].filter(Boolean).join(' ');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const duplicateOf = seenHashes.get(sha256) || null;
  if (!duplicateOf) seenHashes.set(sha256, relative);

  const nominalLampW = inferNominalWatts(searchable, parsed.inputWatts);
  const distribution = inferDistribution(searchable);
  const cctMatch = searchable.match(/(?:-|,\s*|\b)(\d{2})K(?:\b|-)/i);
  const cct = cctMatch ? Number(cctMatch[1]) * 100 : 4000;
  const issues = [];
  if (distribution === 'UNKNOWN') issues.push('Distribution could not be inferred.');
  if (duplicateOf) issues.push(`Exact duplicate of ${duplicateOf}.`);
  if (!parsed.metadata.TESTLAB) issues.push('Test laboratory is missing.');
  if (!parsed.metadata.LUMCAT) issues.push('Luminaire catalog number is missing.');

  records.push({
    id: `${inferFamily(searchable).toLowerCase()}-${nominalLampW}w-${distribution.toLowerCase()}-${parsed.metadata.TEST || sha256.slice(0, 8)}`.replaceAll(/[^a-z0-9-]+/g, '-'),
    family: inferFamily(searchable),
    nominalLampW,
    measuredInputW: parsed.inputWatts,
    distribution,
    cct,
    cri: 80,
    lumens: parsed.lumens,
    testId: parsed.metadata.TEST || '',
    testLab: parsed.metadata.TESTLAB || '',
    issueDate: parsed.metadata.ISSUEDATE || '',
    format: parsed.version,
    path: relative,
    sha256,
    duplicateOf,
    status: issues.length ? 'review' : 'verified',
    issues,
  });
}

records.sort((a, b) =>
  a.family.localeCompare(b.family)
  || a.nominalLampW - b.nominalLampW
  || a.distribution.localeCompare(b.distribution),
);

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalFiles: records.length,
  uniqueFiles: records.filter((record) => !record.duplicateOf).length,
  records,
}, null, 2)}\n`);

console.log(`Indexed ${records.length} IES files (${records.filter((record) => !record.duplicateOf).length} unique).`);
