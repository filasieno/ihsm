/** @type {import('eslint').Rule.RuleModule} */
export const noMultilineImport = {
	meta: {
		type: 'layout',
		docs: {
			description: 'Disallow line breaks inside import statements',
		},
		messages: {
			multiline: 'Import statements must be written on a single line.',
		},
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode ?? context.getSourceCode();
		return {
			ImportDeclaration(node) {
				const text = sourceCode.getText(node);
				if (text.includes('\n')) {
					context.report({ node, messageId: 'multiline' });
				}
			},
		};
	},
};
