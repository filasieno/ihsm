/**
 * Render ```plantuml fenced blocks to SVG assets for the Docusaurus site.
 * Requires `plantuml` (and Graphviz) on PATH — provided by `nix develop` / `nix build .#docs`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLANTUML_CMD = process.env.PLANTUML ?? 'plantuml';

export const plantumlUrlPrefix = '/img/plantuml';

export function plantumlAssetDir(repoRoot) {
	return path.join(repoRoot, 'website/static/img/plantuml');
}

function assertPlantumlAvailable() {
	const check = spawnSync(PLANTUML_CMD, ['-version'], { encoding: 'utf8' });
		if (check.error?.code === 'ENOENT') {
		throw new Error(
			`${PLANTUML_CMD} not found. Install PlantUML + Graphviz (e.g. \`apt install plantuml graphviz\`), or use \`nix develop\` / \`nix build .#docs\`.`
		);
	}
}

/**
 * @param {string} markdown
 * @param {{ assetDir: string, urlPrefix: string, fileBase: string }} opts
 * @returns {string}
 */
export function renderPlantumlInMarkdown(markdown, { assetDir, urlPrefix, fileBase }) {
	if (!/```plantuml\n[\s\S]*?```/.test(markdown)) {
		return markdown;
	}

	assertPlantumlAvailable();
	fs.mkdirSync(assetDir, { recursive: true });

	let index = 0;

	return markdown.replace(/```plantuml\n([\s\S]*?)```/g, (_match, source) => {
		const name = `${fileBase}-${index++}`;
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihsm-puml-'));

		try {
			const pumlPath = path.join(tmpDir, `${name}.puml`);
			let body = source.trim();
			if (!body.includes('@startuml')) {
				body = `@startuml\n${body}\n@enduml`;
			}
			fs.writeFileSync(pumlPath, `${body}\n`);

			const result = spawnSync(
				PLANTUML_CMD,
				['-charset', 'UTF-8', '-tsvg', '-o', assetDir, pumlPath],
				{ encoding: 'utf8' }
			);
			if (result.status !== 0) {
				throw new Error(
					`plantuml failed for ${fileBase} diagram ${index}: ${result.stderr || result.stdout || 'unknown error'}`
				);
			}

			const svgPath = path.join(assetDir, `${name}.svg`);
			if (!fs.existsSync(svgPath)) {
				throw new Error(`plantuml did not produce ${svgPath}`);
			}

			return `\n![UML state diagram](${urlPrefix}/${name}.svg)\n`;
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
}
