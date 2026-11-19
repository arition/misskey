/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getTimelineTranslationMenu } from '@/dollars/translation/menu.js';

const mocks = vi.hoisted(() => ({
	account: { policies: { canUseTranslator: true } },
	instance: { translatorAvailable: true },
	confirm: vi.fn(),
	commit: vi.fn(),
	enabled: { value: false },
}));
const enabled = mocks.enabled;
vi.mock('@/i.js', () => ({ $i: mocks.account }));
vi.mock('@/instance.js', () => ({ instance: mocks.instance }));
vi.mock('@/os.js', () => ({ confirm: mocks.confirm }));
vi.mock('@/preferences.js', () => ({ prefer: { r: { timelineAutoTranslate: mocks.enabled }, commit: mocks.commit } }));

beforeEach(() => {
	enabled.value = false;
	mocks.account.policies.canUseTranslator = true;
	mocks.instance.translatorAvailable = true;
	mocks.confirm.mockReset().mockResolvedValue({ canceled: false });
	mocks.commit.mockClear();
});

function toggle(value: boolean) {
	const item = getTimelineTranslationMenu()[0];
	if (!('type' in item) || item.type !== 'switch') throw new Error('Missing toggle');
	item.ref.value = value;
	return item;
}

describe('timeline auto-translation consent', () => {
	test('defaults to off and persists only after consent', async () => {
		const item = toggle(true);
		expect(item.ref.value).toBe(false);
		expect(mocks.commit).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(mocks.confirm).toHaveBeenCalledTimes(1);
		expect(mocks.commit).toHaveBeenCalledWith('timelineAutoTranslate', true);
	});

	test('does not enable translation when consent is cancelled', async () => {
		mocks.confirm.mockResolvedValue({ canceled: true });
		toggle(true);
		await Promise.resolve();
		expect(mocks.commit).not.toHaveBeenCalled();
	});

	test('can be disabled immediately without a confirmation', () => {
		enabled.value = true;
		toggle(false);
		expect(mocks.confirm).not.toHaveBeenCalled();
		expect(mocks.commit).toHaveBeenCalledWith('timelineAutoTranslate', false);
	});

	test('hides the toggle when the role cannot translate', () => {
		mocks.account.policies.canUseTranslator = false;
		expect(getTimelineTranslationMenu()).toEqual([]);
	});

	test('hides the toggle when the server has no translator', () => {
		mocks.instance.translatorAvailable = false;
		expect(getTimelineTranslationMenu()).toEqual([]);
	});
});
