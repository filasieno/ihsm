#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory() && !['node_modules', 'lib', 'scripts'].includes(ent.name)) walk(p, out);
		else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
	}
	return out;
}

function fix(text) {
	let s = text;
	// Broken replacements from update-docs-v01.mjs
	s = s.replace(/``hsm\.defer\(ms\)``/g, '`hsm.defer(ms)`');
	s = s.replace(/``hsm\.immediate``/g, '`hsm.immediate`');
	s = s.replace(/### ``hsm\.defer\(ms\)`\(millis, event, \.\.\.payload\)`/g, '### `hsm.defer(ms)` — deferred notifications');
	s = s.replace(/### ``hsm\.immediate`\(event, \.\.\.payload\)`/g, '### `hsm.immediate` — hi-priority notifications');
	s = s.replace(/\(``this\.`hsm\.defer\(ms\)``\)/g, '(`this.hsm.defer(ms)`)');
	s = s.replace(/`this\.`hsm\.defer\(ms\)``/g, '`this.hsm.defer(ms)`');
	s = s.replace(/`this\.`hsm\.immediate`/g, '`this.hsm.immediate`');
	s = s.split('this.`hsm.defer(ms)`(').join('this.hsm.defer(');
	s = s.replace(/this\.hsm\.defer\(50\)\.deliver\(, text\)/g, 'this.hsm.defer(50).deliver(text)');
	s = s.replace(/\[``hsm\.immediate`\(\)`\]/g, '[`hsm.immediate`](#_4-messaging-notifications-services-sync)');
	s = s.replace(/``hsm\.immediate`\(\)/g, '`hsm.immediate`');
	s = s.replace(/``hsm\.immediate`'/g, "`hsm.immediate`");
	s = s.replace(/makeHsm/g, 'makeOwnerActor');
	s = s.replace(/#_10-makehsm/g, '#_10-factories');
	s = s.replace(/## 10\. makeOwnerActor/g, '## 10. Factories');
	s = s.replace(/### makeOwnerActor\n\n`makeOwnerActor`/g, '### Factories\n\n`makeOwnerActor`');
	s = s.replace(/## 4\. Messaging: post, call, sync/g, '## 4. Messaging: notifications, services, sync');
	s = s.replace(/#_4-messaging-post-call-sync/g, '#_4-messaging-notifications-services-sync');
	return s;
}

for (const file of walk(ROOT)) {
	if (file.includes('CHANGELOG') || file.includes('PROPOSAL')) continue;
	const before = fs.readFileSync(file, 'utf8');
	const after = fix(before);
	if (after !== before) fs.writeFileSync(file, after);
}
