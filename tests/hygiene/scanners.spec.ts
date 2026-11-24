// P004 hygiene drill (run with: node --test tests/hygiene/scanners.spec.ts).
//
// Each of the six scanners gets a failing fixture (exit != 0) and a passing
// fixture (exit 0), executed as CLIs against temp roots. Secret-shaped and
// identity-shaped strings are assembled at runtime so this tracked source
// stays scanner-clean itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SPEC_DIR, '..', '..');
const NODE = process.execPath;
const HYG = path.join(ROOT, 'scripts', 'hygiene');

function runCli(script: string, args: string[]): { exit: number; output: string } {
  try {
    const out = execFileSync(NODE, [script, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { exit: 0, output: String(out) };
  } catch (e) {
    const err = e as { status?: number; stdout?: unknown; stderr?: unknown };
    return { exit: err.status ?? 1, output: `${String(err.stdout ?? '')}\n${String(err.stderr ?? '')}` };
  }
}

function fresh(sub: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `hyg-${sub}-`));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function orgVoice(): string {
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8'));
  return `${cfg.productName} Maintainers`;
}

/* Minimal JPEG: SOI + APP1/Exif (LE TIFF: ASCII Artist inline + GPS tag) + EOI. */
function exifJpeg(): Buffer {
  const tiff = Buffer.alloc(38);
  tiff.write('II', 0);
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(2, 8);
  tiff.writeUInt16LE(0x013b, 10);
  tiff.writeUInt16LE(2, 12);
  tiff.writeUInt32LE(3, 14);
  tiff.writeUInt32LE(0x00415441, 18); // "TA\0" inline
  tiff.writeUInt16LE(0x8825, 22);
  tiff.writeUInt16LE(4, 24);
  tiff.writeUInt32LE(1, 26);
  tiff.writeUInt32LE(0, 30);
  tiff.writeUInt32LE(0, 34);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(2 + 2 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(2 + exif.length, 2);
  exif.copy(app1, 4);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
}

/* Minimal PNG: signature + IHDR + IEND, no text chunks (CRCs zeroed; the scanner reads by length). */
function cleanPng(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(1, 8);
  ihdr.writeUInt32BE(1, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  const iend = Buffer.alloc(12);
  iend.writeUInt32BE(0, 0);
  iend.write('IEND', 4);
  return Buffer.concat([sig, ihdr, iend]);
}

test('author rejects a personal-looking identity', () => {
  const dir = fresh('author-fail');
  writeFileSync(path.join(dir, 'branding.config.json'), readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8'));
  const personalMail = ['jane.doe', '@', 'contoso.com'].join('');
  const r = runCli(path.join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', 'Jane Doe',
    '--author-email', personalMail,
    '--committer-name', 'Jane Doe',
    '--committer-email', personalMail,
  ]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /org voice|noreply/);
});

test('author accepts the org voice with a noreply address', () => {
  const dir = fresh('author-pass');
  writeFileSync(path.join(dir, 'branding.config.json'), readFileSync(path.join(ROOT, 'branding.config.json'), 'utf8'));
  const voiceMail = 'owner+dev@users.noreply.github.com';
  const r = runCli(path.join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', orgVoice(),
    '--author-email', voiceMail,
    '--committer-name', orgVoice(),
    '--committer-email', voiceMail,
  ]);
  assert.equal(r.exit, 0, r.output);
});

test('author enforces a pinned identity exactly', () => {
  const dir = fresh('author-pinned-pass');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  const pinned = { name: 'Pinned Fixture', email: '000000+fixture@example.invalid' };
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify(pinned));
  const args = ['--root', dir, '--author-name', pinned.name, '--author-email', pinned.email, '--committer-name', pinned.name, '--committer-email', pinned.email];
  const ok = runCli(join(HYG, 'scan-author.mjs'), args);
  assert.equal(ok.exit, 0, ok.output);
});

test('author rejects a valid-shape address when a pinned identity exists', () => {
  const dir = fresh('author-pinned-fail');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify({ name: 'Pinned Fixture', email: '000000+fixture@example.invalid' }));
  const other = 'someone+else@users.noreply.github.com';
  const bad = runCli(join(HYG, 'scan-author.mjs'), ['--root', dir, '--author-name', 'Pinned Fixture', '--author-email', other, '--committer-name', 'Pinned Fixture', '--committer-email', other]);
  assert.notEqual(bad.exit, 0, 'pinned identity must reject even well-formed alternatives');
  assert.match(bad.output, /identity\.json/);
});

test('author rejects any @gmail.com committer identity', () => {
  // The hidden Gmail must never appear as a commit identity: the hook
  // enforces the pinned noreply address for BOTH roles (P022 hardening).
  const dir = fresh('author-gmail-committer-fail');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  const pinned = JSON.parse(readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify(pinned));
  const gmail = ['operator', '@', 'gmail.com'].join('');
  const bad = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', pinned.name, '--author-email', pinned.email,
    '--committer-name', pinned.name, '--committer-email', gmail,
  ]);
  assert.notEqual(bad.exit, 0, 'a gmail committer must fail the author check');
  assert.match(bad.output, /GIT_COMMITTER_EMAIL/);
});

