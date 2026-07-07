import { useEffect, type ReactNode } from 'react';
import { m } from '@/paraglide/messages';
import { Button } from '@/components/ui/button';
import { useConsent, setConsent } from '@/lib/analytics';
import { routeHref, type Route } from '@/lib/route';

// Static legal pages (spec 0011): mentions légales, privacy policy, contact. One component
// switches on the route so they share a single prose layout, "back to Olatu" link and
// scroll-to-top. Content is fully translated (EN/FR/ES) via Paraglide. The publisher is an
// individual (Hadrien Mary); contact is routed through the project's GitHub.

const REPO_URL = 'https://github.com/hadim/olatu';
const GITHUB_PROFILE = 'https://github.com/hadim';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="m-0 font-display text-[1.15rem] font-semibold text-fg">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-[0.95rem] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent-deep"
    >
      {children}
    </a>
  );
}

function LegalNotice() {
  return (
    <>
      <Section title={m.legal_publisher_h()}>
        <p>{m.legal_publisher_body()}</p>
      </Section>
      <Section title={m.legal_director_h()}>
        <p>{m.legal_director_body()}</p>
      </Section>
      <Section title={m.legal_contact_h()}>
        <p>
          {m.legal_contact_body()}{' '}
          <a href={routeHref('contact')} className="text-accent underline underline-offset-2 hover:text-accent-deep">
            {m.contact_title()}
          </a>
          .
        </p>
      </Section>
      <Section title={m.legal_host_h()}>
        <p>{m.legal_host_body()}</p>
      </Section>
      <Section title={m.legal_ip_h()}>
        <p>{m.legal_ip_body()}</p>
      </Section>
    </>
  );
}

function ConsentControls() {
  const consent = useConsent();
  const status =
    consent === 'granted'
      ? m.privacy_manage_granted()
      : consent === 'denied'
        ? m.privacy_manage_denied()
        : m.privacy_manage_unset();
  return (
    <div className="mt-1 rounded-2xl border border-line p-4">
      <p className="m-0 text-[0.95rem] text-fg">{status}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={consent === 'granted' ? 'solid' : 'outline'} onClick={() => setConsent('granted')}>
          {m.consent_accept()}
        </Button>
        <Button variant={consent === 'denied' ? 'solid' : 'outline'} onClick={() => setConsent('denied')}>
          {m.consent_decline()}
        </Button>
      </div>
    </div>
  );
}

function Privacy() {
  return (
    <>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">{m.privacy_intro()}</p>
      <Section title={m.privacy_analytics_h()}>
        <p>{m.privacy_analytics_body()}</p>
      </Section>
      <Section title={m.privacy_cookies_h()}>
        <p>{m.privacy_cookies_body()}</p>
      </Section>
      <Section title={m.privacy_legal_basis_h()}>
        <p>{m.privacy_legal_basis_body()}</p>
      </Section>
      <Section title={m.privacy_transfer_h()}>
        <p>{m.privacy_transfer_body()}</p>
      </Section>
      <Section title={m.privacy_rights_h()}>
        <p>{m.privacy_rights_body()}</p>
      </Section>
      <Section title={m.privacy_manage_h()}>
        <ConsentControls />
      </Section>
    </>
  );
}

function Contact() {
  return (
    <Section title={m.contact_reach_h()}>
      <p>{m.contact_body()}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        <li>
          <ExtLink href={`${REPO_URL}/issues`}>{m.contact_issues()}</ExtLink>
        </li>
        <li>
          <ExtLink href={REPO_URL}>{m.contact_repo()}</ExtLink>
        </li>
        <li>
          <ExtLink href={GITHUB_PROFILE}>{m.contact_profile()}</ExtLink>
        </li>
      </ul>
    </Section>
  );
}

const TITLES: Record<Exclude<Route, 'home'>, () => string> = {
  legal: m.legal_title,
  privacy: m.privacy_title,
  contact: m.contact_title,
};

export default function LegalPage({ route }: { route: Exclude<Route, 'home'> }) {
  // Land at the top when arriving on a legal page (hash nav doesn't reset scroll on its own).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <main className="mt-6 max-w-[72ch]">
      <a
        href={routeHref('home')}
        className="inline-flex items-center gap-1 text-[0.9rem] text-muted no-underline transition-colors hover:text-accent"
      >
        <span aria-hidden="true">←</span> {m.nav_back_home()}
      </a>

      <h1 className="mt-4 mb-0 font-display text-[1.7rem] font-bold tracking-[-0.015em] text-fg">
        {TITLES[route]()}
      </h1>

      {route === 'legal' && <LegalNotice />}
      {route === 'privacy' && <Privacy />}
      {route === 'contact' && <Contact />}
    </main>
  );
}
