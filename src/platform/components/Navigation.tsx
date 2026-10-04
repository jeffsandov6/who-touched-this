/** @jsxImportSource react */

import { editableLinks, isExactCurrentPath, isProtectedCurrentPath } from '../navigation';

interface NavigationProps {
  currentPath: string;
}

const protectedLinks = [
  { href: '/history', label: 'history' },
  { href: '/faq', label: 'faq' },
  { href: '/rules', label: 'rules' },
  { href: '/join', label: 'join' },
  { href: '/wtt/claim', label: '$wtt' },
] as const;

export default function Navigation({ currentPath }: NavigationProps) {
  const pagesAreCurrent = editableLinks.some(({ href }) => isExactCurrentPath(currentPath, href));

  return (
    <nav className="platform-navigation" aria-label="primary navigation" data-pages-navigation>
      <a className="site-name" href="/">
        who touched this
      </a>
      <ul className="primary-navigation-links">
        <li>
          <a href="/" aria-current={isExactCurrentPath(currentPath, '/') ? 'page' : undefined}>
            home
          </a>
        </li>
        <li className="pages-navigation">
          <button
            className="pages-navigation-trigger"
            type="button"
            aria-expanded="false"
            aria-controls="editable-pages-navigation"
            aria-current={pagesAreCurrent ? 'page' : undefined}
            data-pages-trigger
          >
            pages
          </button>
          <div className="pages-navigation-dropdown" id="editable-pages-navigation" data-pages-dropdown hidden>
            <p className="pages-navigation-label">more editable pages</p>
            <ul className="pages-navigation-list">
              {editableLinks.map(({ href, label }) => (
                <li key={href}>
                  <a href={href} aria-current={isExactCurrentPath(currentPath, href) ? 'page' : undefined}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </li>
        {protectedLinks.map(({ href, label }) => (
          <li key={href}>
            <a href={href} aria-current={isProtectedCurrentPath(currentPath, href) ? 'page' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
