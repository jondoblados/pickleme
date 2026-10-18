export function Wordmark({ small = false }: { small?: boolean }) {
  return (
    <span className={`wordmark${small ? ' wordmark-sm' : ''}`}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="ball">
        <circle cx="16" cy="16" r="14" fill="var(--ball)" stroke="currentColor" strokeWidth="2" />
        <g fill="currentColor"><circle cx="11" cy="11" r="2" /><circle cx="20" cy="9.5" r="2" /><circle cx="16" cy="16" r="2" />
          <circle cx="10" cy="20" r="2" /><circle cx="21.5" cy="19.5" r="2" /><circle cx="15.5" cy="24" r="1.6" /></g>
      </svg>
      <span>Pickle<b>Me</b></span>
    </span>
  )
}
