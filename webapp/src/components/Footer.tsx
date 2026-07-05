import { useLocale } from '@/lib/i18n';
import { m } from '@/paraglide/messages';
import { GitHubMark, HuggingFaceMark, BuoyMark } from './brands';

const REPO_URL = 'https://github.com/hadim/olatu';
const HF_URL = 'https://huggingface.co/buckets/hadim/olatu';
const CANDHIS_URL = 'https://candhis.cerema.fr';
const LINK = 'inline-flex items-center gap-1.5 text-muted no-underline transition-colors hover:text-accent';

// Build stamp: format the deployed commit's calendar date in the active locale. Uses a
// fixed UTC noon (not a bare `new Date(iso)`) so the displayed day never tz-shifts — this
// is build metadata, not a buoy reading.
function formatCommitDate(iso: string, locale: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return '';
  const [, y, mo, d] = parts;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12));
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(dt);
}

function Sep() {
  return (
    <span className="text-divider" aria-hidden="true">
      ·
    </span>
  );
}

export default function Footer() {
  const { locale } = useLocale();
  const hasBuild = __COMMIT_HASH__ !== 'dev' && __COMMIT_DATE__ !== '';
  const built = __COMMIT_DATE__ ? formatCommitDate(__COMMIT_DATE__, locale) : '';

  return (
    <footer className="mt-10 flex flex-col gap-2.5 border-t border-line pt-5 text-[0.86rem] text-faint">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <a className={`font-semibold ${LINK}`} href={REPO_URL} target="_blank" rel="noopener noreferrer">
          <GitHubMark size={17} />
          <span>{m.footer_open_source()}</span>
        </a>
        <Sep />
        <a className={LINK} href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
          {m.footer_report_bug()}
        </a>
        <Sep />
        <a className={LINK} href={HF_URL} target="_blank" rel="noopener noreferrer">
          <HuggingFaceMark size={16} />
          <span>{m.footer_dataset()}</span>
        </a>
        <Sep />
        <a className={LINK} href={CANDHIS_URL} target="_blank" rel="noopener noreferrer">
          <BuoyMark size={16} />
          <span>{m.footer_data_by()} Cerema / CANDHIS</span>
        </a>
      </div>

      {/* Discreet build stamp — which commit is live, and when it shipped. */}
      <div className="text-[0.76rem] text-faint/80">
        {hasBuild ? (
          <a
            className="font-mono no-underline hover:text-accent"
            href={`${REPO_URL}/commit/${__COMMIT_HASH__}`}
            target="_blank"
            rel="noopener noreferrer"
            title={m.footer_build_title()}
          >
            {m.footer_build()} {__COMMIT_HASH__}
            {built ? ` · ${built}` : ''}
          </a>
        ) : (
          <span className="font-mono">{m.footer_build()} dev</span>
        )}
      </div>
    </footer>
  );
}
