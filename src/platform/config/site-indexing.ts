export function isSiteIndexingEnabled(value: unknown): boolean {
  return value === 'true';
}

export function robotsMetaContent(value: unknown): string | undefined {
  return isSiteIndexingEnabled(value) ? undefined : 'noindex, nofollow';
}

export function robotsText(value: unknown): string {
  return isSiteIndexingEnabled(value)
    ? 'User-agent: *\nAllow: /\n'
    : 'User-agent: *\nDisallow: /\n';
}
