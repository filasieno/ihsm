#!/usr/bin/env python3
"""Rename Machine → Hsm, makeMachine → makeHsm, MachineError → HsmError."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'node_modules', '.tsc', 'lib', 'docs-build', 'website/.docusaurus', 'coverage', '.nyc_output'}

REPLACEMENTS = [
    ('makeMachine', 'makeHsm'),
    ('MachineError', 'HsmError'),
    ('SingleMachineRuntime', 'SingleHsmRuntime'),
    ('getSenderMachine', 'getSenderHsm'),
    ('MachineTop', 'HsmTop'),
    ("'MachineTop'", "'HsmTop'"),
    ('@link makeHsm', '@link makeHsm'),  # idempotent after first replace
]

HSM_INTERFACE = [
    (re.compile(r'\binterface Machine\b'), 'interface Hsm'),
    (re.compile(r'\bexport interface Machine\b'), 'export interface Hsm'),
    (re.compile(r'\bMachine<'), 'Hsm<'),
    (re.compile(r'\bMachine>'), 'Hsm>'),
    (re.compile(r'\bMachine,'), 'Hsm,'),
    (re.compile(r'\bMachine;'), 'Hsm;'),
    (re.compile(r'\bMachine\('), 'Hsm('),
    (re.compile(r': Machine\b'), ': Hsm'),
    (re.compile(r'\(Machine\b'), '(Hsm'),
    (re.compile(r'return Machine\b'), 'return Hsm'),
    (re.compile(r'\{ Machine\b'), '{ Hsm'),
    (re.compile(r'@link Machine\b'), '@link Hsm'),
    (re.compile(r'\{@link Machine\b'), '{@link Hsm'),
    (re.compile(r'`Machine`'), '`Hsm`'),
    (re.compile(r'ihsm\.Machine<'), 'ihsm.Hsm<'),
    (re.compile(r': ihsm\.Machine\b'), ': ihsm.Hsm'),
]


def should_skip(path: Path) -> bool:
    parts = set(path.parts)
    if any(s in parts for s in SKIP):
        return True
    return path.suffix not in {'.ts', '.tsx', '.md', '.mdx', '.mjs', '.py'}


def transform(text: str) -> str:
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    for pattern, repl in HSM_INTERFACE:
        text = pattern.sub(repl, text)
    text = text.replace('makeHsm', '___MAKEHSM___')
    text = text.replace('HsmError', '___HSMERROR___')
    text = text.replace('HsmTop', '___HSMTOP___')
    text = text.replace('HsmObject', '___HSMOBJECT___')
    text = text.replace('HsmWithTracing', '___HSMWITHTRACING___')
    text = text.replace('SingleHsmRuntime', '___SINGLEHSM___')
    text = text.replace('getSenderHsm', '___GETSENDER___')
    # fix double ihsm
    text = text.replace('ihsm.ihsm.', 'ihsm.')
    text = text.replace('___MAKEHSM___', 'makeHsm')
    text = text.replace('___HSMERROR___', 'HsmError')
    text = text.replace('___HSMTOP___', 'HsmTop')
    text = text.replace('___HSMOBJECT___', 'HsmObject')
    text = text.replace('___HSMWITHTRACING___', 'HsmWithTracing')
    text = text.replace('___SINGLEHSM___', 'SingleHsmRuntime')
    text = text.replace('___GETSENDER___', 'getSenderHsm')
    return text


def patch_tutorial_machine(text: str) -> str:
    if "from '../../src'" not in text and 'from "../../src"' not in text:
        return text
    text = text.replace('ihsm.makeHsm', 'ihsm.makeHsm')  # already patched by global
    text = re.sub(r'(?<!ihsm\.)\bmakeHsm\b', 'ihsm.makeHsm', text)
    text = re.sub(r'(?<!ihsm\.)(?<!Door)(?<!Payment)(?<!\.)\bHsm<', 'ihsm.Hsm<', text)
    text = re.sub(r'ihsm\.ihsm\.', 'ihsm.', text)
    return text


def main() -> None:
    for path in ROOT.rglob('*'):
        if not path.is_file() or should_skip(path):
            continue
        if path.name == 'rename-hsm-api.py':
            continue
        original = path.read_text(encoding='utf-8')
        updated = transform(original)
        if '/tutorials/' in str(path) and path.name in {'machine.ts', 'trace-sibling.ts'}:
            updated = patch_tutorial_machine(updated)
        if updated != original:
            path.write_text(updated, encoding='utf-8')
            print(f'updated {path.relative_to(ROOT)}')

    old_spec = ROOT / 'src/spec/makeMachine.spec.ts'
    new_spec = ROOT / 'src/spec/makeHsm.spec.ts'
    if old_spec.exists():
        old_spec.rename(new_spec)
        print(f'renamed {new_spec.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
