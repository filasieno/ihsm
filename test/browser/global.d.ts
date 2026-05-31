export {};

declare global {
	interface Window {
		__IHSM_TEST_ENV__?: 'browser-min';
		__TEST_DONE__?: { failures: number; status: 'pass' | 'fail' };
	}
	var __IHSM_TEST_ENV__: 'browser-min' | undefined;
	var __TEST_DONE__: { failures: number; status: 'pass' | 'fail' } | undefined;
}
