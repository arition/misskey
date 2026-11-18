/*
 * SPDX-FileCopyrightText: arition
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const moduleUrl = new URL('packages/frontend-shared/dollars/typography.scss', root);
const stylesheet = readFileSync(moduleUrl, 'utf8');

test('both clients load the same source typography module', () => {
	for (const path of ['packages/frontend/src/style.scss', 'packages/frontend-embed/src/style.scss']) {
		const source = readFileSync(new URL(path, root), 'utf8');
		assert.equal(source.match(/@use '\.\.\/\.\.\/frontend-shared\/dollars\/typography\.scss';/g)?.length, 1);
	}
});

test('the inherited default preserves explicit system, icon, and code fonts', () => {
	assert.match(stylesheet, /html:not\(\.useSystemFont\)\s*\{\s*font-family:\s*"Inter",/);
	assert.match(stylesheet, /"BIZ UDGothic"/);
	assert.match(stylesheet, /"Noto Color Emoji"/);
	assert.doesNotMatch(stylesheet, /!important|\.ti\b|\._monospace\b/);
	assert.equal(stylesheet.split('font-display: swap;').length - 1, 2);
	assert.equal(stylesheet.split('font-weight: 100 900;').length - 1, 2);
	assert.match(stylesheet, /font-style: normal;/);
	assert.match(stylesheet, /font-style: italic;/);
});

test('fonts are local, intact Inter 4.1 WOFF2 assets with their license', () => {
	const expected = {
		'InterVariable.woff2': '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',
		'InterVariable-Italic.woff2': 'e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a',
	};
	const urls = [...stylesheet.matchAll(/url\('([^']+)'\)/g)].map(match => match[1]);
	assert.deepEqual(urls, Object.keys(expected).map(name => `./fonts/${name}`));
	for (const [name, sha256] of Object.entries(expected)) {
		const bytes = readFileSync(new URL(`./fonts/${name}`, moduleUrl));
		assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
		assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
	}
	const license = readFileSync(new URL('./fonts/LICENSE.txt', moduleUrl), 'utf8');
	assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});
