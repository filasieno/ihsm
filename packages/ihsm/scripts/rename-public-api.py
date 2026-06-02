#!/usr/bin/env python3
"""One-off rename: Hsm* public API → shorter names, _hsmStateName → _stateName."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SKIP = {'node_modules', '.tsc', 'lib', 'docs-build', 'website/.docusaurus', 'website/docs'}

REPLACEMENTS = [
    ('HsmUnhandledEventError', 'UnhandledEventError'),
    ('HsmInitializationError', 'InitializationError'),
    ('HsmEventHandlerError', 'EventHandlerError'),
    ('HsmInitialStateError', 'InitialStateError'),
    ('HsmDispatchErrorCallback', 'DispatchErrorCallback'),
    ('HsmStateMachineEvents', 'StateEvents'),
    ('HsmEventHandlerPayload', 'EventPayload'),
    ('HsmEventHandlerName', 'PostedEvent'),
    ('HsmResolveCallback', 'ResolveCallback'),
    ('HsmTransitionError', 'TransitionError'),
    ('HsmFatalErrorState', 'FatalErrorState'),
    ('HsmThenDepthError', 'ThenDepthError'),
    ('HsmRuntimeError', 'RuntimeError'),
    ('HsmInitialState', 'InitialState'),
    ('HsmTraceWriter', 'TraceWriter'),
    ('HsmStateClass', 'StateClass'),
    ('HsmServiceRequest', 'ServiceRequest'),
    ('HsmServiceResponse', 'ServiceResponse'),
    ('HsmRejectCallback', 'RejectCallback'),
    ('HsmTraceLevel', 'TraceLevel'),
    ('HsmServiceName', 'ServiceName'),
    ('HsmProperties', 'Properties'),
    ('getStateDisplayName', 'getStateName'),
    ('defineStateDisplayName', 'defineStateName'),
    ('_hsmStateName', '_stateName'),
    ('hsmTopStateName', 'topStateName'),
    ('hsmStateName', 'stateName'),
    ('hsmContext', 'context'),
    ('HsmTopState', 'TopState'),
    ('makeHsm', 'makeHsm'),
    ('HsmFatalError', 'FatalError'),
    ('HsmError', 'HsmError'),
    ('HsmAny', 'Any'),
    ('HsmBase', 'Base'),
    ('HsmState', 'State'),
    ('@HsmInitialState', '@InitialState'),  # specs; tutorials fixed separately
    ("'HsmTopState'", "'TopState'"),
    ("'HsmFatalErrorState'", "'FatalErrorState'"),
    ("'HsmTransitionError'", "'TransitionError'"),
    ("'HsmThenDepthError'", "'ThenDepthError'"),
    ("'HsmUnhandledEventError'", "'UnhandledEventError'"),
    ("'HsmInitializationError'", "'InitializationError'"),
    ("'HsmInitialStateError'", "'InitialStateError'"),
    ("'HsmFatalError'", "'FatalError'"),
]

HSM_INTERFACE = [
    (re.compile(r'\bHsm<'), 'Hsm<'),
    (re.compile(r'\bHsm>'), 'Hsm>'),
    (re.compile(r'\bHsm,'), 'Hsm,'),
    (re.compile(r'\bHsm\('), 'Hsm('),
    (re.compile(r': Hsm\b'), ': Hsm'),
    (re.compile(r'\(Hsm\b'), '(Hsm'),
    (re.compile(r'\bHsm;'), 'Hsm;'),
    (re.compile(r'\bHsm\['), 'Machine['),
    (re.compile(r'return Hsm\b'), 'return Hsm'),
]


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    return any(s in parts for s in SKIP) or path.suffix not in {'.ts', '.tsx', '.md', '.mdx'}


def transform(text: str) -> str:
    text = text.replace('HsmObject', 'HsmObject')
    text = text.replace('HsmWithTracing', 'HsmWithTracing')
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    for pattern, repl in HSM_INTERFACE:
        text = pattern.sub(repl, text)
    text = text.replace('HsmObject', 'HsmObject')
    text = text.replace('HsmWithTracing', 'HsmWithTracing')
    return text


def patch_tutorial_machine(text: str) -> str:
    if "from '../../src'" not in text and 'from "../../src"' not in text:
        return text
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    has_ihsm = False
    for line in lines:
        if re.match(r"import .* from ['\"]\.\./\.\./src['\"];?\s*$", line):
            if not has_ihsm:
                out.append("import * as ihsm from '../../src';\n")
                has_ihsm = True
            continue
        out.append(line)
    text = ''.join(out)
    text = re.sub(r'\bextends TopState\b', 'extends ihsm.TopState', text)
    text = re.sub(r'\bextends FatalErrorState\b', 'extends ihsm.FatalErrorState', text)
    text = re.sub(r'@InitialState\b', '@ihsm.InitialState', text)
    text = re.sub(r'\bihsm\.TopState\b', 'ihsm.TopState', text)  # idempotent
    text = re.sub(r'\bmakeHsm\b', 'ihsm.makeHsm', text)
    text = re.sub(r'\bTraceLevel\b', 'ihsm.TraceLevel', text)
    text = re.sub(r'\bFatalErrorState\b(?!\.|\()', 'ihsm.FatalErrorState', text)
    text = re.sub(r'\bResolveCallback\b', 'ihsm.ResolveCallback', text)
    text = re.sub(r'\bRejectCallback\b', 'ihsm.RejectCallback', text)
    text = re.sub(r'\bMachine<', 'ihsm.Hsm<', text)
    text = re.sub(r': Hsm\b', ': ihsm.Hsm', text)
    text = re.sub(r'\bihsm\.ihsm\.', 'ihsm.', text)
    return text


def main() -> None:
    for path in ROOT.rglob('*'):
        if not path.is_file() or should_skip(path):
            continue
        original = path.read_text(encoding='utf-8')
        updated = transform(original)
        if '/tutorials/' in str(path) and path.name in {'machine.ts', 'trace-sibling.ts'}:
            updated = patch_tutorial_machine(updated)
        if updated != original:
            path.write_text(updated, encoding='utf-8')
            print(f'updated {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
