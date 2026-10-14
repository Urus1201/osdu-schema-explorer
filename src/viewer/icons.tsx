export function GraphIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <path d="m31 23-15 26m22-26 18 30" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="34" cy="16" r="9" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="13" cy="56" r="9" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="59" cy="59" r="9" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}
export function DocumentIcon() {
  return (
    <svg viewBox="0 0 36 42" fill="none" aria-hidden="true">
      <path
        d="M8 2h13l9 10v26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M21 2v10h9M12 21h12M12 28h12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
export function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m12 12 5 5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
export function FitIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7 2H2v5m11-5h5v5M2 13v5h5m6 0h5v-5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
