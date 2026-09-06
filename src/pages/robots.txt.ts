import { robotsText } from '../platform/config/site-indexing';

export const prerender = true;

export function GET() {
  const body = robotsText(import.meta.env.PUBLIC_SITE_INDEXING_ENABLED);
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
