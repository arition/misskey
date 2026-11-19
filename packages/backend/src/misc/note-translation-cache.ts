/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { llmTranslationCacheVersion, translateWithLlm } from './translation.js';
import type { LlmTranslationSettings } from './translation.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { MiNote } from '@/models/Note.js';
import type { MiNoteTranslation } from '@/models/NoteTranslation.js';
import type { Repository } from 'typeorm';

type Translation = Pick<MiNoteTranslation, 'sourceLang' | 'text'>;
const inFlight = new Map<string, Promise<Translation>>();

export function translationFingerprint(settings: LlmTranslationSettings, note: Pick<MiNote, 'text' | 'cw'>): string {
	return createHash('sha256')
		.update(JSON.stringify([llmTranslationCacheVersion, settings.llmTranslationBaseUrl, settings.llmTranslationModel, note.text, note.cw]))
		.digest('hex');
}

export function translationCacheLanguage(targetLang: string): string | undefined {
	return targetLang.length <= 64 && /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i.test(targetLang) ? targetLang.toLowerCase() : undefined;
}

/** The caller must check the requesting user's access to the note before calling. */
export async function getLlmNoteTranslation(
	repository: Pick<Repository<MiNoteTranslation>, 'findOneBy' | 'upsert'>,
	http: Pick<HttpRequestService, 'send'>,
	{ llmTranslationBaseUrl, llmTranslationModel, llmTranslationApiKey }: LlmTranslationSettings,
	note: Pick<MiNote, 'id' | 'text' | 'cw'>,
	text: string,
	targetLang: string,
): Promise<Translation> {
	const cacheLang = translationCacheLanguage(targetLang);
	if (!cacheLang) throw new Error('Invalid translation language code');

	const settings = { llmTranslationBaseUrl, llmTranslationModel, llmTranslationApiKey };
	const { id: noteId } = note;
	const fingerprint = translationFingerprint(settings, note);
	const key = JSON.stringify([noteId, cacheLang, fingerprint]);
	const pending = inFlight.get(key);
	if (pending) return await pending;

	const translation = (async () => {
		const cached = await repository.findOneBy({ noteId, targetLang: cacheLang, fingerprint });
		if (cached) return { sourceLang: cached.sourceLang, text: cached.text };

		const result = await translateWithLlm(http, settings, text, targetLang);
		await repository.upsert({ noteId, targetLang: cacheLang, fingerprint, ...result }, ['noteId', 'targetLang']);
		return result;
	})();
	inFlight.set(key, translation);
	try {
		return await translation;
	} finally {
		inFlight.delete(key);
	}
}
