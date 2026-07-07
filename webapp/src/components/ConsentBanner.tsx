import { m } from '@/paraglide/messages';
import { Button } from '@/components/ui/button';
import { useConsent, setConsent } from '@/lib/analytics';
import { routeHref } from '@/lib/route';

// GDPR consent banner (spec 0011). Shows only until the visitor decides; the choice is
// persisted, so it never reappears once answered (change it later on the privacy page).
// "Decline" is as prominent as "Accept" (equal-ease requirement), and analytics is not
// loaded until "Accept" is clicked.
export default function ConsentBanner() {
  const consent = useConsent();
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={m.consent_title()}
      className="fixed inset-x-0 bottom-0 z-50 animate-[slide-in_0.3s_ease] border-t border-line bg-surface/95 backdrop-blur-sm shadow-[0_-6px_24px_-12px_rgba(0,0,0,0.6)]"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 max-w-[62ch] text-[0.9rem] leading-snug text-muted">
          {m.consent_text()}{' '}
          <a
            href={routeHref('privacy')}
            className="text-accent underline underline-offset-2 hover:text-accent-deep"
          >
            {m.consent_learn_more()}
          </a>
        </p>
        <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:*:flex-1">
          <Button variant="outline" onClick={() => setConsent('denied')}>
            {m.consent_decline()}
          </Button>
          <Button variant="solid" onClick={() => setConsent('granted')}>
            {m.consent_accept()}
          </Button>
        </div>
      </div>
    </div>
  );
}
