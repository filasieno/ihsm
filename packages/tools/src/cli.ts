#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { generateTransitionTableModule, writeTransitionTableFile } from './generate';

interface CliArgs {
	command?: string;
	importPath?: string;
	top?: string;
	out?: string;
	help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {};
	for (let i = 0; i < argv.length; ++i) {
		const token = argv[i];
		switch (token) {
			case 'transitions':
			case 'generate-transitions':
				args.command = 'transitions';
				break;
			case '--import':
			case '-i':
				args.importPath = argv[++i];
				break;
			case '--top':
			case '-t':
				args.top = argv[++i];
				break;
			case '--out':
			case '-o':
				args.out = argv[++i];
				break;
			case '--help':
			case '-h':
				args.help = true;
				break;
			default:
				if (token.startsWith('-')) {
					throw new Error(`unknown option: ${token}`);
				}
				if (args.command === undefined) {
					args.command = token;
				}
		}
	}
	return args;
}

function printHelp(): void {
	process.stdout.write(`@ihsm/tools — ihsm development utilities

Usage:
  ihsm-tools transitions --import <module> --top <TopState> [--out <file.ts>]

Options:
  -i, --import   Path to a module that exports the machine states (compiled .js or .ts via ts-node)
  -t, --top      Export name of the root state class (e.g. DoorTop)
  -o, --out      Output .ts file (default: stdout)
  -h, --help     Show this help

Example:
  ihsm-tools transitions -i ./machine.js -t DeepTop -o ./machine.transitions.ts
`);
}

async function runTransitions(args: CliArgs): Promise<void> {
	if (args.importPath === undefined || args.top === undefined) {
		throw new Error('transitions requires --import and --top');
	}
	const resolved = path.resolve(args.importPath);
	const moduleUrl = pathToFileURL(resolved).href;
	const loaded: Record<string, unknown> = await import(moduleUrl);
	const topState = loaded[args.top];
	if (typeof topState !== 'function') {
		throw new Error(`export "${args.top}" is not a state class in ${resolved}`);
	}

	const importSpec = args.out !== undefined ? relativeImportSpec(path.resolve(args.out), resolved) : './machine';
	const sourceOptions = {
		topState: topState as never,
		exports: loaded,
		importPath: importSpec,
	};

	if (args.out !== undefined) {
		writeTransitionTableFile(path.resolve(args.out), sourceOptions);
		process.stderr.write(`wrote ${path.resolve(args.out)}\n`);
		return;
	}

	process.stdout.write(generateTransitionTableModule(sourceOptions));
}

/** Relative POSIX import path from `fromFile` to `toModule`. */
function relativeImportSpec(fromFile: string, toModule: string): string {
	let rel = path.relative(path.dirname(fromFile), toModule);
	rel = rel.split(path.sep).join('/');
	if (!rel.startsWith('.')) {
		rel = `./${rel}`;
	}
	return rel.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || args.command === undefined) {
		printHelp();
		process.exitCode = args.help ? 0 : 1;
		return;
	}
	switch (args.command) {
		case 'transitions':
		case 'generate-transitions':
			await runTransitions(args);
			break;
		default:
			throw new Error(`unknown command: ${args.command}`);
	}
}

main().catch(err => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
