/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { mock } from 'vitest-mock-extended';
import TranslateEndpoint from '@/server/api/endpoints/notes/translate.js';
import { isTranslatorAvailable } from '@/misc/translation.js';
import type { MiMeta, MiNote } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import type { GetterService } from '@/server/api/GetterService.js';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { Response } from 'node-fetch';
import type { DataSource, Repository } from 'typeorm';
import type { MiNoteTranslation } from '@/models/NoteTranslation.js';

const translated = { sourceLang: 'ja', text: 'Hello!\n:wave: @user #tag https://example.com' };

function response(json: unknown): Response {
	return { json: async () => json } as Response;
}

function completion(content: unknown = JSON.stringify(translated), finishReason = 'stop') {
	return response({ choices: [{ finish_reason: finishReason, message: { content } }] });
}

describe('notes/translate', () => {
	const settings = mock<MiMeta>();
	const notes = mock<NoteEntityService>();
	const getter = mock<GetterService>();
	const http = mock<HttpRequestService>();
	const roles = mock<RoleService>();
	const db = mock<DataSource>();
	const cache = mock<Repository<MiNoteTranslation>>();
	const me = { id: 'user' } as MiLocalUser;
	const note = { id: 'note', text: 'こんにちは！', cw: '警告' } as MiNote;
	let endpoint: TranslateEndpoint;

	beforeEach(() => {
		settings.translationProvider = 'llm';
		settings.llmTranslationBaseUrl = 'https://example.com/v1/';
		settings.llmTranslationApiKey = 'secret';
		settings.llmTranslationModel = 'test-model';
		settings.deeplAuthKey = null;
		http.send.mockReset();
		http.send.mockResolvedValue(completion());
		roles.getUserPolicies.mockResolvedValue({ canUseTranslator: true } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
		getter.getNote.mockResolvedValue(note);
		notes.isVisibleForMe.mockResolvedValue(true);
		notes.pack.mockResolvedValue({} as Awaited<ReturnType<NoteEntityService['pack']>>);
		db.getRepository.mockReturnValue(cache);
		cache.findOneBy.mockResolvedValue(null);
		endpoint = new TranslateEndpoint(settings, notes, getter, http, roles, db);
	});

	const exec = (targetLang = 'zh-TW') => endpoint.exec({ noteId: 'note', targetLang }, me, null);

	test('translates CW and text, preserves target locale, and returns the existing response shape', async () => {
		await expect(exec()).resolves.toEqual(translated);
		expect(http.send).toHaveBeenCalledWith('https://example.com/v1/chat/completions', expect.objectContaining({
			method: 'POST',
			headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
			timeout: 60000,
			redirect: 'error',
			size: 1024 * 1024,
		}));
		const body = JSON.parse(http.send.mock.calls[0][1]!.body as string);
		expect(body.model).toBe('test-model');
		expect(body.max_tokens).toBe(8192);
		expect(body.messages[0].role).toBe('system');
		expect(JSON.parse(body.messages[1].content)).toEqual({ targetLang: 'zh-TW', text: '警告\n-----\nこんにちは！' });
	});

	test('supports keyless local providers without bypassing network protections', async () => {
		settings.llmTranslationApiKey = null;
		settings.llmTranslationBaseUrl = 'http://localhost:11434/v1';
		await exec();
		const options = http.send.mock.calls[0][1]!;
		expect(options.headers).not.toHaveProperty('Authorization');
		expect(options.isLocalAddressAllowed).not.toBe(true);
	});

	test('denies users without the translator policy before contacting the provider', async () => {
		roles.getUserPolicies.mockResolvedValue({ canUseTranslator: false } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('does not contact the provider for nonexistent notes', async () => {
		getter.getNote.mockRejectedValueOnce({ id: '9725d0ce-ba28-4dde-95a7-2cbb2c15de24' });
		await expect(exec()).rejects.toMatchObject({ code: 'NO_SUCH_NOTE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('does not use DeepL when the selected LLM is unconfigured', async () => {
		settings.llmTranslationModel = '';
		settings.deeplAuthKey = 'deepl-key';
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('does not use the LLM when DeepL is selected without a key', async () => {
		settings.translationProvider = 'deepl';
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('does not send invisible notes', async () => {
		notes.isVisibleForMe.mockResolvedValue(false);
		await expect(exec()).rejects.toMatchObject({ code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('does not send hidden note content', async () => {
		notes.pack.mockResolvedValue({ isHidden: true } as Awaited<ReturnType<NoteEntityService['pack']>>);
		await expect(exec()).rejects.toMatchObject({ code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('skips empty notes', async () => {
		getter.getNote.mockResolvedValue({ ...note, text: ' ', cw: null });
		await expect(exec()).resolves.toBeUndefined();
		expect(http.send).not.toHaveBeenCalled();
	});

	test('keeps DeepL behavior when selected', async () => {
		settings.translationProvider = 'deepl';
		settings.deeplAuthKey = 'deepl-key';
		settings.deeplIsPro = false;
		http.send.mockResolvedValue(response({ translations: [{ detected_source_language: 'JA', text: 'Hello' }] }));
		await expect(exec()).resolves.toEqual({ sourceLang: 'JA', text: 'Hello' });
		expect(http.send).toHaveBeenCalledWith('https://api-free.deepl.com/v2/translate', expect.objectContaining({
			body: expect.stringContaining('target_lang=zh'),
		}));
	});

	test.each([
		null, {}, { choices: [] },
		{ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(translated) } }] },
		{ choices: [{ finish_reason: 'stop', message: { content: null } }] },
		{ choices: [{ finish_reason: 'stop', message: { content: 'not JSON' } }] },
		{ choices: [{ finish_reason: 'stop', message: { content: '{"sourceLang":"ja","text":""}' } }] },
		{ choices: [{ finish_reason: 'stop', message: { content: '{"sourceLang":"invalid language","text":"hello"}' } }] },
	])('rejects malformed or incomplete upstream responses: %j', async (json) => {
		http.send.mockResolvedValue(response(json));
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE', info: undefined });
	});

	test('does not leak upstream errors or fall back to another provider', async () => {
		http.send.mockRejectedValue(new Error('secret private note'));
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE', info: undefined });
		expect(http.send).toHaveBeenCalledTimes(1);
	});

	test.each(['ftp://example.com', 'https://user:pass@example.com', 'https://example.com?key=secret', 'not a URL'])('rejects unsafe base URL %s', async (url) => {
		settings.llmTranslationBaseUrl = url;
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('bounds input before contacting the provider', async () => {
		getter.getNote.mockResolvedValueOnce({ ...note, text: 'x'.repeat(32769), cw: null });
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});

	test('rejects oversized translated text', async () => {
		http.send.mockResolvedValueOnce(completion(JSON.stringify({ sourceLang: 'en', text: 'x'.repeat(65537) })));
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
	});

	test('bounds concurrent requests and releases slots after errors', async () => {
		let fail!: (error: Error) => void;
		const pending = new Promise<Response>((_resolve, reject) => { fail = reject; });
		http.send.mockReturnValue(pending);
		const requests = ['de', 'en', 'fr', 'ko'].map(lang => exec(lang));
		// Both permission and visibility checks are asynchronous.
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(http.send).toHaveBeenCalledTimes(4);
		await expect(exec()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		fail(new Error('timeout'));
		await Promise.allSettled(requests);
		http.send.mockResolvedValue(completion());
		await expect(exec()).resolves.toEqual(translated);
	});

	test('availability follows the selected provider, including keyless LLMs', () => {
		settings.llmTranslationApiKey = null;
		expect(isTranslatorAvailable(settings)).toBe(true);
		settings.llmTranslationModel = ' ';
		expect(isTranslatorAvailable(settings)).toBe(false);
		settings.translationProvider = 'deepl';
		expect(isTranslatorAvailable(settings)).toBe(false);
		settings.deeplAuthKey = 'key';
		expect(isTranslatorAvailable(settings)).toBe(true);
	});
});
