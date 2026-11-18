/** Single switch for retained, unvalidated tracking tools. Keep false for production. */
export const EXPERIMENTAL_FEATURES=false;

/**
 * Speed Check (release-to-bat average speed). Unvalidated against radar, so it stays off in
 * production. Enable locally with NEXT_PUBLIC_SPEED_CHECK=1 (e.g. in .env.local) to try it.
 */
export const SPEED_CHECK=EXPERIMENTAL_FEATURES||process.env.NEXT_PUBLIC_SPEED_CHECK==="1";
