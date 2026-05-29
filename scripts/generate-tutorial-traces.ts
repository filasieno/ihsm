#!/usr/bin/env node
/**
 * Captures VERBOSE_DEBUG trace samples into tutorials/NN-name/trace.sample.txt
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HsmFactory, HsmTraceLevel } from '../src';
import { CollectingTraceWriter, traceText } from '../tutorials/_shared/trace';

const root = join(__dirname, '..');
const tutorials = join(root, 'tutorials');

function save(folder: string, writer: CollectingTraceWriter): void {
	writeFileSync(join(tutorials, folder, 'trace.sample.txt'), `${traceText(writer).trim()}\n`, 'utf8');
	console.log('wrote', folder);
}

function factory<T>(Top: new (...args: never[]) => T, writer: CollectingTraceWriter): HsmFactory<unknown, unknown> {
	return new HsmFactory(Top as never, true, HsmTraceLevel.VERBOSE_DEBUG, writer);
}

async function main(): Promise<void> {
	const m01 = await import('../tutorials/01-hello-state-machine/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m01.DoorTop, w).create({ openCount: 0 });
		await sm.sync();
		sm.post('open');
		await sm.sync();
		sm.post('close');
		await sm.sync();
		save('01-hello-state-machine', w);
	}

	const m02 = await import('../tutorials/02-tracing/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = m02.createTracedPing(w);
		await sm.sync();
		sm.post('ping');
		await sm.sync();
		save('02-tracing', w);
	}

	const m03 = await import('../tutorials/03-context/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m03.CounterTop, w).create({ value: 0, step: 5 });
		await sm.sync();
		sm.post('increment');
		await sm.sync();
		save('03-context', w);
	}

	const m04 = await import('../tutorials/04-protocol-typing/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m04.ThermostatTop, w).create({ celsius: 18 });
		await sm.sync();
		sm.post('setTarget', 22);
		await sm.sync();
		save('04-protocol-typing', w);
	}

	const m05 = await import('../tutorials/05-hierarchy/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m05.DeepTop, w).create({ value: 0, trace: [], failExit: false });
		await sm.sync();
		sm.post('tick');
		await sm.sync();
		save('05-hierarchy', w);
	}

	const m06 = await import('../tutorials/06-transitions-entry-exit/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m06.TraceTop, w).create({ log: [] });
		await sm.sync();
		sm.post('goToB');
		await sm.sync();
		save('06-transitions-entry-exit', w);
	}

	const m07 = await import('../tutorials/07-internal-transitions/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m07.LampTop, w).create({ brightness: 50, entryCount: 0 });
		await sm.sync();
		sm.post('dim', 10);
		await sm.sync();
		save('07-internal-transitions', w);
	}

	const m08 = await import('../tutorials/08-post-and-sync/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m08.QueueTop, w).create({ events: [] });
		await sm.sync();
		sm.post('start');
		await sm.sync();
		await sm.sync();
		save('08-post-and-sync', w);
	}

	const m09 = await import('../tutorials/09-deferred-post/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m09.ReminderTop, w).create({ message: '' });
		await sm.sync();
		sm.post('scheduleReminder', 'hello later');
		await sm.sync();
		await new Promise((r) => setTimeout(r, 60));
		await sm.sync();
		save('09-deferred-post', w);
	}

	const m10 = await import('../tutorials/10-call-services/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m10.WalletTop, w).create({ balance: 100 });
		await sm.sync();
		await sm.call('getBalance');
		sm.post('deposit', 50);
		await sm.sync();
		await sm.call('getBalance');
		save('10-call-services', w);
	}

	const m11 = await import('../tutorials/11-restore/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m11.SessionTop, w).create({ userId: 'user-42', lastPage: 'home', entryLog: [] });
		await sm.sync();
		sm.restore(m11.Authenticated, {
			userId: 'user-42',
			lastPage: 'settings',
			entryLog: sm.ctx.entryLog,
		});
		sm.post('navigate', 'billing');
		await sm.sync();
		save('11-restore', w);
	}

	const m12 = await import('../tutorials/12-error-recovery/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m12.WorkerTop, w).create({ failures: 0, recovered: 0 });
		await sm.sync();
		sm.post('risky');
		await sm.sync();
		save('12-error-recovery', w);
	}

	const m13 = await import('../tutorials/13-async-handlers/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m13.FileTop, w).create({
			sourcePath: '',
			destPath: '',
			bytesWritten: 0,
			steps: [],
		});
		await sm.sync();
		sm.post('transfer', '/inbox/a.dat', '/archive/a.dat');
		await sm.sync();
		save('13-async-handlers', w);
	}

	const m14 = await import('../tutorials/14-nested-machines/machine');
	{
		const wPay = new CollectingTraceWriter();
		const wShip = new CollectingTraceWriter();
		const pay = factory(m14.PaymentTop, wPay).create({ paid: false });
		const ship = factory(m14.ShippingTop, wShip).create({ shipped: false });
		await pay.sync();
		await ship.sync();
		pay.post('markPaid');
		await pay.sync();
		ship.post('markShipped');
		await ship.sync();
		const combined = new CollectingTraceWriter();
		combined.lines.push('--- payment actor ---');
		combined.lines.push(...wPay.lines);
		combined.lines.push('--- shipping actor ---');
		combined.lines.push(...wShip.lines);
		save('14-nested-machines', combined);
	}

	const m15 = await import('../tutorials/15-complex-workflow/machine');
	{
		const w = new CollectingTraceWriter();
		const sm = factory(m15.CheckoutTop, w).create({
			orderId: 'ORD-100',
			amount: 500,
			limit: 1000,
			phase: 'draft',
			validationNotes: [],
		});
		await sm.sync();
		sm.post('submit');
		await sm.sync();
		save('15-complex-workflow', w);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
