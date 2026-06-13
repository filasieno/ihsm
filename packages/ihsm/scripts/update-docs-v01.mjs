#!/usr/bin/env node
/**
 * One-shot markdown refresh: v0.0.x post/call/makeHsm → v0.1 generated handles.
 * Skips files already using hsm.sync(); idempotent on most patterns.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== 'lib') walk(p, out);
		else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
	}
	return out;
}

function transform(text) {
	let s = text;
	// Avoid double .hsm.hsm
	s = s.replace(/\.hsm\.hsm\./g, '.hsm.');

	s = s.replace(/\bmakeHsm\(/g, 'makeOwnerActor(');

	s = s.replace(/\bawait ([\w]+)\.sync\(\)/g, 'await $1.hsm.sync()');

	s = s.replace(/\bthis\.transition\(/g, 'this.hsm.transition(');

	s = s.replace(/\bthis\.deferredPost\((\d+),\s*'([\w]+)'/g, "this.hsm.defer($1).$2(");

	s = s.replace(/\bthis\.postNow\('([\w]+)'\)/g, 'this.hsm.immediate.$1()');

	s = s.replace(/\bthis\.post\('([\w]+)'\)/g, 'this.hsm.actor.$1()');

	s = s.replace(/\b([\w]+)\.post\('([\w]+)',\s*/g, '$1.$2(');

	s = s.replace(/\b([\w]+)\.post\('([\w]+)'\)/g, '$1.$2()');

	s = s.replace(/\bawait ([\w]+)\.call\('([\w]+)',\s*/g, 'await $1.$2(');

	s = s.replace(/\bawait ([\w]+)\.call\('([\w]+)'\)/g, 'await $1.$2()');

	s = s.replace(/\b([\w]+)\.call\('([\w]+)',\s*/g, '$1.$2(');

	s = s.replace(/\b([\w]+)\.call\('([\w]+)'\)/g, '$1.$2()');

	// Prose: deferredPost / postNow (not in code fences we can't easily skip — fix titles manually if needed)
	s = s.replace(/\bdeferredPost\b/g, '`hsm.defer(ms)`');
	s = s.replace(/\bpostNow\b/g, '`hsm.immediate`');
	s = s.replace(/`post` \/ `call` \/ `sync`/g, 'notifications, services, `hsm.sync`');
	s = s.replace(/\b`post\(event, …\)`/g, '`actor.event(…)`');
	s = s.replace(/\b`call\(service, …\)`/g, '`await actor.service(…)`');

	return s;
}

let changed = 0;
for (const file of walk(ROOT)) {
	if (file.includes('CHANGELOG.md') || file.includes('PROPOSAL')) continue;
	const before = fs.readFileSync(file, 'utf8');
	const after = transform(before);
	if (after !== before) {
		fs.writeFileSync(file, after);
		changed++;
		console.log('updated', path.relative(ROOT, file));
	}
}
console.log(`done: ${changed} file(s)`);
