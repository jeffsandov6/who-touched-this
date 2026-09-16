/** @jsxImportSource react */

import './CanvasPageNavigation.css';

type CanvasPath = '/' | '/random' | '/thoughts';

interface CanvasPageNavigationProps {
  currentPath: CanvasPath;
}

const links = [
  { href: '/', label: 'home' },
  { href: '/random', label: 'random' },
  { href: '/thoughts', label: 'thoughts' },
] as const;

export default function CanvasPageNavigation({ currentPath }: CanvasPageNavigationProps) {
  return (
    <nav className="canvas-page-navigation" aria-label="Editable pages">
      <p className="canvas-page-navigation-label">elsewhere:</p>
      <ul>
        {links.map(({ href, label }) => (
          <li key={href}>
            <a href={href} aria-current={currentPath === href ? 'page' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
