import Link from "next/link";

/** Flipper wordmark: a seam-split ball and condensed lettering. */
export function Brand({ href = "/", light = true }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2.5" aria-label="Flipper home">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="var(--color-gold)" />
        <path d="M9 4.5c5 6.5 5 16.5 0 23M23 4.5c-5 6.5-5 16.5 0 23" fill="none" stroke="var(--color-navy)" strokeWidth="1.6" strokeDasharray="2 1.6" />
      </svg>
      <span className={`text-xl font-bold tracking-tight ${light ? "text-white" : "text-navy"}`}>
        Flipper
      </span>
    </Link>
  );
}
