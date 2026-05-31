/** Stub so esbuild does not bundle Node mocha; real mocha is loaded from the HTML shell. */
(globalThis as typeof globalThis & { __IHSM_MOCHA_STUB__?: boolean }).__IHSM_MOCHA_STUB__ = true;

export {};
