#!/usr/bin/env node
/**
 * Align reference markdown with the faceted actor API (notify / notifyNow / call).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory() && !['node_modules', 'lib', '.tsc', 'website'].includes(ent.name)) walk(p, out);
		else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
	}
	return out;
}

function transform(text) {
	let s = text;

	// Paths & legacy folder names
	s = s.replace(/\.\.\/\.\.\/docs\/REFERENCE\.md/g, '../reference/REFERENCE.md');
	s = s.replace(/\.\.\/tutorials\//g, '../examples/');
	s = s.replace(/`tutorials\//g, '`examples/');

	// Factories & types
	s = s.replace(/\bmakeOwnerActor\b/g, 'makeActor');
	s = s.replace(/\bmakeHsm\b/g, 'makeActor');
	s = s.replace(/\bmakeInternalActor\b/g, 'makeActor');
	s = s.replace(/\bOwnerActor</g, 'ChildActor<');
	s = s.replace(/\bOwnerActor\b/g, 'ChildActor');
	s = s.replace(/\bInternalActor\b/g, 'InboundActor');
	s = s.replace(/\bActor</g, 'ExternalActor<');
	s = s.replace(/`Actor`/g, '`ExternalActor`');

	// Handler self-send
	s = s.replace(/this\.hsm\.actor\./g, 'this.notify.');
	s = s.replace(/this\.hsm\.immediate\./g, 'this.notifyNow.');
	s = s.replace(/`hsm\.actor`/g, '`notify`');
	s = s.replace(/`hsm\.immediate`/g, '`notifyNow`');
	s = s.replace(/``hsm\.immediate``/g, '`notifyNow`');
	s = s.replace(/hsm\.actor notifications/g, '`notify` notifications');
	s = s.replace(/`hsm\.immediate`\(\)/g, '`notifyNow`');
	s = s.replace(/# Hi-priority notifications \(`hsm\.immediate`\)/g, '# Hi-priority notifications (`notifyNow`)');

	// Client flat → faceted (prose; code blocks updated separately in REFERENCE)
	s = s.replace(/flat methods/g, 'faceted methods (`notify`, `notifyNow`, `call`)');
	s = s.replace(/Generated handles/g, 'Faceted handles');
	s = s.replace(/generated methods/g, 'faceted methods');
	s = s.replace(/no `post` \/ `call` \/ `Proxy`/g, 'no flat protocol methods on the handle');
	s = s.replace(/`post` \/ `call`/g, '`notify` / `call`');
	s = s.replace(/\bpost\('([^']+)'/g, "notify.$1(");
	s = s.replace(/\bcall\('([^']+)'/g, 'call.$1(');
	s = s.replace(/`post\(/g, '`notify.');
	s = s.replace(/`call\(/g, '`call.');

	// TopState generics (v0.0.x)
	s = s.replace(/TopState<([A-Za-z]+Ctx), ([A-Za-z]+Protocol)>/g, 'TopState<$1Config>');
	s = s.replace(/TopState<Context, Protocol>/g, 'TopState<YourConfig>');
	s = s.replace(/extends TopState<[^>]+Protocol[^>]*>/g, (m) => m.replace(/, [A-Za-z]+Protocol/, ''));

	// Self-notifications glossary drift
	s = s.replace(/`hsm\.actor`, `hsm\.immediate`, `hsm\.defer\(ms\)`/g, '`notify`, `notifyNow`, `hsm.port.defer(ms)`');
	s = s.replace(/`hsm\.defer\(ms\)`/g, '`hsm.port.defer(ms)`');

	// EMBODIMENTS migration section — shims removed
	s = s.replace(
		/The pre-facet flat methods[\s\S]*?`this\.immediate\.x\(\)/,
		`Flat protocol methods on the actor handle and handler aliases \`this.actor\` / \`this.immediate\` were removed. Use:

- \`actor.notify.x()\` / \`actor.notifyNow.x()\` for notifications
- \`actor.call.y()\` for services
- \`this.notify.x()\` / \`this.notifyNow.x()\` inside handlers`,
	);

	return s;
}

function patchReferenceMessaging(s) {
	// Section 4 client examples
	s = s.replace(
		/### Notifications \(`actor\.event\(…\)`\)[\s\S]*?<!-- @example:08-post-and-sync -->/,
		`### Notifications (\`actor.notify.event(…)\`)

Fire-and-forget. The client enqueues on the default FIFO queue; the handler runs later on the active state.

**Handler** — method on \`Config.notifications\` (or \`internalNotifications\` for self/inbound):

\`\`\`typescript
@InitialState
class Closed extends DoorTop {
  open(): void {
    this.ctx.openCount += 1;
    this.hsm.transition(Open);
  }
}
\`\`\`

**Client** — returns immediately; use \`await actor.hsm.sync()\` to wait:

\`\`\`typescript
door.notify.open();
await door.hsm.sync(); // handler + transition complete
\`\`\`

Inside a state handler, \`this.notify.tick()\` schedules work **after** the current
handler completes (and after any transition it requested). Use \`this.notifyNow.tick()\`
for hi-priority delivery — see [Tutorial 17](../examples/17-post-now/README.md).

<!-- @example:08-post-and-sync -->`,
	);

	s = s.replace(
		/### Services \(`await actor\.service\(…\)`\)[\s\S]*?<!-- @example:10-call-services -->/,
		`### Services (\`await actor.call.service(…)\`)

Query the same actor through run-to-completion dispatch and receive a **typed Promise**.

**Handler** — return a value or \`Promise\` (\`Config.services\`):

\`\`\`typescript
getBalance(): number {
  return this.ctx.balance;
}

async fetchBalance(id: string): Promise<number> {
  const row = await db.load(id);
  return row.balance;
}
\`\`\`

**Client**:

\`\`\`typescript
const balance = await wallet.call.getBalance();
wallet.notify.deposit(50);
await wallet.hsm.sync();
\`\`\`

Handlers **cannot** call \`this.call\` on themselves — that would deadlock. Cross-actor
service calls use a **different** actor handle (\`child.call…\`, \`parent…\`).

<!-- @example:10-call-services -->`,
	);

	s = s.replace(
		/`makeActor`, `makeInternalActor`, and `makeOwnerActor` create instances\n\(`makeHsm` aliases `makeOwnerActor`\):/,
		'`makeActor` and `makeChildActor` create actor shells. Tests use `makeTestActor` from `ihsm/testing`:',
	);

	s = s.replace(
		/const door = makeActor\(DoorTop, \{ openCount: 0 \}, new Port\(\)\);/g,
		'const door = makeActor(DoorTop, { openCount: 0 }, new Port());\ndoor.notify.open();',
	);

	return s;
}

for (const file of walk(ROOT)) {
	if (file.includes('CHANGELOG') || file.includes('PROPOSAL')) continue;
	let s = fs.readFileSync(file, 'utf8');
	const before = s;
	s = transform(s);
	if (file.endsWith('reference/REFERENCE.md')) s = patchReferenceMessaging(s);
	if (s !== before) {
		fs.writeFileSync(file, s);
		console.log('updated', path.relative(ROOT, file));
	}
}
console.log('reference facet sync done');
