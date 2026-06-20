/**
 * Emits a single "begin test" marker log to the live OTLP collector and prints the marker id +
 * start timestamp, so a compliance run can query every trace/log produced after this point.
 *
 * Run: `npm run test:marker` (see package.json). Not a test — a manual run-fence emitter.
 */

import { startOtelNode } from '../env/node';

const OTEL_ENDPOINT = process.env.OTEL_ENDPOINT ?? 'http://localhost:14318';
const SERVICE_NAME = process.env.IHSM_OTEL_COLLECTOR_SERVICE ?? 'ihsm-otel-collector-it';

async function main(): Promise<void> {
	const markerId = `begin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const startIso = new Date().toISOString();
	const otel = startOtelNode({
		serviceName: SERVICE_NAME,
		endpoint: OTEL_ENDPOINT,
		useSimpleProcessors: true,
		registerGlobal: false,
		resourceAttributes: { 'ihsm.test.marker': markerId },
	});
	otel.logger.emit({
		severityNumber: 9,
		severityText: 'INFO',
		body: `IHSM-OTEL-COMPLIANCE-BEGIN ${markerId}`,
		attributes: { 'ihsm.test.marker': markerId, 'ihsm.test.phase': 'begin' },
	});
	await otel.forceFlush();
	await otel.shutdown();
	process.stdout.write(`MARKER_ID=${markerId}\nMARKER_START_ISO=${startIso}\n`);
}

main().catch((err: unknown) => {
	process.stderr.write(`marker failed: ${String(err)}\n`);
	process.exitCode = 1;
});
