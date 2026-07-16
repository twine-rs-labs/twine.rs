import {readdirSync, readFileSync} from 'fs';
import {join, relative} from 'path';
import ts from 'typescript';

function tsxFiles(directory: string): string[] {
	return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
		const path = join(directory, entry.name);

		if (entry.isDirectory()) {
			return tsxFiles(path);
		}

		return entry.isFile() && entry.name.endsWith('.tsx') ? [path] : [];
	});
}

describe('React DOM-node compatibility', () => {
	it('provides nodeRef to every CSSTransition and DraggableCore', () => {
		const sourceRoot = join(process.cwd(), 'src');
		const missingNodeRefs: string[] = [];

		for (const path of tsxFiles(sourceRoot)) {
			const source = ts.createSourceFile(
				path,
				readFileSync(path, 'utf8'),
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TSX
			);
			const visit = (node: ts.Node) => {
				if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
					const tagName = node.tagName.getText(source);

					if (
						(tagName === 'CSSTransition' || tagName === 'DraggableCore') &&
						!node.attributes.properties.some(
							property =>
								ts.isJsxAttribute(property) &&
								property.name.getText(source) === 'nodeRef'
						)
					) {
						const location = source.getLineAndCharacterOfPosition(
							node.getStart(source)
						);

						missingNodeRefs.push(
							`${relative(process.cwd(), path)}:${location.line + 1} <${tagName}>`
						);
					}
				}

				ts.forEachChild(node, visit);
			};

			ts.forEachChild(source, visit);
		}

		expect(missingNodeRefs).toEqual([]);
	});
});
