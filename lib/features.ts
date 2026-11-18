/** Single switch for retained, unvalidated tracking tools. Keep false for production. */
export const EXPERIMENTAL_FEATURES=false;

/**
 * Speed Check (release-to-bat average speed). Switched on in production at the owner's request
 * (November 2026) so it can be tried on real deliveries. It is not validated against radar; the page
 * says so and refuses when a clip cannot be measured. Set to false to show "In progress" again.
 */
export const SPEED_CHECK=true;
