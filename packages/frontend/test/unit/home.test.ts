/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, assert, describe, expect, test, vi } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/vue';
import { defineComponent, nextTick, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { directives } from '@/directives/index.js';
import { components } from '@/components/index.js';
import XHome from '@/pages/user/home.vue';
import XNotes from '@/pages/user/notes.vue';
import { instance } from '@/instance.js';
import { note, userDetailed } from '../../.storybook/fakes.js';
import { preferReactive } from '../setup.unit.js';
import 'intersection-observer';

const { translate, viewer } = vi.hoisted(() => ({
	translate: vi.fn(),
	viewer: { signedIn: false },
}));
vi.mock('@/dollars/translation/queue.js', () => ({ createTranslationQueue: () => ({ translate }) }));
vi.mock('@/i.js', async (importOriginal) => ({
	...await importOriginal<typeof import('@/i.js')>(),
	get $i() {
		return viewer.signedIn ? { id: 'viewer', policies: { canUseTranslator: true }, mutedWords: [], hardMutedWords: [] } : null;
	},
}));

describe('XHome', () => {
	const renderHome = (user: Partial<Misskey.entities.UserDetailed>): RenderResult => {
		return render(XHome, {
			props: { user: user as Misskey.entities.UserDetailed, disableNotes: true },
			global: { directives, components },
		});
	};

	afterEach(() => {
		cleanup();
	});

	test('Should render the remote caution when user.host exists', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			host: 'example.com',
			uri: 'https://example.com/@user',
			url: 'https://example.com/@user/profile',
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href^="https://example.com/"]');
		assert.exists(anchor, 'anchor to the remote exists');
		assert.strictEqual(anchor?.href, 'https://example.com/@user/profile');
	});

	test('The remote caution should fall back to uri if url is null', async () => {
		const home = renderHome({
			id: 'blobcat',
			name: 'blobcat',
			host: 'example.com',
			uri: 'https://example.com/@user',
			url: null,
			roles: [],
			createdAt: '1970-01-01T00:00:00.000Z',
			fields: [],
			pinnedNotes: [],
			avatarUrl: 'https://example.com',
			avatarDecorations: [],
		});

		const anchor = home.container.querySelector<HTMLAnchorElement>('a[href^="https://example.com/"]');
		assert.exists(anchor, 'anchor to the remote exists');
		assert.strictEqual(anchor?.href, 'https://example.com/@user');
	});
});

describe('profile note translation', () => {
	const original = { ...note('profile-note'), text: 'こんにちは', reactionAcceptance: 'likeOnly' as const };
	const profile = { ...userDetailed(), pinnedNotes: [original] };
	const enabled = ref(false);
	const global = {
		directives,
		components,
		stubs: {
			MkFollowButton: true,
			MkPagination: defineComponent({
				setup: (_props, { slots }) => () => slots.default?.({ items: [original] }),
			}),
		},
	} satisfies NonNullable<Parameters<typeof render>[1]>['global'];

	afterEach(() => {
		cleanup();
		delete preferReactive.timelineAutoTranslate;
		instance.translatorAvailable = false;
		viewer.signedIn = false;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test.each(['pinned note', 'Notes tab'])('translates a visible %s after opt-in', async surface => {
		const intersections: IntersectionObserverCallback[] = [];
		vi.stubGlobal('IntersectionObserver', class {
			constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
			private callback: IntersectionObserverCallback;
			observe(element: Element) {
				if (element.querySelector('article')) intersections.push(this.callback);
			}
			unobserve() { /* Not needed for manual observations. */ }
			disconnect() { /* Not needed for manual observations. */ }
		});
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		translate.mockReset().mockResolvedValue({ sourceLang: 'ja', text: 'Hello' });
		enabled.value = false;
		preferReactive.timelineAutoTranslate = enabled;
		instance.translatorAvailable = true;
		viewer.signedIn = true;

		const page = surface === 'pinned note'
			? render(XHome, { props: { user: profile, disableNotes: true }, global })
			: render(XNotes, { props: { user: profile }, global });
		expect(page.getByText(original.text)).toBeTruthy();
		expect(intersections).toHaveLength(0);
		enabled.value = true;
		await nextTick();
		expect(translate).not.toHaveBeenCalled();
		expect(intersections).toHaveLength(1);
		intersections[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
		expect(await page.findByText('Hello')).toBeTruthy();
		expect(page.getByText(original.text)).toBeTruthy();
	});
});
