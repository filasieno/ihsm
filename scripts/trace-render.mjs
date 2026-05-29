#!/usr/bin/env node
/**
 * Renders ```trace fenced blocks to colored HTML for the docs site.
 */

const TRACE_FENCE = /```trace\r?\n([\s\S]*?)```/g;

const RULES = [
	{ re: /failure:|thrown|failed|error recovery failure/i, cls: 'trace-err' },
	{ re: /^done: /, cls: 'trace-done' },
	{ re: /^started /, cls: 'trace-start' },
	{ re: /\bbegin (initialization|event dispatch)/, cls: 'trace-phase' },
	{ re: /\bend (initialization|event dispatch)/, cls: 'trace-phase' },
	{ re: /requested transition|started transition|transition cache|final state is/, cls: 'trace-transition' },
	{ re: /\.onEntry\(\)|\.onExit\(\)/, cls: 'trace-lifecycle' },
	{ re: /error recovery|unhandled event recovery/, cls: 'trace-recovery' },
];

function escapeHtml(text) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function classifyMessage(message) {
	for (const { re, cls } of RULES) {
		if (re.test(message)) {
			return cls;
		}
	}
	return 'trace-msg';
}

/**
 * @param {string} line
 */
function colorizeTraceLine(line) {
	const colonIdx = line.lastIndexOf(': ');
	if (colonIdx === -1) {
		return `<div class="trace-line"><span class="trace-raw">${escapeHtml(line)}</span></div>`;
	}
	const message = line.slice(colonIdx + 2);
	const before = line.slice(0, colonIdx);
	const pipeIdx = before.lastIndexOf('|');
	const domain = pipeIdx === -1 ? '' : `${before.slice(0, pipeIdx + 1)}`;
	const state = pipeIdx === -1 ? before : before.slice(pipeIdx + 1);
	const msgCls = classifyMessage(message);
	const domainHtml = domain
		? `<span class="trace-domain">${escapeHtml(domain)}</span>`
		: '';
	return `<div class="trace-line">${domainHtml}<span class="trace-state">${escapeHtml(state)}</span><span class="trace-sep">: </span><span class="${msgCls}">${escapeHtml(message)}</span></div>`;
}

/**
 * @param {string} markdown
 */
export function renderTraceBlocks(markdown) {
	if (!TRACE_FENCE.test(markdown)) {
		TRACE_FENCE.lastIndex = 0;
		return markdown;
	}
	TRACE_FENCE.lastIndex = 0;
	return markdown.replace(TRACE_FENCE, (_match, body) => {
		const lines = body.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
		const html = lines.map(colorizeTraceLine).join('\n');
		return `<div class="ihsm-trace" role="region" aria-label="ihsm trace output">\n${html}\n</div>`;
	});
}
