import { useLocation } from '@docusaurus/router';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { InteractiveRuntime, TutorialInteractiveMeta, TutorialMessage } from '@examples/shared/interactive-types';
import { dispatchMessage, resetRuntime, traceFromRuntime } from '@examples/shared/interactive-helpers';
import styles from './styles.module.css';

export interface InteractiveTutorialProps {
	meta: TutorialInteractiveMeta;
	/** Matches the markdown heading id (`#example-…`) — scrolls the playground into view on TOC / hash navigation. */
	anchorId?: string;
}

function defaultFieldValues(message: TutorialMessage): Record<string, string> {
	const values: Record<string, string> = {};
	for (const field of message.fields ?? []) {
		values[field.name] = String(field.default);
	}
	return values;
}

export default function InteractiveTutorial({ meta, anchorId }: InteractiveTutorialProps): React.ReactElement {
	const location = useLocation();
	const panelRef = useRef<HTMLElement>(null);
	const [runtime, setRuntime] = useState<InteractiveRuntime>(() => meta.createRuntime());
	const [senderId, setSenderId] = useState(meta.senders[0]?.id ?? 'machine');
	const messages = meta.messagesBySender[senderId] ?? [];
	const [messageId, setMessageId] = useState(messages[0]?.id ?? '');
	const selectedMessage = messages.find(message => message.id === messageId) ?? messages[0];
	const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => (selectedMessage ? defaultFieldValues(selectedMessage) : {}));
	const [lastCallResult, setLastCallResult] = useState<string | undefined>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>();

	const traceText = useMemo(() => traceFromRuntime(runtime), [runtime]);
	const stateText = useMemo(() => meta.stateSummary(runtime), [meta, runtime]);
	const traceRef = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		const trace = traceRef.current;
		if (!trace) {
			return;
		}
		trace.scrollTop = trace.scrollHeight;
	}, [traceText]);

	useLayoutEffect(() => {
		if (!anchorId || location.hash !== `#${anchorId}`) {
			return;
		}
		const scrollToPlayground = (): void => {
			panelRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
		};
		scrollToPlayground();
		const frame = requestAnimationFrame(scrollToPlayground);
		return () => cancelAnimationFrame(frame);
	}, [anchorId, location.hash]);

	const onSenderChange = useCallback(
		(nextSenderId: string) => {
			setSenderId(nextSenderId);
			const nextMessages = meta.messagesBySender[nextSenderId] ?? [];
			const nextMessage = nextMessages[0];
			setMessageId(nextMessage?.id ?? '');
			setFieldValues(nextMessage ? defaultFieldValues(nextMessage) : {});
			setLastCallResult(undefined);
			setError(undefined);
		},
		[meta.messagesBySender]
	);

	const onMessageChange = useCallback(
		(nextMessageId: string) => {
			setMessageId(nextMessageId);
			const nextMessage = messages.find(message => message.id === nextMessageId);
			setFieldValues(nextMessage ? defaultFieldValues(nextMessage) : {});
			setLastCallResult(undefined);
			setError(undefined);
		},
		[messages]
	);

	const runDispatch = useCallback(async () => {
		if (!selectedMessage) {
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			const result = await dispatchMessage(runtime, senderId, selectedMessage, fieldValues, meta.afterDispatch);
			setLastCallResult(result);
			setRuntime({ ...runtime });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setRuntime({ ...runtime });
		} finally {
			setBusy(false);
		}
	}, [fieldValues, runtime, selectedMessage, senderId]);

	const onReset = useCallback(() => {
		resetRuntime(meta, runtime);
		setRuntime(meta.createRuntime());
		setLastCallResult(undefined);
		setError(undefined);
	}, [meta, runtime]);

	const onExtraAction = useCallback(
		async (actionId: string) => {
			const action = meta.extraActions?.find(item => item.id === actionId);
			if (!action) {
				return;
			}
			setBusy(true);
			setError(undefined);
			try {
				await action.run(runtime);
				setRuntime({ ...runtime });
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				setRuntime({ ...runtime });
			} finally {
				setBusy(false);
			}
		},
		[meta.extraActions, runtime]
	);

	const lastMoveAt = React.useRef(0);
	const onPadMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			const pad = meta.mousePad;
			if (!pad || busy) {
				return;
			}
			const now = Date.now();
			if (now - lastMoveAt.current < 60) {
				return; // throttle the stream so the actor/log stay readable
			}
			lastMoveAt.current = now;
			const rect = event.currentTarget.getBoundingClientRect();
			const x = event.clientX - rect.left;
			const y = event.clientY - rect.top;
			void Promise.resolve(pad.onMove(runtime, x, y))
				.then(() => setRuntime({ ...runtime }))
				.catch(err => {
					setError(err instanceof Error ? err.message : String(err));
					setRuntime({ ...runtime });
				});
		},
		[busy, meta.mousePad, runtime]
	);

	return (
		<section ref={panelRef} className={styles.panel} aria-label={`Tutorial playground: ${meta.title}`}>
			<div className={styles.playgroundHeader}>
				<span className={styles.playgroundBadge}>Interactive playground</span>
				<span className={styles.playgroundTitle}>{meta.title}</span>
			</div>
			<div className={styles.toolbar}>
				<div className={styles.fieldGroup}>
					<label htmlFor={`${meta.title}-sender`}>Sender</label>
					<select id={`${meta.title}-sender`} value={senderId} onChange={event => onSenderChange(event.target.value)} disabled={busy}>
						{meta.senders.map(sender => (
							<option key={sender.id} value={sender.id}>
								{sender.label}
							</option>
						))}
					</select>
				</div>

				<div className={styles.fieldGroup}>
					<label htmlFor={`${meta.title}-message`}>Message</label>
					<select id={`${meta.title}-message`} value={messageId} onChange={event => onMessageChange(event.target.value)} disabled={busy || messages.length === 0}>
						{messages.map(message => (
							<option key={message.id} value={message.id}>
								{message.kind === 'service' ? `call.${message.label}` : `notify.${message.label}`}
							</option>
						))}
					</select>
				</div>

				{(selectedMessage?.fields ?? []).map(field => (
					<div className={styles.fieldGroup} key={field.name}>
						<label htmlFor={`${meta.title}-${field.name}`}>{field.label}</label>
						<input id={`${meta.title}-${field.name}`} type={field.type === 'number' ? 'number' : 'text'} value={fieldValues[field.name] ?? ''} onChange={event => setFieldValues(current => ({ ...current, [field.name]: event.target.value }))} disabled={busy} />
					</div>
				))}

				<button type="button" className={styles.primaryButton} onClick={() => void runDispatch()} disabled={busy || !selectedMessage}>
					{selectedMessage ? (selectedMessage.kind === 'service' ? `Call ${selectedMessage.label}` : `Notify ${selectedMessage.label}`) : 'Send'}
				</button>
				<button type="button" className={styles.secondaryButton} onClick={onReset} disabled={busy}>
					Reset
				</button>
				{meta.extraActions?.map(action => (
					<button key={action.id} type="button" className={styles.secondaryButton} onClick={() => void onExtraAction(action.id)} disabled={busy}>
						{action.label}
					</button>
				))}
			</div>

			<div className={styles.statusRow}>
				<strong>State</strong>
				<span>{stateText}</span>
				{lastCallResult !== undefined && (
					<>
						<strong>Last call</strong>
						<span>{lastCallResult}</span>
					</>
				)}
				{error && (
					<>
						<strong>Error</strong>
						<span className={styles.error}>{error}</span>
					</>
				)}
			</div>

			{meta.mousePad && (
				<div className={styles.mousePad} onMouseMove={onPadMove} role="application" aria-label={meta.mousePad.label}>
					<span className={styles.mousePadLabel}>{meta.mousePad.label}</span>
					{meta.mousePad.hint && <span className={styles.mousePadHint}>{meta.mousePad.hint}</span>}
				</div>
			)}

			<label className={styles.traceLabel} htmlFor={`${meta.title}-trace`}>
				Trace
			</label>
			<textarea ref={traceRef} id={`${meta.title}-trace`} className={styles.trace} readOnly value={traceText} rows={16} spellCheck={false} />
		</section>
	);
}
