import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const contributing = await readFile(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');
const joinPage = await readFile(new URL('../src/platform/pages/JoinPage.tsx', import.meta.url), 'utf8');
const faqPage = await readFile(new URL('../src/platform/pages/FaqPage.tsx', import.meta.url), 'utf8');

test('README is a concise landing page with one clear path to the canonical guide', () => {
  assert.ok(readme.split('\n').length < 120);
  for (const heading of [
    '## how it works',
    '## want to contribute?',
    '## what can contributors edit?',
    '## editable pages',
    '## technology',
    '## maintainer documentation',
  ]) assert.match(readme, new RegExp(heading.replace('?', '\\?')));
  assert.match(readme, /https:\/\/whotouchedthis\.website\/join/);
  assert.match(readme, /\[contributor guide\]\(CONTRIBUTING\.md\)/);
  assert.match(readme, /`\/`[\s\S]*`\/random`[\s\S]*`\/thoughts`/);
  assert.doesNotMatch(readme, /Milestone #|Firebase development|Founder Contribution #000 bootstrap|npm install/i);
});

test('CONTRIBUTING remains the ordered active-turn manual', () => {
  const required = [
    'your turn is active',
    'Fork <https://github.com/jeffsandov6/who-touched-this>',
    'Clone **your fork**',
    'npm run contributor:setup',
    'upstream',
    'contribution/SHORT-DESCRIPTION',
    'npm run dev:contributor',
    'src/canvas/**',
    'npm run contribution:validate',
    'git push -u origin',
    'jeffsandov6/who-touched-this : main',
    'first valid non-draft PR',
    'same branch',
    'does not guarantee acceptance',
  ];
  for (const phrase of required) assert.ok(contributing.includes(phrase), phrase);
  assert.match(contributing, /one ordinary\s+contribution per season/);
  assert.doesNotMatch(contributing, /configure Firebase|\.env production|deploy:|snapshots:capture/i);
});

test('every documented npm run command exists', async () => {
  const docs = (await readdir(new URL('../docs/', import.meta.url)))
    .filter((file) => file.endsWith('.md'))
    .map((file) => new URL(`../docs/${file}`, import.meta.url));
  for (const url of [new URL('../README.md', import.meta.url), new URL('../CONTRIBUTING.md', import.meta.url), ...docs]) {
    const source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/npm run ([a-z0-9:-]+)/gi)) {
      assert.ok(packageJson.scripts[match[1]], `${url.pathname}: ${match[1]}`);
    }
  }
});

test('Join provides the journey and an active-turn launchpad without changing lifecycle code', () => {
  assert.match(joinPage, /join → wait → invitation → accept → contribute/);
  assert.match(joinPage, /signed in with GitHub/);
  assert.match(joinPage, /GitHub account connected\./);
  assert.match(joinPage, /participationStatus === 'active'/);
  for (const text of [
    'fork the repository',
    'clone your fork',
    'npm run contributor:setup',
    'npm run dev:contributor',
    'src/canvas/**',
    'test your change',
    'open your non-draft pull request',
    'full contributor guide ↗',
  ]) assert.ok(joinPage.includes(text), text);
  assert.match(joinPage, /CANONICAL_REPOSITORY_URL = 'https:\/\/github\.com\/jeffsandov6\/who-touched-this'/);
  assert.match(joinPage, /<a href=\{CANONICAL_REPOSITORY_URL\}>fork the repository<\/a>/);
  assert.match(joinPage, /CONTRIBUTOR_GUIDE_URL = `\$\{CANONICAL_REPOSITORY_URL\}\/blob\/main\/CONTRIBUTING\.md`/);
});

test('FAQ names the current editable pages and links to the full guide', () => {
  assert.match(faqPage, /existing editable pages at \/, \/random, & \/thoughts/);
  assert.match(faqPage, /full contributor guide ↗/);
});
