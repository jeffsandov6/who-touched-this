import { readFile } from 'node:fs/promises';

const PLACEHOLDER = /(^|[_-])(replace|placeholder|example|demo|your)([_-]|$)|<[^>]+>/i;

export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`Malformed environment line: ${rawLine}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export async function loadEnvFile(path, label) {
  try { return parseEnvFile(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is missing or invalid at ${path}: ${error.message}`); }
}

export function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('APP_ORIGIN must be a valid URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('APP_ORIGIN must be an HTTPS origin without credentials, path, query, or hash.');
  }
  return url.origin;
}

export function validateProductionSolanaRpcUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('WTT_SOLANA_RPC_URL must be a valid URL.'); }
  const hostname = url.hostname.toLowerCase();
  const endpoint = `${hostname}${url.pathname}${url.search}`.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (url.protocol !== 'https:' || url.username || url.password || !hostname
    || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
    || hostname.endsWith('.local') || endpoint.includes('devnet')
    || endpoint.includes('testnet') || privateIpv4) {
    throw new Error('WTT_SOLANA_RPC_URL must be a public HTTPS mainnet endpoint without embedded credentials.');
  }
  return url.toString();
}

function requireValue(environment, name) {
  const value = environment[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required production value: ${name}`);
  if (PLACEHOLDER.test(value)) throw new Error(`Production value is still a placeholder: ${name}`);
  return value.trim();
}

export function validateProductionEnvironment(browser, functionsConfig) {
  const requiredBrowser = [
    'PUBLIC_FIREBASE_API_KEY', 'PUBLIC_FIREBASE_AUTH_DOMAIN', 'PUBLIC_FIREBASE_PROJECT_ID',
    'PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'PUBLIC_FIREBASE_APP_ID', 'PUBLIC_FIREBASE_STORAGE_BUCKET',
    'PUBLIC_USE_FIREBASE_EMULATORS', 'PUBLIC_SITE_INDEXING_ENABLED', 'APP_ORIGIN',
  ];
  for (const name of requiredBrowser) requireValue(browser, name);
  if (browser.PUBLIC_FIREBASE_PROJECT_ID !== 'who-touched-this') throw new Error('Production Firebase project must be who-touched-this.');
  if (/^(demo-|emulator)/i.test(browser.PUBLIC_FIREBASE_PROJECT_ID)) throw new Error('Demo/emulator Firebase projects are forbidden.');
  if (browser.PUBLIC_USE_FIREBASE_EMULATORS !== 'false') throw new Error('Production emulator mode must be false.');
  if (!['true', 'false'].includes(browser.PUBLIC_SITE_INDEXING_ENABLED)) throw new Error('PUBLIC_SITE_INDEXING_ENABLED must be true or false.');
  if (browser.PUBLIC_CONTRIBUTOR_PREVIEW === 'true' || browser.MODE === 'contributor') throw new Error('Contributor-preview mode is forbidden for production release.');
  if (normalizeOrigin(browser.APP_ORIGIN) !== 'https://whotouchedthis.website') throw new Error('Production APP_ORIGIN must be https://whotouchedthis.website.');

  for (const name of ['EMAIL_PROVIDER_MODE', 'APP_ORIGIN', 'GITHUB_REPOSITORY', 'GITHUB_BASE_BRANCH']) requireValue(functionsConfig, name);
  if (functionsConfig.EMAIL_PROVIDER_MODE !== 'resend') throw new Error('Production Functions must use EMAIL_PROVIDER_MODE=resend.');
  if (normalizeOrigin(functionsConfig.APP_ORIGIN) !== 'https://whotouchedthis.website') throw new Error('Functions APP_ORIGIN is incorrect.');
  if (functionsConfig.GITHUB_REPOSITORY !== 'jeffsandov6/who-touched-this') throw new Error('Functions canonical GitHub repository is incorrect.');
  if (functionsConfig.GITHUB_BASE_BRANCH !== 'main') throw new Error('Functions base branch must be main.');
  return { indexingEnabled: browser.PUBLIC_SITE_INDEXING_ENABLED === 'true' };
}

export function validateNodeVersion(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error('Unable to parse Node.js version.');
  const [, major, minor] = match.map(Number);
  if (major !== 22 || minor < 12) throw new Error('Release tooling requires Node.js 22.12 or newer within Node 22.');
  return true;
}
