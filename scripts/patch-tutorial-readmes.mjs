#!/usr/bin/env node
/**
 * Injects "## Reading the trace" sections and fixes tutorial cross-links after renumbering.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? '.', '..');
const tutorials = join(root, 'tutorials');

/** @type {Record<string, { title: string, notice: string, next?: string }>} */
const META = {
	'01-hello-state-machine': {
		title: '01 · Hello state machine',
		notice:
			'`initialize` descends to `Closed`. Each `post` opens a `#open` / `#close` domain. After the handler, `requested transition` and `started transition` show the LCA path; `final state is` confirms the new leaf.',
		next: '../02-tracing/README.md',
	},
	'02-tracing': {
		title: '02 · Tracing',
		notice:
			'This tutorial **is** the trace primer. Lines mirror `ConsoleTraceWriter` format. Handlers may call `this.traceWriter.write(...)` for domain logs. Compare `DEBUG` (boundaries only) vs `VERBOSE_DEBUG` (cache hits, skipped onEntry, etc.).',
		next: '../03-context/README.md',
	},
	'03-context': {
		title: '03 · Context',
		notice:
			'`#increment` runs handler + `execute` domain but **no** `requested transition` — internal transition; only `ctx.value` changes.',
		next: '../04-protocol-typing/README.md',
	},
	'04-protocol-typing': {
		title: '04 · Protocol typing',
		notice:
			'Same internal pattern as context: `#setTarget` handler completes without a transition block.',
		next: '../05-hierarchy/README.md',
	},
	'05-hierarchy': {
		title: '05 · Hierarchy',
		notice:
			'Init walks the initial chain (`DeepTop` → `BranchSouth` → `MidSouth` → `LeafSouthA`). `#tick` is internal — no transition section.',
		next: '../06-transitions-entry-exit/README.md',
	},
	'06-transitions-entry-exit': {
		title: '06 · Entry & exit',
		notice:
			'`#goToB` ends with `started transition from A to B` — sibling LCA. VERBOSE_DEBUG lists each `onExit` / `onEntry` (or skipped).',
		next: '../07-internal-transitions/README.md',
	},
	'07-internal-transitions': {
		title: '07 · Internal transitions',
		notice:
			'`#dim` adjusts brightness with no transition lines — state class stays `On`.',
		next: '../08-post-and-sync/README.md',
	},
	'08-post-and-sync': {
		title: '08 · Post & sync',
		notice:
			'`#start` finishes before `#tick` / `#done` dispatches appear — FIFO mailbox, not re-entrant `post` from inside the handler.',
		next: '../09-deferred-post/README.md',
	},
	'09-deferred-post': {
		title: '09 · Deferred post',
		notice:
			'`#scheduleReminder` returns immediately; `#deliver` appears later as its own dispatch after the timer fires.',
		next: '../10-call-services/README.md',
	},
	'10-call-services': {
		title: '10 · Call services',
		notice:
			'`#getBalance` is a service dispatch (same queue as events). Caller `await call(...)` resolves when the handler calls `resolve(...)`.',
		next: '../11-restore/README.md',
	},
	'11-restore': {
		title: '11 · Restore',
		notice:
			'`restore()` does **not** emit trace — it is a meta-operation. After rehydration, `#navigate` behaves like any normal event dispatch.',
		next: '../12-error-recovery/README.md',
	},
	'12-error-recovery': {
		title: '12 · Error recovery',
		notice:
			'`#risky` throws → `error recovery` domain → `onError` → machine stays in `Working` when recovery succeeds.',
		next: '../13-async-handlers/README.md',
	},
	'13-async-handlers': {
		title: '13 · Async handlers',
		notice:
			'`#load` handler execution stays open until `await` completes; transition runs only after the Promise resolves.',
		next: '../14-nested-machines/README.md',
	},
	'14-nested-machines': {
		title: '14 · Nested machines',
		notice:
			'Each actor has its own trace stream — payment and shipping queues are independent.',
		next: '../15-complex-workflow/README.md',
	},
	'15-complex-workflow': {
		title: '15 · Complex workflow',
		notice:
			'Async `#submit` handler runs validation inline, then schedules a transition to `Approved` or `Rejected`.',
		next: null,
	},
};

