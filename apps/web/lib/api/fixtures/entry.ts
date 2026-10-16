/**
 * The fixture adapter, behind one import that next.config.ts aliases to ./none in live builds, so a
 * live bundle carries no sample data at all. Tests and fixtures builds resolve it to the real adapter.
 */
export { createFixtureApi } from "./adapter";
