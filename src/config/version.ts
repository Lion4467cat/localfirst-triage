/**
 * Single source of truth for the product version. Injected at build/test time
 * from package.json (see vite.config.ts) so UI copy cannot drift again.
 */
export const APP_VERSION: string = __APP_VERSION__;
