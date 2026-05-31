import { makeHsm, HsmInitialState, HsmTopState } from '../../src';

export interface FileCtx {
	sourcePath: string;
	destPath: string;
	bytesWritten: number;
	steps: string[];
}

export interface FileProtocol {
	transfer(from: string, to: string): Promise<void>;
}

/** Simulated file API — each step returns a Promise like real I/O. */
async function open(path: string, mode: 'r' | 'w'): Promise<number> {
	await Promise.resolve();
	return mode === 'r' ? 1 : 2;
}

async function read(_fd: number): Promise<Buffer> {
	await Promise.resolve();
	return Buffer.from('payload-bytes', 'utf8');
}

async function write(_fd: number, data: Buffer): Promise<number> {
	await Promise.resolve();
	return data.length;
}

async function close(_fd: number): Promise<void> {
	await Promise.resolve();
}

export class FileTop extends HsmTopState<FileCtx, FileProtocol> {}

@HsmInitialState
export class Idle extends FileTop {
	/**
	 * Entire open → read → write → close pipeline in **one handler**, **one state**.
	 * No Opening / Reading / Writing / Closing substates.
	 */
	async transfer(from: string, to: string): Promise<void> {
		this.ctx.sourcePath = from;
		this.ctx.destPath = to;
		this.ctx.steps = [];

		const readFd = await open(from, 'r');
		this.ctx.steps.push('open(read)');

		const data = await read(readFd);
		this.ctx.steps.push('read');

		await close(readFd);
		this.ctx.steps.push('close(read)');

		const writeFd = await open(to, 'w');
		this.ctx.steps.push('open(write)');

		this.ctx.bytesWritten = await write(writeFd, data);
		this.ctx.steps.push('write');

		await close(writeFd);
		this.ctx.steps.push('close(write)');

		this.transition(Done);
	}
}

export class Done extends FileTop {}

export function createFileActor() {
	return makeHsm(FileTop, {
		sourcePath: '',
		destPath: '',
		bytesWritten: 0,
		steps: [],
	});
}
