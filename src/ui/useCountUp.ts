/**
 * Counts a stat tile's number up from zero when it first appears.
 *
 * WHY this is JavaScript and not CSS like every other animation in the app:
 * CSS can animate a number's appearance but not its VALUE, and the point here
 * is that the figure itself climbs. That also means the app-wide
 * `prefers-reduced-motion` guard in `app.css` — which only neutralises CSS
 * durations — cannot cover it, so this module honours that preference itself.
 */

import { useEffect, useState } from "react";

/** Long enough to register as motion, short enough that it never delays reading the number. */
const COUNT_UP_DURATION_MS = 400;

/** Fast at first, settling at the end, so the number lands instead of stopping dead. Input outside [0, 1] is clamped, which is what makes {@link countUpValueAt} safe at both ends. */
export function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) ** 3;
}

/**
 * The whole number to display `elapsedMs` into a count-up toward `target`.
 *
 * Inputs: `target`, the final value; `elapsedMs`, time since the count began;
 * `durationMs`, how long the climb lasts.
 * Output: `target` scaled by the eased progress, rounded — `0` at the start
 * and exactly `target` at or after `durationMs`.
 * Failure modes: none. A non-positive `durationMs` resolves to `target`
 * immediately rather than dividing by zero, and out-of-range elapsed times
 * clamp instead of overshooting.
 */
export function countUpValueAt(target: number, elapsedMs: number, durationMs: number = COUNT_UP_DURATION_MS): number {
  if (durationMs <= 0) return target;
  return Math.round(target * easeOutCubic(elapsedMs / durationMs));
}

/** Whether this visitor has asked the system for less motion. Read per animation rather than cached, since it can change while the page is open. */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The current value of a count-up toward `target`, restarting whenever `target` changes. Returns `target` unchanged when reduced motion is preferred. */
export function useCountUp(target: number): number {
  const [displayed, setDisplayed] = useState(target);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplayed(target);
      return;
    }

    // The first callback's own timestamp is the start, so the opening frame is
    // always 0 elapsed — reading the clock at effect time instead skips
    // however long it takes for the next frame to arrive.
    let startedAt: number | undefined;
    let frame = 0;

    function step(now: number): void {
      startedAt ??= now;
      const elapsed = now - startedAt;
      setDisplayed(countUpValueAt(target, elapsed));
      if (elapsed < COUNT_UP_DURATION_MS) frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return displayed;
}
