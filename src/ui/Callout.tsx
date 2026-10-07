import type { ReactNode } from "react";

/**
 * What a notice IS, not how loud it should be. `info` explains something the
 * build already decided; `warn` flags something allowed but probably
 * unwanted. Failures are not a tone here — those stay `.error-text`, so that
 * red keeps meaning "this did not work".
 */
export type CalloutTone = "info" | "warn";

/** Drawn with `currentColor` so each tone's own colour reaches the glyph without a second rule per tone. */
function CalloutIcon({ tone }: { readonly tone: CalloutTone }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {tone === "warn" ? (
        <path d="M8 4.5v4.2M8 11.2v.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M8 7.3v4M8 4.8v.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * An inline notice that is worth noticing but is not an error.
 *
 * Exists as a component rather than a bare class so the icon markup lives in
 * one place instead of being pasted at each of its call sites — the icon is
 * what separates a callout from the plain `.hint-text` paragraphs around it.
 */
export function Callout({ tone, children }: { readonly tone: CalloutTone; readonly children: ReactNode }) {
  return (
    <p className="callout" data-tone={tone}>
      <CalloutIcon tone={tone} />
      <span>{children}</span>
    </p>
  );
}
