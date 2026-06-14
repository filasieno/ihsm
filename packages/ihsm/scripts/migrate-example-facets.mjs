#!/usr/bin/env node
/**
 * Migrate example tutorial.spec.ts / interactive.ts flat protocol calls
 * to faceted notify / notifyNow / call surfaces.
 */
import fs from 'node:fs';
import path from 'node:path';

const EXAMPLES = path.resolve(import.meta.dirname, '../examples');

function extractBucketKeys(source, bucket) {
	const re = new RegExp(`\\b${bucket}\\s*:\\s*\\{([^}]*)\\}`, 's');
	const m = source.match(re);
	if (!m) return [];
	const body = m[1];
	const keys = [];
	for (const km of body.matchAll(/^\s*(\w+)\s*(?:\(|<)/gm)) keys.push(km[1]);
	return keys;
}

function loadBuckets(dir) {
	const machinePath = path.join(dir, 'machine.ts');
	if (!fs.existsSync(machinePath)) return null;
	const source = fs.readFileSync(machinePath, 'utf8');
	return {
		notify: [
			...extractBucketKeys(source, 'notifications'),
			...extractBucketKeys(source, 'internalNotifications'),
		],
		call: [
			...extractBucketKeys(source, 'services'),
			...extractBucketKeys(source, 'internalServices'),
		],
	};
}

function facetFor(buckets, method) {
	if (buckets.call.includes(method)) return 'call';
	if (buckets.notify.includes(method)) return 'notify';
	return null;
}

function migrateCalls(text, buckets) {
	let out = text;
	const handle = String.raw`([A-Za-z_$][\w$]*)`;
	for (const method of [...buckets.call].sort((a, b) => b.length - a.length)) {
		const facet = facetFor(buckets, method);
		if (!facet) continue;
		// await wallet.getBalance( -> await wallet.call.getBalance(
		out = out.replace(new RegExp(`(await\\s+)${handle}\\.${method}\\s*\\(`, 'g'), `$1$2.${facet}.${method}(`);
		// wallet.deposit( -> wallet.notify.deposit(
		out = out.replace(new RegExp(`(?<!\\.(?:notify|call|notifyNow)\\.)(?<![\\w$.])${handle}\\.${method}\\s*\\(`, 'g'), `$1.${facet}.${method}(`);
	}
	for (const method of [...buckets.notify].sort((a, b) => b.length - a.length)) {
		const facet = facetFor(buckets, method);
		if (!facet) continue;
		out = out.replace(new RegExp(`(await\\s+)${handle}\\.${method}\\s*\\(`, 'g'), `$1$2.${facet}.${method}(`);
		out = out.replace(new RegExp(`(?<!\\.(?:notify|call|notifyNow)\\.)(?<![\\w$.])${handle}\\.${method}\\s*\\(`, 'g'), `$1.${facet}.${method}(`);
	}
	return out;
}

function migrateDir(dir) {
	const buckets = loadBuckets(dir);
	if (!buckets || (buckets.notify.length === 0 && buckets.call.length === 0)) return;
	for (const name of ['tutorial.spec.ts', 'interactive.ts', 'README.md']) {
		const file = path.join(dir, name);
		if (!fs.existsSync(file)) continue;
		const before = fs.readFileSync(file, 'utf8');
		const after = migrateCalls(before, buckets);
		if (after !== before) {
			fs.writeFileSync(file, after);
			console.log('updated', path.relative(EXAMPLES, file));
		}
	}
}

function walk(dir) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (fs.existsSync(path.join(p, 'machine.ts'))) migrateDir(p);
			walk(p);
		}
	}
}

walk(EXAMPLES);
console.log('facet migration done');
