/**
 * Where to inject <InteractiveTutorial /> on the single Reference page.
 * `after` is matched against a line prefix in reference/REFERENCE.md (first match).
 */
export const playgroundPlacements = [
	{ after: '### makeHsm', exampleId: '01-hello-state-machine', importName: 'helloPlayground' },
	{ after: '## 6. Tracing', exampleId: '02-tracing', importName: 'tracingPlayground' },
	{ after: '### Context', exampleId: '03-context', importName: 'contextPlayground' },
	{ after: '## 3. Static type checking', exampleId: '04-protocol-typing', importName: 'protocolPlayground' },
	{ after: '## 5. Transitions', exampleId: '05-hierarchy', importName: 'hierarchyPlayground' },
	{ after: '### Internal transitions', exampleId: '07-internal-transitions', importName: 'internalPlayground' },
	{ after: '### `sync()`', exampleId: '08-post-and-sync', importName: 'postSyncPlayground' },
	{ after: '### `deferredPost(millis, event, ...payload)`', exampleId: '09-deferred-post', importName: 'deferredPlayground' },
	{
		after: '### `call(service, ...payload)` — typed request/response',
		exampleId: '10-call-services',
		importName: 'callPlayground',
	},
	{ after: '## 7. restore', exampleId: '11-restore', importName: 'restorePlayground' },
	{ after: '## 8. Error model', exampleId: '12-error-recovery', importName: 'errorPlayground' },
	{ after: '## 9. Async handlers', exampleId: '13-async-handlers', importName: 'asyncPlayground' },
	{ after: '### Orthogonal regions', exampleId: '14-nested-machines', importName: 'nestedPlayground' },
	{ after: '### Rules of thumb', exampleId: '15-complex-workflow', importName: 'workflowPlayground' },
	{ after: '### `postNow(event, ...payload)`', exampleId: '17-post-now', importName: 'postNowPlayground' },
];
