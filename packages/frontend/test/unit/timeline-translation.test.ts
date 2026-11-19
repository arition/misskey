/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computed, createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import type { entities } from 'misskey-js';
import { useTimelineTranslation } from '@/dollars/translation/use-timeline-translation.js';
import MkNoteSub from '@/components/MkNoteSub.vue';
import { note as fakeNote } from '../../.storybook/fakes.js';

const { translate } = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock('@/dollars/translation/queue.js', () => ({ createTranslationQueue: () => ({ translate }) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@/i.js', () => ({ $i: { id: 'alice', token: 'test' } }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: () => 'zh-CN' } }));
vi.mock('@/utility/check-word-mute.js', () => ({ checkWordMute: () => false }));
vi.mock('@/components/MkNoteHeader.vue', () => ({ default: () => null }));
vi.mock('@/components/MkSubNoteContent.vue', () => ({ default: ({ note }: { note: entities.Note }) => note.text }));
vi.mock('@/components/MkCwButton.vue', () => ({ default: {
	emits: ['update:modelValue'],
	setup: (_props: unknown, { emit }: { emit: (name: string, value: boolean) => void }) => () => h('button', { onClick: () => emit('update:modelValue', true) }, 'Reveal'),
} }));
vi.mock('@/i18n.js', () => ({ i18n: {
	ts: { deletedNote: 'Deleted', _timelineTranslation: { failed: 'Translation failed' } },
	tsx: { translatedFrom: ({ x }: { x: string }) => 'From ' + x },
} }));

let intersection: (entries: { isIntersecting: boolean }[]) => void;
const disconnect = vi.fn();
let app: App;
let container: HTMLDivElement;
const result = { sourceLang: 'ja', text: '你好' };

beforeEach(() => {
	translate.mockReset().mockResolvedValue(result);
	disconnect.mockClear();
	vi.stubGlobal('IntersectionObserver', class {
		constructor(callback: typeof intersection) { intersection = callback; }
		observe() { /* Driven by the test, not layout in happy-dom. */ }
		disconnect = disconnect;
	});
	Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
	container = document.createElement('div');
	document.body.append(container);
});
afterEach(() => {
	app?.unmount();
	container.remove();
	vi.unstubAllGlobals();
});

async function setup(cw: string | null = null, text = 'こんにちは') {
	const enabled = ref(false);
	const revealed = ref(false);
	const allowed = ref(true);
	const translation = ref<entities.NotesTranslateResponse | null>(null);
	const translating = ref(false);
	let failed!: ReturnType<typeof useTimelineTranslation>['failed'];
	app = createApp({
		setup() {
			const root = ref<HTMLElement | null>(null);
			({ failed } = useTimelineTranslation({
				root,
				eligible: computed(() => enabled.value && allowed.value && (cw == null || revealed.value)),
				note: { id: 'note', text, cw },
				accountId: 'alice',
				translation,
				translating,
			}));
			return () => h('div', { ref: root });
		},
	});
	app.mount(container);
	await nextTick();
	return { enabled, revealed, allowed, translation, translating, failed };
}

async function flush() {
	await nextTick();
	await Promise.resolve();
	await nextTick();
}

async function setupPreview(initial: { text?: string; cw?: string; isHidden?: boolean } | null = {}) {
	const makeNote = (values: NonNullable<typeof initial>): entities.Note => ({
		...fakeNote('parent'), text: '親の投稿', ...values,
	});
	const note = ref(initial === null ? null : makeNote(initial));
	const enabled = ref(false);
	app = createApp({ render: () => h(MkNoteSub, { note: note.value, autoTranslate: enabled.value }) });
	app.component('MkAvatar', () => null);
	app.component('MkLoading', () => h('span', 'Loading'));
	app.component('Mfm', ({ text }: { text: string }) => h('span', text));
	app.mount(container);
	await flush();
	return { note, makeNote, enabled };
}

describe('timeline reply parent previews', () => {
	test('shows the original and translated parent text only when auto-translation is enabled', async () => {
		const { enabled } = await setupPreview();
		expect(container.textContent).toContain('親の投稿');
		expect(translate).not.toHaveBeenCalled();
		enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledExactlyOnceWith('alice', { id: 'parent', text: '親の投稿', cw: null }, 'zh-CN', expect.any(AbortSignal));
		expect(container.textContent).toContain('親の投稿');
		expect(container.textContent).toContain('你好');
	});

	test('keeps a parent with a content warning out of the queue until opened', async () => {
		const { enabled } = await setupPreview({ cw: '警告' });
		enabled.value = true;
		await flush();
		expect(translate).not.toHaveBeenCalled();
		container.querySelector('button')!.click();
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledTimes(1);
	});

	test('waits for a missing parent and does not send a hidden parent', async () => {
		const { enabled, note, makeNote } = await setupPreview(null);
		enabled.value = true;
		await flush();
		const previousObserver = intersection;
		note.value = makeNote({ isHidden: true });
		await flush();
		expect(intersection).toBe(previousObserver);
		expect(translate).not.toHaveBeenCalled();
		note.value = makeNote({});
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledTimes(1);
	});
});

describe('visible timeline translation', () => {
	test('is opt-in and waits for the note to enter the viewport', async () => {
		const state = await setup();
		expect(translate).not.toHaveBeenCalled();
		state.enabled.value = true;
		await flush();
		expect(translate).not.toHaveBeenCalled();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledWith('alice', { id: 'note', text: 'こんにちは', cw: null }, 'zh-CN', expect.any(AbortSignal));
		expect(state.translation.value).toEqual(result);
		expect(state.translating.value).toBe(false);
	});

	test('does not send a CW-hidden note until the user opens it', async () => {
		const state = await setup('spoiler');
		state.enabled.value = true;
		await flush();
		expect(translate).not.toHaveBeenCalled();
		state.revealed.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledTimes(1);
	});

	test('does not send a hidden, muted, deleted, or disallowed note', async () => {
		const state = await setup();
		state.allowed.value = false;
		state.enabled.value = true;
		await flush();
		expect(translate).not.toHaveBeenCalled();
	});

	test('cancels queued work when switched off and ignores late responses', async () => {
		let resolve!: (value: typeof result) => void;
		translate.mockImplementation(() => new Promise(r => { resolve = r; }));
		const state = await setup();
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(state.translating.value).toBe(true);
		const signal = translate.mock.calls[0][3] as AbortSignal;
		state.enabled.value = false;
		await flush();
		expect(signal.aborted).toBe(true);
		expect(state.translating.value).toBe(false);
		resolve(result);
		await flush();
		expect(state.translation.value).toBeNull();
	});

	test('cancels when scrolled offscreen or unmounted', async () => {
		translate.mockImplementation(() => new Promise(() => {}));
		const state = await setup();
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		const signal = translate.mock.calls[0][3] as AbortSignal;
		intersection([{ isIntersecting: false }]);
		await flush();
		expect(signal.aborted).toBe(true);
		intersection([{ isIntersecting: true }]);
		await flush();
		const nextSignal = translate.mock.calls[1][3] as AbortSignal;
		app.unmount();
		expect(nextSignal.aborted).toBe(true);
		expect(disconnect).toHaveBeenCalled();
	});

	test('pauses while the browser tab is hidden', async () => {
		const state = await setup();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).not.toHaveBeenCalled();
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		document.dispatchEvent(new Event('visibilitychange'));
		await flush();
		expect(translate).toHaveBeenCalledTimes(1);
	});

	test('keeps a manual result and avoids a second automatic request', async () => {
		const state = await setup();
		state.translation.value = result;
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).not.toHaveBeenCalled();
	});

	test.each(['🎉 👍🏽', ':party_parrot: :wave:', '…!?', 'https://example.com', '@alice@example.com'])('skips non-text note %s without loading', async text => {
		const state = await setup(null, text);
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).not.toHaveBeenCalled();
		expect(state.translating.value).toBe(false);
		expect(state.failed.value).toBe(false);
	});

	test.each([[null, '草'], ['注意', '🎉']])('can translate short human text or a text CW', async (cw, text) => {
		const state = await setup(cw, text);
		state.enabled.value = true;
		state.revealed.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(translate).toHaveBeenCalledTimes(1);
	});

	test('reports failure inline without leaving a loading indicator', async () => {
		translate.mockRejectedValue(new Error('Unavailable'));
		const state = await setup();
		state.enabled.value = true;
		await flush();
		intersection([{ isIntersecting: true }]);
		await flush();
		expect(state.failed.value).toBe(true);
		expect(state.translating.value).toBe(false);
		expect(state.translation.value).toBeNull();
	});
});
