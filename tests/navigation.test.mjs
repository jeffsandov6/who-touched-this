import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import test, { after, before } from 'node:test';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const projectRoot = new URL('../', import.meta.url);
const registry = JSON.parse(await readFile(new URL('../src/platform/config/editable-routes.json', import.meta.url), 'utf8'));
const navigationSource = await readFile(new URL('../src/platform/navigation.ts', import.meta.url), 'utf8');
const componentSource = await readFile(new URL('../src/platform/components/Navigation.tsx', import.meta.url), 'utf8');
const exec = promisify(execFile);
let browser;
let origin;

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Astro dev server did not become ready at ${url}`);
}

before(async () => {
  const port = await availablePort();
  origin = `http://127.0.0.1:${port}`;
  await exec('npm', ['exec', '--', 'astro', 'dev', '--background', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: { ...process.env, PUBLIC_CONTRIBUTOR_PREVIEW: 'true' },
  });
  await waitForServer(origin);
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await exec('npm', ['exec', '--', 'astro', 'dev', 'stop'], { cwd: projectRoot });
});

test('navigation derives editable pages from the protected canonical registry', () => {
  assert.deepEqual(registry.routes, ['/', '/random', '/thoughts']);
  assert.match(navigationSource, /import editableRouteRegistry from '.\/config\/editable-routes\.json'/);
  assert.match(navigationSource, /editablePageLinks\(editableRouteRegistry\.routes\)/);
  assert.match(componentSource, /editableLinks\.map/);
  assert.doesNotMatch(componentSource, /href: '\/(?:random|thoughts)'/);
});

test('navbar order and dropdown expose only approved non-home editable routes', async () => {
  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  const labels = await page.locator('.primary-navigation-links > li').evaluateAll((items) => items.map((item) => {
    const control = item.querySelector(':scope > a, :scope > button');
    return control?.textContent.trim();
  }));
  assert.deepEqual(labels, ['home', 'pages', 'history', 'faq', 'rules', 'join', '$wtt']);

  const hrefs = await page.locator('[data-pages-dropdown] a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  assert.deepEqual(hrefs, ['/random', '/thoughts']);
  assert.equal((await page.locator('.pages-navigation-label').textContent()).trim(), 'more editable pages');
  assert.ok(!hrefs.includes('/'));
  for (const internalRoute of ['/admin', '/history/detail-shell', '/api', '/auth']) {
    assert.ok(!hrefs.includes(internalRoute));
  }
  await page.close();
});

test('home, editable pages, and protected pages retain exact active treatment', async () => {
  const page = await browser.newPage();
  const cases = [
    { path: '/', top: 'home', selected: null },
    { path: '/random', top: 'pages', selected: 'random' },
    { path: '/thoughts', top: 'pages', selected: 'thoughts' },
    { path: '/history', top: 'history', selected: null },
    { path: '/faq', top: 'faq', selected: null },
    { path: '/rules', top: 'rules', selected: null },
    { path: '/join', top: 'join', selected: null },
    { path: '/wtt/claim', top: '$wtt', selected: null },
  ];

  for (const { path, top, selected } of cases) {
    await page.goto(`${origin}${path}`);
    const topCurrent = page.locator('.primary-navigation-links > li > [aria-current="page"]');
    assert.equal((await topCurrent.textContent()).trim(), top, path);
    const dropdownCurrent = page.locator('[data-pages-dropdown] a[aria-current="page"]');
    assert.equal(await dropdownCurrent.count(), selected ? 1 : 0, path);
    if (selected) assert.equal((await dropdownCurrent.textContent()).trim(), selected, path);
  }
  await page.close();
});

test('pages shares the neighboring link baseline at desktop and mobile widths', async () => {
  const page = await browser.newPage();
  const selectors = [
    '.primary-navigation-links > li > a[href="/"]',
    '[data-pages-trigger]',
    '.primary-navigation-links > li > a[href="/history"]',
  ];

  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/random', '/thoughts']) {
      await page.goto(`${origin}${path}`);
      const textRects = await page.evaluate((controls) => controls.map((selector) => {
        const element = document.querySelector(selector);
        const range = document.createRange();
        range.selectNodeContents(element);
        const rect = range.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      }), selectors);
      for (const rect of textRects.slice(1)) {
        assert.ok(Math.abs(rect.top - textRects[0].top) < 0.01, `${width}px ${path} top baseline`);
        assert.ok(Math.abs(rect.bottom - textRects[0].bottom) < 0.01, `${width}px ${path} bottom baseline`);
      }
    }
  }
  await page.close();
});

test('dropdown supports disclosure state, keyboard use, Escape, outside interaction, and selection', async () => {
  const page = await browser.newPage();
  await page.goto(origin);
  const trigger = page.locator('[data-pages-trigger]');
  const dropdown = page.locator('[data-pages-dropdown]');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await dropdown.isHidden(), true);

  await trigger.focus();
  await page.keyboard.press('Enter');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await dropdown.isVisible(), true);
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/random');
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);

  await trigger.click();
  await page.locator('main').click({ position: { x: 2, y: 2 } });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');

  await trigger.click();
  const randomLink = page.locator('[data-pages-dropdown] a[href="/random"]');
  await randomLink.evaluate((link) => link.addEventListener('click', (event) => event.preventDefault(), { once: true }));
  await randomLink.click();
  assert.equal(page.url(), `${origin}/`);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await page.close();
});

test('narrow navigation and open dropdown stay within the viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
  await page.goto(origin);
  await page.locator('[data-pages-trigger]').click();
  const dimensions = await page.evaluate(() => {
    const dropdown = document.querySelector('[data-pages-dropdown]').getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      dropdownLeft: dropdown.left,
      dropdownRight: dropdown.right,
    };
  });
  assert.ok(dimensions.documentWidth <= dimensions.viewportWidth);
  assert.ok(dimensions.dropdownLeft >= 0);
  assert.ok(dimensions.dropdownRight <= dimensions.viewportWidth);
  await page.close();
});

test('canvas navigation stays complete, current, and contained at desktop and mobile widths', async () => {
  const page = await browser.newPage();
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/random', '/thoughts']) {
      await page.goto(`${origin}${path}`);
      const result = await page.locator('nav[aria-label="Editable pages"]').evaluate((navigation) => {
        const links = [...navigation.querySelectorAll('a')];
        const rect = navigation.getBoundingClientRect();
        return {
          hrefs: links.map((link) => link.getAttribute('href')),
          current: navigation.querySelector('[aria-current="page"]')?.getAttribute('href'),
          left: rect.left,
          right: rect.right,
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          minimumLinkHeight: Math.min(...links.map((link) => link.getBoundingClientRect().height)),
        };
      });
      assert.deepEqual(result.hrefs, ['/', '/random', '/thoughts']);
      assert.equal(result.current, path);
      assert.ok(result.left >= 0);
      assert.ok(result.right <= result.viewportWidth);
      assert.ok(result.documentWidth <= result.viewportWidth);
      assert.ok(result.minimumLinkHeight >= (width <= 640 ? 44 : 40));
    }
  }
  await page.close();
});
