/** @jsxImportSource react */

interface NavigationProps {
  currentPath: string;
}

const links = [
  { href: '/', label: 'home' },
  { href: '/history', label: 'history' },
  { href: '/faq', label: 'faq' },
  { href: '/rules', label: 'rules' },
  { href: '/join', label: 'join' },
] as const;

export default function Navigation({ currentPath }: NavigationProps) {
  const isCurrent = (href: string): boolean =>
    href === '/'
      ? currentPath === href
      : currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <nav className="platform-navigation" aria-label="primary navigation">
      <a className="site-name" href="/">
        who touched this
      </a>
      <ul>
        {links.map(({ href, label }) => (
          <li key={href}>
            <a href={href} aria-current={isCurrent(href) ? 'page' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
