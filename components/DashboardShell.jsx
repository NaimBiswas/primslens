import Link from 'next/link';
import styles from '../app/code-review/dashboard.module.css';

// Shared sidebar/shell for every dashboard page (Code Review, Automation,
// Models, Recent Activity, Pending Approvals) — each now its own real route
// instead of one page switching client-side tab state, so a
// link/bookmark/refresh lands back on the same section instead of always
// resetting to Code Review.
export const NAV_TABS = [
  { key: 'review', label: 'Code Review', href: '/code-review' },
  { key: 'automation', label: 'Automation', href: '/automation' },
  { key: 'activity', label: 'Recent Activity', href: '/activity' },
  { key: 'pending-approvals', label: 'Pending Approvals', href: '/pending-approvals' },
  { key: 'models', label: 'Model', href: '/models' },
];

export default function DashboardShell({ active, children }) {
  const current = NAV_TABS.find((t) => t.key === active);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.sidebarBrand}>
          <svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="sidebarRimGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#05d9e8" />
                <stop offset="50%" stopColor="#b137fc" />
                <stop offset="100%" stopColor="#ff2a6d" />
              </linearGradient>
            </defs>
            <circle cx="36" cy="36" r="22" fill="rgba(255,255,255,0.04)" stroke="url(#sidebarRimGrad)" strokeWidth="3.6" />
            <line x1="21" y1="29" x2="27" y2="29" stroke="#ff4d4d" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="30" y1="29" x2="49" y2="29" stroke="#ff4d4d" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
            <line x1="21" y1="44" x2="27" y2="44" stroke="#00ffa3" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="24" y1="41" x2="24" y2="47" stroke="#00ffa3" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="30" y1="44" x2="51" y2="44" stroke="#00ffa3" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
            <line x1="53" y1="53" x2="80" y2="80" stroke="url(#sidebarRimGrad)" strokeWidth="7" strokeLinecap="round" />
          </svg>
          <span className={styles.sidebarWord}>PRISMLENS</span>
        </Link>

        <nav className={styles.nav}>
          {NAV_TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className={`${styles.navItem} ${active === t.key ? styles.navItemActive : ''}`}
              aria-current={active === t.key ? 'page' : undefined}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className={styles.content}>
        <div className={styles.contentInner}>
          <h1 className={styles.pageTitle}>{current?.label}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
