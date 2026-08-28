/** @jsxImportSource react */

interface NavigationProps {
  currentPath: string;
}

const links = [
  { href: '/', label: 'Home' },
  { href: '/history', label: 'History' },
  { href: '/faq', label: 'FAQ' },
  { href: '/rules', label: 'Rules' },
  { href: '/join', label: 'Join' },
] as const;

export default function Navigation({ currentPath }: NavigationProps) {
  const isCurrent = (href: string): boolean =>
    href === '/'
      ? currentPath === href
      : currentPath === href || currentPath.startsWith(`${href}/`);

  return (
    <nav className="platform-navigation" aria-label="Primary navigation">
      <a className="site-name" href="/">
        Who Touched This
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
