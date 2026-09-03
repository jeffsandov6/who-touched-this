export const SNAPSHOT_CONFIG = Object.freeze({
  manifestSchemaVersion: 1,
  routeRegistryPath: 'src/platform/config/editable-routes.json',
  artifactRoot: '.wtt/snapshots',
  viewport: Object.freeze({ width: 1440, height: 900 }),
  deviceScaleFactor: 1,
  fullPage: true,
  format: 'png',
  locale: 'en-US',
  timezoneId: 'UTC',
  defaultWaitMs: 1500,
  maximumWaitMs: 10_000,
  navigationTimeoutMs: 30_000,
  serverStartupTimeoutMs: 15_000,
});

