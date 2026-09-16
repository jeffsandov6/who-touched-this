import editableRouteRegistry from './config/editable-routes.json';
import { CONTRIBUTION_BOUNDARIES } from './config/contribution-boundaries';

export interface NavigationLink {
  readonly href: string;
  readonly label: string;
}

const protectedLinks = [
  { href: '/history', label: 'history' },
  { href: '/faq', label: 'faq' },
  { href: '/rules', label: 'rules' },
  { href: '/join', label: 'join' },
] as const satisfies readonly NavigationLink[];

function normalizePath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '');
}

export function editablePageLinks(routes: readonly string[]): readonly NavigationLink[] {
  const seen = new Set<string>();

  return routes.flatMap((route) => {
    const normalized = normalizePath(route);
    const protectedRoute = CONTRIBUTION_BOUNDARIES.reservedPublicRoutes.some(
      (reserved) => normalized === reserved || normalized.startsWith(`${reserved}/`),
    );

    if (!normalized.startsWith('/') || normalized.includes('//') || normalized.includes('\\')
      || normalized.includes('?') || normalized.includes('#') || protectedRoute || seen.has(normalized)) {
      throw new Error(`Invalid canonical editable route for navigation: ${route}`);
    }

    seen.add(normalized);
    return normalized === '/' ? [] : [{ href: normalized, label: normalized.slice(1) }];
  });
}

export const editableLinks = editablePageLinks(editableRouteRegistry.routes);
export const primaryLinks = [
  { href: '/', label: 'home' },
  { href: '#pages', label: 'pages' },
  ...protectedLinks,
] as const;

export function isExactCurrentPath(currentPath: string, href: string): boolean {
  return normalizePath(currentPath) === href;
}

export function isProtectedCurrentPath(currentPath: string, href: string): boolean {
  const normalized = normalizePath(currentPath);
  return normalized === href || normalized.startsWith(`${href}/`);
}

