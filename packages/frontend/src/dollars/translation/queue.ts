/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';

export type TranslationNote = Pick<entities.Note, 'id' | 'text' | 'cw'>;
type Translation = entities.NotesTranslateResponse | undefined;
type Request = (noteId: string, targetLang: string, signal: AbortSignal, accountId: string) => Promise<Translation>;
type Lookup = (accountId: string, noteIds: string[], targetLang: string) => Promise<({ noteId: string } & NonNullable<Translation>)[]>;
type Subscriber = { resolve: (value: Translation) => void; reject: (error: unknown) => void };
type Job = {
	key: string;
	accountId: string;
	noteId: string;
	targetLang: string;
	controller: AbortController;
	subscribers: Set<Subscriber>;
};

const INTERVAL = 8000; // Leave room for manual translation within the API's 10/minute limit.
const LOOKUP_WINDOW = 75;
const LOOKUP_BATCH_SIZE = 20;
const CACHE_TTL = 5 * 60000;
const ERROR_TTL = 60000;
const MAX_CACHE = 100;
const MAX_QUEUE = 40;

/** Tab-local only: never persist private note text or share translations between accounts. */
export function createTranslationQueue(request: Request, lookup?: Lookup) {
	const jobs = new Map<string, Job>();
	const queue: Job[] = [];
	const awaitingLookup = new Set<Job>();
	let lookupTimer: number | undefined;
	const cache = new Map<string, { value?: Translation; failed?: boolean; expires: number }>();
	let active = false;
	let nextRequestAt = 0;
	let timer: number | undefined;

	function remember(key: string, entry: { value?: Translation; failed?: boolean; expires: number }) {
		cache.delete(key);
		cache.set(key, entry);
		while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
	}

	function resolveJob(job: Job, value: Translation) {
		if (job.controller.signal.aborted) return;
		remember(job.key, { value, expires: Date.now() + CACHE_TTL });
		for (const subscriber of job.subscribers) subscriber.resolve(value);
	}

	function flushLookups() {
		lookupTimer = undefined;
		const groups = new Map<string, Job[]>();
		for (const job of awaitingLookup) {
			const key = JSON.stringify([job.accountId, job.targetLang]);
			const group = groups.get(key);
			if (group) group.push(job);
			else groups.set(key, [job]);
		}
		awaitingLookup.clear();
		for (const group of groups.values()) {
			for (let i = 0; i < group.length; i += LOOKUP_BATCH_SIZE) {
				void lookUp(group.slice(i, i + LOOKUP_BATCH_SIZE));
			}
		}
	}

	async function lookUp(batch: Job[]) {
		const { accountId, targetLang } = batch[0];
		const results = new Map<string, NonNullable<Translation>>();
		try {
			for (const { noteId, sourceLang, text } of await lookup!(accountId, [...new Set(batch.map(job => job.noteId))], targetLang)) {
				results.set(noteId, { sourceLang, text });
			}
		} catch {
			// An unavailable or rate-limited lookup can fall back to the existing paced API.
		}
		for (const job of batch) {
			if (job.controller.signal.aborted) continue;
			const result = results.get(job.noteId);
			if (result) {
				jobs.delete(job.key);
				resolveJob(job, result);
			} else {
				queue.push(job);
			}
		}
		pump();
	}

	function pump() {
		if (active || timer != null || queue.length === 0) return;
		const delay = nextRequestAt - Date.now();
		if (delay > 0) {
			timer = window.setTimeout(() => {
				timer = undefined;
				pump();
			}, delay);
			return;
		}
		const job = queue.shift()!;
		active = true;
		nextRequestAt = Date.now() + INTERVAL;
		void (async () => {
			try {
				const value = await request(job.noteId, job.targetLang, job.controller.signal, job.accountId);
				resolveJob(job, value);
			} catch (error) {
				if (!job.controller.signal.aborted) {
					remember(job.key, { failed: true, expires: Date.now() + ERROR_TTL });
					if ((error as { code?: string } | null)?.code === 'RATE_LIMIT_EXCEEDED') {
						nextRequestAt = Date.now() + 65000;
					}
					for (const subscriber of job.subscribers) subscriber.reject(error);
				}
			} finally {
				if (jobs.get(job.key) === job) jobs.delete(job.key);
				active = false;
				pump();
			}
		})();
	}

	function translate(accountId: string, note: TranslationNote, targetLang: string, signal: AbortSignal): Promise<Translation> {
		if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
		// Content and CW are included so an edited note cannot reuse an old translation.
		const key = JSON.stringify([accountId, note.id, note.text, note.cw, targetLang]);
		const cached = cache.get(key);
		if (cached && cached.expires > Date.now()) {
			return cached.failed ? Promise.reject(new Error('Translation cooling down')) : Promise.resolve(cached.value);
		}
		cache.delete(key);

		let job = jobs.get(key);
		if (!job) {
			if (jobs.size >= MAX_QUEUE) return Promise.reject(new Error('Translation queue full'));
			job = { key, accountId, noteId: note.id, targetLang, controller: new AbortController(), subscribers: new Set() };
			jobs.set(key, job);
			if (lookup) {
				awaitingLookup.add(job);
				lookupTimer ??= window.setTimeout(flushLookups, LOOKUP_WINDOW);
			} else {
				queue.push(job);
			}
		}
		const currentJob = job;
		return new Promise((resolve, reject) => {
			const cleanup = () => signal.removeEventListener('abort', cancel);
			const subscriber: Subscriber = {
				resolve: value => { cleanup(); resolve(value); },
				reject: error => { cleanup(); reject(error); },
			};
			const cancel = () => {
				currentJob.subscribers.delete(subscriber);
				cleanup();
				reject(new DOMException('Cancelled', 'AbortError'));
				if (currentJob.subscribers.size === 0) {
					currentJob.controller.abort();
					if (jobs.get(key) === currentJob) jobs.delete(key);
					awaitingLookup.delete(currentJob);
					const index = queue.indexOf(currentJob);
					if (index >= 0) queue.splice(index, 1);
					if (queue.length === 0 && timer != null) {
						window.clearTimeout(timer);
						timer = undefined;
					}
				}
			};
			currentJob.subscribers.add(subscriber);
			signal.addEventListener('abort', cancel, { once: true });
			pump();
		});
	}

	return { translate };
}
