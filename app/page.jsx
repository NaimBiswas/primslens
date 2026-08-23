import Link from 'next/link';
import Reveal from '../components/Reveal.jsx';
import styles from './landing.module.css';

export const metadata = {
  title: 'PrismLens — AI Code Review',
  description: 'PrismLens reviews every PR across 6 dimensions, chats through the fixes, and acts on GitHub directly — comment, approve, merge.',
};

const DIMENSIONS = [
  { icon: '⚡', label: 'Performance', desc: 'Nested loops, blocking I/O, heavy spread and JSON work — caught before they ship.' },
  { icon: '🔒', label: 'Security', desc: 'eval() and injection risk, hardcoded secrets, unsanitized input — flagged in the diff.' },
  { icon: '📖', label: 'Readability', desc: 'Deep nesting, magic numbers, sprawling change blocks — noted for the next reader.' },
  { icon: '🐛', label: 'Bugs', desc: 'Loose equality, unhandled promise rejections, NaN comparisons — the classics.' },
  { icon: '📊', label: 'Scalability', desc: 'N+1 async patterns, sync I/O, unbounded in-memory ops — before they’re load-bearing.' },
  { icon: '✅', label: 'Best Practices', desc: 'Deprecated APIs, missing input validation, unguarded state mutation.' },
];

export default function LandingPage() {
  return (
    <>
      <div
        aria-hidden="true"
        style={{ display: 'none' }}
        dangerouslySetInnerHTML={{
          __html: `<!--
        THESIS: The verdict is the hero, not the pitch — visitors see PrismLens
        render a real judgment before a word of marketing copy, refusing the
        generic headline+feature-grid SaaS opener.
        OWN-WORLD: Near-black glass (#0a0a0f), neon pink/blue/purple/green/red,
        Orbitron display + JetBrains Mono data type, glassmorphic cards with
        radial-glow body + grid overlay — the exact system already running
        the review screen.
        STORY: A team lead sees a real verdict box glow into view, believes
        PrismLens renders a decisive judgment (not vague "insights"), and
        clicks through to run it on their own PR.
        FIRST VIEWPORT: Slim nav (mark + wordmark left, CTA right); centered
        below, a hero-scale recommendation box (REVIEW styling, full glow)
        with a one-line thesis beneath it and a scroll cue.
        FORM: Verdict-led hero — surface candidate #6 of my ranked 7, dealt
        lead (indices 6/5/4); seed key bb136b2f.
        FINISH: unreviewed and undocumented is unfinished; this build ends
        with the finish review, the verdict, DESIGN.md, and every shipping
        raster carrying its provenance.
      -->`,
        }}
      />
      <nav className={styles.nav}>
        <div className={styles.navBrand}>
          <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="navRimGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#05d9e8" />
                <stop offset="50%" stopColor="#b137fc" />
                <stop offset="100%" stopColor="#ff2a6d" />
              </linearGradient>
            </defs>
            <circle cx="36" cy="36" r="22" fill="rgba(255,255,255,0.04)" stroke="url(#navRimGrad)" strokeWidth="3.6" />
            <line x1="21" y1="29" x2="27" y2="29" stroke="#ff4d4d" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="30" y1="29" x2="49" y2="29" stroke="#ff4d4d" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
            <line x1="21" y1="44" x2="27" y2="44" stroke="#00ffa3" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="24" y1="41" x2="24" y2="47" stroke="#00ffa3" strokeWidth="3.4" strokeLinecap="round" />
            <line x1="30" y1="44" x2="51" y2="44" stroke="#00ffa3" strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
            <line x1="53" y1="53" x2="80" y2="80" stroke="url(#navRimGrad)" strokeWidth="7" strokeLinecap="round" />
          </svg>
          <span className={styles.navWord}>PRISMLENS</span>
        </div>
        <Link href="/code-review" className={`btn ${styles.navCta}`}>Start a Review</Link>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroVerdict}>
          <span className={styles.heroVerdictIcon} aria-hidden="true">⚠</span>
          <div className={styles.heroVerdictTitle}>REVIEW REQUIRED</div>
          <div className={styles.heroVerdictReason}>Address 5 concern(s) before merging</div>
        </div>
        <p className={styles.heroTagline}>
          Every PR gets a verdict — <strong>APPROVE</strong>, <strong>REVIEW</strong>, or <strong>REJECT</strong>.
          <br />Here&rsquo;s how PrismLens gets there.
        </p>
        <div className={styles.scrollCue} aria-hidden="true" />
      </section>

      <section className={styles.section}>
        <Reveal>
          <h2 className={styles.sectionHeading}>One diff. Six angles of scrutiny.</h2>
        </Reveal>
        <div className={styles.dimGrid}>
          {DIMENSIONS.map((d, i) => (
            <Reveal key={d.label} delay={i * 80}>
              <div className={styles.dimCard}>
                <span className={styles.dimIcon} aria-hidden="true">{d.icon}</span>
                <div className={styles.dimLabel}>{d.label}</div>
                <p className={styles.dimDesc}>{d.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Findings become fixes.</h2>
        <div className={styles.chatDemo}>
          <div className="chat-msg chat-msg-user">
            <div className="chat-msg-avatar">U</div>
            <div className="chat-msg-body">
              <div className="chat-msg-text">fix #1</div>
            </div>
          </div>
          <div className="chat-msg chat-msg-assistant" style={{ marginTop: '0.6rem' }}>
            <div className="chat-msg-avatar">P</div>
            <div className="chat-msg-body">
              <div className="chat-msg-text">
                Swap <code className="chat-inline-code">==</code> for <code className="chat-inline-code">===</code> in{' '}
                <code className="chat-inline-code">src/lib/rate-limit.ts:42</code>. Want me to open a diff?
              </div>
            </div>
          </div>
          <div className={styles.demoCaption}>example conversation</div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Review it. Then ship it.</h2>
        <div className={styles.actionsRow}>
          <div className={styles.actionItem}>
            <div className="btn btn-comment">Comment</div>
            <p className={styles.actionCaption}>Post the review as a GitHub PR comment.</p>
          </div>
          <div className={styles.actionItem}>
            <div className="btn btn-approve">Approve</div>
            <p className={styles.actionCaption}>Shown when PrismLens says APPROVE.</p>
          </div>
          <div className={styles.actionItem}>
            <div className="btn btn-merge">Merge</div>
            <p className={styles.actionCaption}>One click, straight from the results screen.</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <p className={styles.cliLead}>Prefer the terminal? Same analyzer, same 6 dimensions.</p>
        <div className={styles.cliStrip}>
          <span className={styles.cliPrompt}>npm run review https://github.com/org/repo/pull/42</span>
        </div>
      </section>

      <section className={styles.finalCta}>
        <p className={styles.finalCtaTagline}>every diff, under the lens.</p>
        <Link href="/code-review" className="btn">Start a Review →</Link>
      </section>

      <footer className={styles.footer}>PRISMLENS · CODE REVIEW, REFRACTED</footer>
    </>
  );
}
