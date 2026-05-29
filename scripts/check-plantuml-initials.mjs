#!/usr/bin/env node
/**
 * Verify PlantUML state diagrams mark the correct initial substate for every
 * composite that appears as `state Name { … }`, using @HsmInitialState in machine.ts.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const PLANTUML_FENCE = /```plantuml\r?\n([\s\S]*?)```/g;

/** @param {string} source */
function parseMachine(source) {
	/** @type {Record<string, string>} */
	const classes = {};
	/** @type {Record<string, string>} */
	const initialOf = {};
	let pendingInitial = false;

	for (const line of source.split('\n')) {
		if (line.includes('@HsmInitialState')) {
			pendingInitial = true;
			continue;
		}
		const match = line.match(/^export class (\w+) extends (\w+)/);
		if (!match) {
			continue;
		}
		const [, name, parent] = match;
		classes[name] = parent;
		if (pendingInitial) {
			initialOf[parent] = name;
		}
		pendingInitial = false;
	}

	/** @type {Record<string, string[]>} */
	const children = {};
	for (const [child, parent] of Object.entries(classes)) {
		(children[parent] ??= []).push(child);
	}

	const composites = new Set(Object.keys(children).filter((parent) => children[parent].length > 0));
	return { composites, initialOf };
}

/** @param {string} puml @returns {[string, string][]} */
function extractStateBlocks(puml) {
	/** @type {[string, string][]} */
	const results = [];
	const lines = puml.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const open = lines[i].match(/^(\s*)state\s+(\w+)\s*\{\s*$/);
		if (!open) {
			continue;
		}
		const name = open[2];
		let depth = 1;
		const body = [];
		i += 1;
		while (i < lines.length && depth > 0) {
			if (/^\s*state\s+\w+\s*\{\s*$/.test(lines[i])) {
				depth += 1;
			}
			if (lines[i].trim() === '}') {
				depth -= 1;
				if (depth === 0) {
					break;
				}
			}
			body.push(lines[i]);
			i += 1;
		}
		results.push([name, body.join('\n')]);
	}

	return results;
}

/** @param {string} readmePath @param {string} machinePath @param {string} label */
function checkTutorial(readmePath, machinePath, label) {
	const { composites, initialOf } = parseMachine(readFileSync(machinePath, 'utf8'));
	const md = readFileSync(readmePath, 'utf8');
	const blocks = [...md.matchAll(PLANTUML_FENCE)];
	/** @type {string[]} */
	const issues = [];

	for (let i = 0; i < blocks.length; i++) {
		for (const [composite, body] of extractStateBlocks(blocks[i][1])) {
			if (!composites.has(composite)) {
				continue;
			}
			const expected = initialOf[composite];
			if (!expected) {
				issues.push(`${label} #${i + 1}: composite ${composite} has substates but no @HsmInitialState in machine.ts`);
				continue;
			}
			const match = body.match(/\[\*\]\s*-->\s*(\w+)/);
			if (!match) {
				issues.push(`${label} #${i + 1}: composite ${composite} missing [*] --> ${expected}`);
			} else if (match[1] !== expected) {
				issues.push(`${label} #${i + 1}: composite ${composite} has [*] --> ${match[1]}, expected ${expected}`);
			}
		}
	}

	return issues;
}

/** @type {string[]} */
const allIssues = [];

for (const folder of readdirSync(join(root, 'tutorials')).filter((d) => /^\d{2}-/.test(d)).sort()) {
	const readme = join(root, 'tutorials', folder, 'README.md');
	const machine = join(root, 'tutorials', folder, 'machine.ts');
	if (!existsSync(readme) || !existsSync(machine)) {
		continue;
	}
	allIssues.push(...checkTutorial(readme, machine, folder));
}

if (allIssues.length > 0) {
	for (const issue of allIssues) {
		console.log('FAIL', issue);
	}
	process.exit(1);
}

console.log('All composite initial states OK');
