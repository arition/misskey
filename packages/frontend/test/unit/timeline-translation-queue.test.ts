/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTranslationQueue } from '@/dollars/translation/queue.js';

const note = { id: 'note', text: 'こんにちは', cw: null };
const result = { sourceLang: 'ja', text: '你好' };
const signal = () => new AbortController().signal;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('timeline translation queue', () => {
	test('deduplicates in-flight requests and reuses the result for reposts', async () => {
		let resolve!: (value: typeof result) => void;
		const request = vi.fn(() => new Promise<typeof result>(r => { resolve = r; }));
		const queue = createTranslationQueue(request);
		const first = queue.translate('alice', note, 'zh-CN', signal());
		const second = queue.translate('alice', note, 'zh-CN', signal());
		expect(request).toHaveBeenCalledTimes(1);
		resolve(result);
		expect(await first).toEqual(result);
		expect(await second).toEqual(result);
		expect(await queue.translate('alice', note, 'zh-CN', signal())).toEqual(result);
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('serializes requests and leaves headroom under the 10/minute API limit', async () => {
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request);
		await queue.translate('alice', note, 'zh-CN', signal());
		const second = queue.translate('alice', { ...note, id: 'second' }, 'zh-CN', signal());
		await vi.advanceTimersByTimeAsync(7999);
		expect(request).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await second).toEqual(result);
		expect(request).toHaveBeenCalledTimes(2);
	});

	test('cancelling one copy does not abort a request needed by another copy', async () => {
		let resolve!: (value: typeof result) => void;
		const request = vi.fn((_id: string, _lang: string, _signal: AbortSignal) => new Promise<typeof result>(r => { resolve = r; }));
		const queue = createTranslationQueue(request);
		const controller = new AbortController();
		const first = queue.translate('alice', note, 'zh-CN', controller.signal).catch(e => e.name);
		const second = queue.translate('alice', note, 'zh-CN', signal());
		controller.abort();
		expect(await first).toBe('AbortError');
		expect(request.mock.calls[0][2].aborted).toBe(false);
		resolve(result);
		expect(await second).toEqual(result);
	});

	test('removes offscreen queued work before it reaches the API', async () => {
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request);
		await queue.translate('alice', note, 'zh-CN', signal());
		const controller = new AbortController();
		const pending = queue.translate('alice', { ...note, id: 'offscreen' }, 'zh-CN', controller.signal).catch(e => e.name);
		controller.abort();
		expect(await pending).toBe('AbortError');
		await vi.advanceTimersByTimeAsync(60000);
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('aborts in-flight work when its last subscriber leaves', async () => {
		const request = vi.fn((_id: string, _lang: string, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
			signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
		}));
		const queue = createTranslationQueue(request);
		const controller = new AbortController();
		const pending = queue.translate('alice', note, 'zh-CN', controller.signal).catch(e => e.name);
		controller.abort();
		expect(await pending).toBe('AbortError');
		expect(request.mock.calls[0][2].aborted).toBe(true);
	});

	test('separates accounts, languages, edits, and CW changes in the cache', async () => {
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request);
		await queue.translate('alice', note, 'zh-CN', signal());
		for (const [account, changedNote, lang] of [
			['bob', note, 'zh-CN'],
			['alice', note, 'en-US'],
			['alice', { ...note, text: 'こんばんは' }, 'zh-CN'],
			['alice', { ...note, cw: 'warning' }, 'zh-CN'],
		] as const) {
			const pending = queue.translate(account, changedNote, lang, signal());
			await vi.advanceTimersByTimeAsync(8000);
			await pending;
		}
		expect(request).toHaveBeenCalledTimes(5);
	});

	test('expires cached translations after five minutes', async () => {
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request);
		await queue.translate('alice', note, 'zh-CN', signal());
		await vi.advanceTimersByTimeAsync(300001);
		await queue.translate('alice', note, 'zh-CN', signal());
		expect(request).toHaveBeenCalledTimes(2);
	});

	test('does not repeatedly retry a failed note while scrolling', async () => {
		const request = vi.fn(async () => { throw new Error('Unavailable'); });
		const queue = createTranslationQueue(request);
		await expect(queue.translate('alice', note, 'zh-CN', signal())).rejects.toThrow('Unavailable');
		await expect(queue.translate('alice', note, 'zh-CN', signal())).rejects.toThrow('cooling down');
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('backs off the whole queue when the API reports rate limiting', async () => {
		const request = vi.fn().mockRejectedValueOnce({ code: 'RATE_LIMIT_EXCEEDED' }).mockResolvedValue(result);
		const queue = createTranslationQueue(request);
		await expect(queue.translate('alice', note, 'zh-CN', signal())).rejects.toEqual({ code: 'RATE_LIMIT_EXCEEDED' });
		const pending = queue.translate('alice', { ...note, id: 'next' }, 'zh-CN', signal());
		await vi.advanceTimersByTimeAsync(64999);
		expect(request).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(await pending).toEqual(result);
	});

	test('batches saved hits and displays them without waiting for a provider miss', async () => {
		let finish!: (value: typeof result) => void;
		const request = vi.fn(() => new Promise<typeof result>(resolve => { finish = resolve; }));
		const lookup = vi.fn(async (_account, ids: string[]) => ids.filter(id => id !== 'miss').map(noteId => ({ noteId, ...result })));
		const queue = createTranslationQueue(request, lookup);
		const miss = queue.translate('alice', { ...note, id: 'miss' }, 'zh-CN', signal());
		const hits = [note, { ...note, id: 'other' }].map(n => queue.translate('alice', n, 'zh-CN', signal()));
		await vi.advanceTimersByTimeAsync(75);
		expect(lookup).toHaveBeenCalledExactlyOnceWith('alice', ['miss', 'note', 'other'], 'zh-CN');
		expect(await Promise.all(hits)).toEqual([result, result]);
		expect(request).toHaveBeenCalledTimes(1);
		finish(result);
		await miss;
		await queue.translate('alice', note, 'zh-CN', signal());
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	test('does not let a rate-limited provider queue delay a later cache hit', async () => {
		const request = vi.fn().mockRejectedValue({ code: 'RATE_LIMIT_EXCEEDED' });
		const lookup = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ noteId: 'other', ...result }]);
		const queue = createTranslationQueue(request, lookup);
		const miss = queue.translate('alice', note, 'zh-CN', signal()).catch(error => error);
		await vi.advanceTimersByTimeAsync(75);
		await miss;
		const hit = queue.translate('alice', { ...note, id: 'other' }, 'zh-CN', signal());
		await vi.advanceTimersByTimeAsync(75);
		expect(await hit).toEqual(result);
		expect(request).toHaveBeenCalledTimes(1);
	});

	test('does not translate a note cancelled during a cache lookup', async () => {
		let finish!: (value: []) => void;
		const lookup = vi.fn(() => new Promise<[]>(resolve => { finish = resolve; }));
		const request = vi.fn();
		const queue = createTranslationQueue(request, lookup);
		const controller = new AbortController();
		const pending = queue.translate('alice', note, 'zh-CN', controller.signal).catch(error => error.name);
		await vi.advanceTimersByTimeAsync(75);
		controller.abort();
		finish([]);
		expect(await pending).toBe('AbortError');
		await vi.advanceTimersByTimeAsync(8000);
		expect(request).not.toHaveBeenCalled();
	});

	test('falls back to paced translation when the batch lookup fails', async () => {
		const lookup = vi.fn().mockRejectedValue(new Error('offline'));
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request, lookup);
		const first = queue.translate('alice', note, 'zh-CN', signal());
		const second = queue.translate('alice', { ...note, id: 'other' }, 'zh-CN', signal());
		await vi.advanceTimersByTimeAsync(75);
		expect(await first).toEqual(result);
		expect(request).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(8000);
		expect(await second).toEqual(result);
		expect(request).toHaveBeenCalledTimes(2);
	});

	test('rejects already-cancelled work without sending it', async () => {
		const request = vi.fn(async () => result);
		const queue = createTranslationQueue(request);
		const controller = new AbortController();
		controller.abort();
		await expect(queue.translate('alice', note, 'zh-CN', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
		expect(request).not.toHaveBeenCalled();
	});
});
