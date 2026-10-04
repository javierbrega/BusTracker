export default function LanguageSwitcher({
  language,
  onChange,
  labels,
  className = '',
}) {
  return (
    <div className={`language-switcher ${className}`} role="group" aria-label={labels.language}>
      <button
        type="button"
        onClick={() => onChange('es')}
        aria-label={labels.spanish}
        aria-pressed={language === 'es'}
        title={labels.spanish}
      >
        <svg className="language-flag flag-argentina" viewBox="0 0 24 16" aria-hidden="true">
          <rect width="24" height="16" fill="#fff" />
          <path fill="#74acdf" d="M0 0h24v5.34H0zm0 10.66h24V16H0z" />
          <circle cx="12" cy="8" r="1.7" fill="#f6b40e" />
          <circle cx="12" cy="8" r=".7" fill="#85340a" />
        </svg>
        <span>ES</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('en')}
        aria-label={labels.english}
        aria-pressed={language === 'en'}
        title={labels.english}
      >
        <svg className="language-flag flag-united-states" viewBox="0 0 24 16" aria-hidden="true">
          <rect width="24" height="16" fill="#fff" />
          <path fill="#b22234" d="M0 0h24v1.23H0zm0 2.46h24v1.23H0zm0 2.46h24v1.23H0zm0 2.46h24v1.23H0zm0 2.46h24v1.23H0zm0 2.46h24v1.23H0zm0 2.46h24V16H0z" />
          <rect width="10.4" height="8.6" fill="#3c3b6e" />
          <g fill="#fff">
            <circle cx="1.6" cy="1.3" r=".35" /><circle cx="4" cy="1.3" r=".35" />
            <circle cx="6.4" cy="1.3" r=".35" /><circle cx="8.8" cy="1.3" r=".35" />
            <circle cx="2.8" cy="2.8" r=".35" /><circle cx="5.2" cy="2.8" r=".35" />
            <circle cx="7.6" cy="2.8" r=".35" /><circle cx="1.6" cy="4.3" r=".35" />
            <circle cx="4" cy="4.3" r=".35" /><circle cx="6.4" cy="4.3" r=".35" />
            <circle cx="8.8" cy="4.3" r=".35" /><circle cx="2.8" cy="5.8" r=".35" />
            <circle cx="5.2" cy="5.8" r=".35" /><circle cx="7.6" cy="5.8" r=".35" />
            <circle cx="1.6" cy="7.3" r=".35" /><circle cx="4" cy="7.3" r=".35" />
            <circle cx="6.4" cy="7.3" r=".35" /><circle cx="8.8" cy="7.3" r=".35" />
          </g>
        </svg>
        <span>EN</span>
      </button>
    </div>
  )
}