test('author rejects the retired PROJECT ONE org voice for new commits', () => {
  // The pre-rename voice fails closed after the P022 flip: only the pinned
  // identity in .hygiene/identity.json is accepted (history is untouched).
  const dir = fresh('author-old-voice-fail');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  const pinned = JSON.parse(readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify(pinned));
  const oldVoice = ['PROJECT ONE', ' Maintainers'].join('');
  const bad = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', oldVoice, '--author-email', pinned.email,
    '--committer-name', pinned.name, '--committer-email', pinned.email,
  ]);
  assert.notEqual(bad.exit, 0, 'the retired org voice must fail for new commits');
  assert.match(bad.output, /GIT_AUTHOR_NAME/);
});

test('author rejects a spoofed dependabot[bot] git identity (actor-gating only)', () => {
  // The hygiene workflow skips the author step ONLY when
  // github.actor == 'dependabot[bot]'. A human pushing commits with
  // git-author "dependabot[bot]" must STILL FAIL this scanner.
  const dir = fresh('author-spoof-fail');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  const spoofMail = ['49699333+dependabot[bot]', '@users.noreply.github.com'].join('');
  const bad = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', 'dependabot[bot]',
    '--author-email', spoofMail,
    '--committer-name', 'dependabot[bot]',
    '--committer-email', spoofMail,
  ]);
  assert.notEqual(bad.exit, 0, 'spoofed dependabot[bot] git identity must fail the author check');
  assert.match(bad.output, /identity\.json/);
});

test('hygiene workflow gates the author skip on github.actor, not the commit string', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'hygiene.yml'), 'utf8');
  assert.match(yml, /if:\s*github\.event_name\s*==\s*'pull_request'\s*&&\s*github\.actor\s*!=\s*'dependabot\[bot\]'/);
  assert.match(yml, /if:\s*github\.event_name\s*==\s*'push'/);
  assert.match(yml, /--author-only\s+--allow-bot-author/);
  assert.doesNotMatch(yml, /HEAD_NAME.*dependabot|author-name.*dependabot/i);
});

test('author-only accepts a pinned author regardless of committer (post-merge main)', () => {
  const dir = fresh('author-only-pass');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  const pinned = JSON.parse(readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify(pinned));
  const ok = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir, '--author-only',
    '--author-name', pinned.name, '--author-email', pinned.email,
  ]);
  assert.equal(ok.exit, 0, ok.output);
});

test('author-only still rejects a spoofed dependabot[bot] author without the bot flag', () => {
  const dir = fresh('author-only-spoof-fail');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  const spoofMail = ['49699333+dependabot[bot]', '@users.noreply.github.com'].join('');
  const bad = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir, '--author-only',
    '--author-name', 'dependabot[bot]', '--author-email', spoofMail,
  ]);
  assert.notEqual(bad.exit, 0, 'spoofed author must fail even in author-only mode');
});

test('author-only with bot flag accepts the exact dependabot identity, rejects near-misses', () => {
  const dir = fresh('author-only-bot');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  const spoofMail = ['49699333+dependabot[bot]', '@users.noreply.github.com'].join('');
  const ok = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir, '--author-only', '--allow-bot-author',
    '--author-name', 'dependabot[bot]', '--author-email', spoofMail,
  ]);
  assert.equal(ok.exit, 0, ok.output);
  const near = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir, '--author-only', '--allow-bot-author',
    '--author-name', 'dependabot[bot]', '--author-email', 'dependabot@example.com',
  ]);
  assert.notEqual(near.exit, 0, 'near-miss bot email must fail');
});

test('author accepts a pinned author with a GitHub-mediated committer (rebase-merge)', () => {
  const dir = fresh('author-github-committer-pass');
  mkdirSync(join(dir, '.hygiene'), { recursive: true });
  writeFileSync(join(dir, 'branding.config.json'), readFileSync(join(ROOT, 'branding.config.json'), 'utf8'));
  const pinned = JSON.parse(readFileSync(join(ROOT, '.hygiene', 'identity.json'), 'utf8'));
  writeFileSync(join(dir, '.hygiene', 'identity.json'), JSON.stringify(pinned));
  const ok = runCli(join(HYG, 'scan-author.mjs'), [
    '--root', dir,
    '--author-name', pinned.name, '--author-email', pinned.email,
    '--committer-name', 'GitHub', '--committer-email', 'noreply@github.com',
  ]);
  assert.equal(ok.exit, 0, ok.output);
});

test('paths rejects a home-directory path with a username', () => {
  const dir = fresh('paths-fail');
  const homePath = ['C:\\Users\\', 'jdoe', '\\docs\\secret.txt'].join('');
  writeFileSync(path.join(dir, 'notes.txt'), `see ${homePath} for details\n`);
  const r = runCli(path.join(HYG, 'scan-paths.mjs'), ['--root', dir]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /win-home/);
});