const LINK_FIXES = [
	[/\]\(\.\.\/02-context\//g, '](../03-context/'],
	[/\]\(\.\.\/03-protocol-typing\//g, '](../04-protocol-typing/'],
	[/\]\(\.\.\/04-hierarchy\//g, '](../05-hierarchy/'],
	[/\]\(\.\.\/05-transitions-entry-exit\//g, '](../06-transitions-entry-exit/'],
	[/\]\(\.\.\/06-internal-transitions\//g, '](../07-internal-transitions/'],
	[/\]\(\.\.\/07-post-and-sync\//g, '](../08-post-and-sync/'],
	[/\]\(\.\.\/08-deferred-post\//g, '](../09-deferred-post/'],
	[/\]\(\.\.\/09-call-services\//g, '](../10-call-services/'],
	[/\]\(\.\.\/10-restore\//g, '](../11-restore/'],
	[/\]\(\.\.\/11-tracing\//g, '](../02-tracing/'],
	[/\]\(\.\.\/12-error-recovery\//g, '](../12-error-recovery/'],
	[/Tutorial 02 — Context/g, 'Tutorial 03 — Context'],
	[/Tutorial 03 — Protocol/g, 'Tutorial 04 — Protocol'],
	[/Tutorial 04 — Hierarchy/g, 'Tutorial 05 — Hierarchy'],
	[/Tutorial 05 — Transitions/g, 'Tutorial 06 — Transitions'],
	[/Tutorial 06 — Internal/g, 'Tutorial 07 — Internal'],
	[/Tutorial 07 — Post/g, 'Tutorial 08 — Post'],
	[/Tutorial 08 — Deferred/g, 'Tutorial 09 — Deferred'],
	[/Tutorial 09 — Call/g, 'Tutorial 10 — Call'],
	[/Tutorial 10 — Restore/g, 'Tutorial 11 — Restore'],
	[/Tutorial 11 — Tracing/g, 'Tutorial 02 — Tracing'],
	[/Tutorial 12 — Error/g, 'Tutorial 12 — Error'],
];

function traceSection(meta, folder) {
	const intro =
		folder === '02-tracing'
			? 'ihsm logs every dispatch step when `HsmTraceLevel.VERBOSE_DEBUG` is set and a custom `HsmTraceWriter` collects lines.'
			: 'ihsm logs every dispatch step when `HsmTraceLevel.VERBOSE_DEBUG` is set and a custom `HsmTraceWriter` collects lines. Setup: [Tutorial 02 — Tracing](../02-tracing/README.md).';

	return `## Reading the trace

${intro}

Each line is **\`domain|…|StateName: message\`**. Domains nest as the runtime descends: \`initialize\` → \`#eventName\` → \`execute\` → \`transition from X to Y\`.

\`\`\`trace
{{TRACE}}
\`\`\`

**What to notice:** ${meta.notice}
`;
}

for (const [folder, meta] of Object.entries(META)) {
	const path = join(tutorials, folder, 'README.md');
	let content = readFileSync(path, 'utf8');
	for (const [re, rep] of LINK_FIXES) {
		content = content.replace(re, rep);
	}
	if (!content.includes('{{TRACE}}')) {
		const anchor = '\n## Run the test\n';
		if (content.includes(anchor)) {
			content = content.replace(anchor, `\n${traceSection(meta, folder)}${anchor}`);
		}
	}
	if (meta.next && content.includes('## What you learned')) {
		const nextTitle = META[meta.next.match(/\/(\d{2}-[^/]+)\//)?.[1] ?? '']?.title ?? '';
		const nextLabel = nextTitle.replace(/^\d+ · /, '');
		content = content.replace(/Next: \[Tutorial[^\n]+\n/, `Next: [Tutorial ${nextTitle.slice(0, 2)} — ${nextLabel}](${meta.next})\n`);
	}
	writeFileSync(path, content, 'utf8');
	console.log('patched', folder);
}

// tutorials index
const indexPath = join(tutorials, 'README.md');
let index = readFileSync(indexPath, 'utf8');
index = index.replace(
	/\| 01 \|[\s\S]*?\| 15 \|.*\|\n/,
	`| 01 | [Hello state machine](./01-hello-state-machine/) | Factory, \`post\`, \`sync\` |
| 02 | [Tracing](./02-tracing/) | Trace levels, read dispatch logs |
| 03 | [Context](./03-context/) | Domain \`ctx\` |
| 04 | [Protocol typing](./04-protocol-typing/) | Typed \`Protocol\` |
| 05 | [Hierarchy](./05-hierarchy/) | Deep hierarchy, every transition kind |
| 06 | [Entry & exit](./06-transitions-entry-exit/) | LCA lifecycle |
| 07 | [Internal transitions](./07-internal-transitions/) | No \`transition()\` |
| 08 | [Post & sync](./08-post-and-sync/) | Mailbox |
| 09 | [Deferred post](./09-deferred-post/) | Timers |
| 10 | [Call services](./10-call-services/) | Typed \`call()\` |
| 11 | [Restore](./11-restore/) | \`restore()\`, suspend/resume |
| 12 | [Error recovery](./12-error-recovery/) | \`onError\` |
| 13 | [Async handlers](./13-async-handlers/) | \`async\`/\`await\` |
| 14 | [Nested machines](./14-nested-machines/) | Orthogonal actors |
| 15 | [Complex workflow](./15-complex-workflow/) | Integration |
`,
);
writeFileSync(indexPath, index, 'utf8');
console.log('patched tutorials/README.md');
