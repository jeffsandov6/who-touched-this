import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = '../src/canvas/components/react/CanvasPageNavigation.tsx';
const component = await readFile(new URL(componentPath, import.meta.url), 'utf8');
const pages = [
  { file: 'Home.tsx', route: '/' },
  { file: 'Random.tsx', route: '/random' },
  { file: 'Thoughts.tsx', route: '/thoughts' },
];

test('shared editable canvas navigation contains all three normal links', () => {
  for (const [href, label] of [['/', 'home'], ['/random', 'random'], ['/thoughts', 'thoughts']]) {
    assert.match(component, new RegExp(`href: '${href.replaceAll('/', '\\/')}', label: '${label}'`));
  }
  assert.match(component, /<nav className="canvas-page-navigation" aria-label="Editable pages">/);
});

test('each canvas page renders the shared navigation with its exact current path', async () => {
  for (const { file, route } of pages) {
    const source = await readFile(new URL(`../src/canvas/pages/${file}`, import.meta.url), 'utf8');
    assert.match(source, /import CanvasPageNavigation from '\.\.\/components\/react\/CanvasPageNavigation'/);
    assert.ok(source.includes(`<CanvasPageNavigation currentPath="${route}" />`));
  }
  assert.match(component, /aria-current=\{currentPath === href \? 'page' : undefined\}/);
});

test('canvas navigation implementation stays inside the editable canvas boundary', () => {
  assert.ok(componentPath.startsWith('../src/canvas/'));
  for (const { file } of pages) assert.ok(`../src/canvas/pages/${file}`.startsWith('../src/canvas/'));
  assert.doesNotMatch(component, /src\/platform|editable-routes|firebase/i);
});