test('paths accepts redacted tokens and angle-bracket examples', () => {
  const dir = fresh('paths-pass');
  writeFileSync(path.join(dir, 'notes.txt'), 'see %USERPROFILE%\\docs and $HOME/docs and C:\\Users\\<you>\\docs\n');
  const r = runCli(path.join(HYG, 'scan-paths.mjs'), ['--root', dir]);
  assert.equal(r.exit, 0, r.output);
});

test('metadata rejects EXIF GPS/author and PDF author entries', () => {
  const dir = fresh('meta-fail');
  writeFileSync(path.join(dir, 'photo.jpg'), exifJpeg());
  writeFileSync(path.join(dir, 'doc.pdf'), '%PDF-1.4\n1 0 obj\n<< /Author (Fixture Artist) /Creator (Fixture Tool) >>\nendobj\ntrailer\n<< >>\n');
  const r = runCli(path.join(HYG, 'scan-metadata.mjs'), ['--root', dir]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /exif-gps/);
  assert.match(r.output, /exif-author/);
});

test('metadata accepts a clean PNG and a clean PDF', () => {
  const dir = fresh('meta-pass');
  writeFileSync(path.join(dir, 'clean.png'), cleanPng());
  writeFileSync(path.join(dir, 'clean.pdf'), '%PDF-1.4\n1 0 obj\n<< /Title (Fixture Doc) >>\nendobj\ntrailer\n<< >>\n');
  const r = runCli(path.join(HYG, 'scan-metadata.mjs'), ['--root', dir]);
  assert.equal(r.exit, 0, r.output);
});

test('secrets rejects a key and a private-key header', () => {
  const dir = fresh('secrets-fail');
  const aws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const header = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  writeFileSync(path.join(dir, 'deploy.sh'), `export AWS_KEY=${aws}\n${header}\n`);
  const r = runCli(path.join(HYG, 'scan-secrets.mjs'), ['--root', dir]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /aws-access-key/);
  assert.match(r.output, /private-key/);
});

test('secrets accepts env-var references and skips lockfile hashes', () => {
  const dir = fresh('secrets-pass');
  writeFileSync(path.join(dir, 'run.sh'), 'API_KEY=${API_KEY}\n');
  writeFileSync(
    path.join(dir, 'pnpm-lock.yaml'),
    "importers:\n  .:\n    dependencies:\n      x:\n        specifier: 1.0.0\n        version: 1.0.0\n        integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\n",
  );
  const r = runCli(path.join(HYG, 'scan-secrets.mjs'), ['--root', dir]);
  assert.equal(r.exit, 0, r.output);
});

test('names enforces a seeded blocklist hit', () => {
  const dir = fresh('names-fail');
  writeFileSync(path.join(dir, 'block.json'), JSON.stringify({ seeded: true, terms: ['Redacted Person', 'redacted@example.com'] }));
  writeFileSync(path.join(dir, 'notes.txt'), 'reviewed by Redacted Person\n');
  const r = runCli(path.join(HYG, 'scan-names.mjs'), ['--root', dir, '--blocklist', path.join(dir, 'block.json')]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /blocklist/);
});

test('names passes a clean tree and reports ARMED when unseeded', () => {
  const dir = fresh('names-pass');
  writeFileSync(path.join(dir, 'block.json'), JSON.stringify({ seeded: true, terms: ['Redacted Person'] }));
  writeFileSync(path.join(dir, 'notes.txt'), 'reviewed by the automation\n');
  const r = runCli(path.join(HYG, 'scan-names.mjs'), ['--root', dir, '--blocklist', path.join(dir, 'block.json')]);
  assert.equal(r.exit, 0, r.output);
  assert.match(r.output, /enforced/);
  const bare = fresh('names-armed');
  const r2 = runCli(path.join(HYG, 'scan-names.mjs'), ['--root', bare]);
  assert.equal(r2.exit, 0);
  assert.match(r2.output, /ARMED/);
});

test('fixtures rejects a real-domain email and a key in sample data', () => {
  const dir = fresh('fixtures-fail');
  mkdirSync(path.join(dir, 'eval', 'fixtures'), { recursive: true });
  const personalMail = ['jane.doe', '@', 'contoso.com'].join('');
  const aws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  writeFileSync(path.join(dir, 'eval', 'fixtures', 'contact.json'), JSON.stringify({ contact: personalMail, key: aws }));
  const r = runCli(path.join(HYG, 'scan-fixtures.mjs'), ['--root', dir]);
  assert.notEqual(r.exit, 0);
  assert.match(r.output, /fixture-email/);
  assert.match(r.output, /fixture-key/);
});

test('fixtures accepts reserved-domain sample data', () => {
  const dir = fresh('fixtures-pass');
  mkdirSync(path.join(dir, 'eval', 'fixtures'), { recursive: true });
  writeFileSync(path.join(dir, 'eval', 'fixtures', 'contact.json'), JSON.stringify({ contact: 'jane@example.com' }));
  const r = runCli(path.join(HYG, 'scan-fixtures.mjs'), ['--root', dir]);
  assert.equal(r.exit, 0, r.output);
});
