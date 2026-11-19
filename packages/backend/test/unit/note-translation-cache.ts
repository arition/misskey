/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { mock } from 'vitest-mock-extended';
import Translate from '@/server/api/endpoints/notes/translate.js';
import type { DataSource, Repository } from 'typeorm';
import type { HttpRequestService } from '@/core/HttpRequestService.js';
import type { GetterService } from '@/server/api/GetterService.js';
import type { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { MiLocalUser } from '@/models/User.js';
import type { MiMeta, MiNote } from '@/models/_.js';
import type { MiNoteTranslation } from '@/models/NoteTranslation.js';

function completion(text: string) {
	return mock<Awaited<ReturnType<HttpRequestService['send']>>>({
		json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ sourceLang: 'ja', text }) } }] }),
	});
}

function setup() {
	const note = mock<MiNote>({ id: 'note1', text: 'こんにちは', cw: null, visibility: 'specified' });
	const alice = mock<MiLocalUser>({ id: 'alice' });
	const bob = mock<MiLocalUser>({ id: 'bob' });
	const settings = mock<MiMeta>({
		translationProvider: 'llm',
		llmTranslationBaseUrl: 'https://example.test/v1',
		llmTranslationModel: 'model-a',
	});
	const repo = mock<Repository<MiNoteTranslation>>();
	const rows = new Map<string, MiNoteTranslation>();
	repo.upsert.mockImplementation(async row => {
		const saved = row as MiNoteTranslation;
		rows.set(`${saved.noteId}:${saved.targetLang}`, saved);
		return { identifiers: [], generatedMaps: [], raw: [] };
	});
	repo.findOneBy.mockImplementation(async where => {
		if (Array.isArray(where)) throw new Error('Expected one lookup');
		const row = rows.get(`${where.noteId}:${where.targetLang}`);
		return row?.fingerprint === where.fingerprint ? row ?? null : null;
	});
	const db = mock<DataSource>();
	db.getRepository.mockReturnValue(repo);
	const notes = mock<NoteEntityService>();
	notes.isVisibleForMe.mockImplementation(async (_, userId) => userId === alice.id);
	notes.pack.mockResolvedValue({ isHidden: false } as Awaited<ReturnType<NoteEntityService['pack']>>);
	const getter = mock<GetterService>();
	getter.getNote.mockResolvedValue(note);
	const roles = mock<RoleService>();
	roles.getUserPolicies.mockResolvedValue({ canUseTranslator: true } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
	const http = mock<HttpRequestService>();
	http.send.mockResolvedValue(completion('hello'));
	const endpoint = () => new Translate(settings, notes, getter, http, roles, db);
	const translate = (targetLang = 'en-US', me = alice) => endpoint().exec({ noteId: note.id, targetLang }, me, null);
	return { translate, repo, note, notes, settings, http, roles, rows, bob };
}

describe('Persistent LLM note translation cache', () => {
	test('reuses a stored translation across endpoint instances and returns only the public response fields', async () => {
		const { translate, repo, http } = setup();
		const result = { text: 'hello', sourceLang: 'ja' };
		await expect(translate('en-US')).resolves.toEqual(result);
		await expect(translate('en-us')).resolves.toEqual(result);
		expect(repo.findOneBy).toHaveBeenCalledTimes(2);
		expect(repo.upsert).toHaveBeenCalledTimes(1);
		expect(http.send).toHaveBeenCalledTimes(1);
	});

	test('does not return a saved restricted note to a viewer without access', async () => {
		const { translate, repo, http, bob } = setup();
		await translate();
		await expect(translate('en-US', bob)).rejects.toMatchObject({ code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE' });
		expect(repo.findOneBy).toHaveBeenCalledTimes(1);
		expect(http.send).toHaveBeenCalledTimes(1);
	});

	test('checks hidden notes and translator roles before reading a saved result', async () => {
		const { translate, repo, notes, roles } = setup();
		await translate();
		notes.pack.mockResolvedValue({ isHidden: true } as Awaited<ReturnType<NoteEntityService['pack']>>);
		await expect(translate()).rejects.toMatchObject({ code: 'CANNOT_TRANSLATE_INVISIBLE_NOTE' });
		roles.getUserPolicies.mockResolvedValue({ canUseTranslator: false } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
		await expect(translate()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(repo.findOneBy).toHaveBeenCalledTimes(1);
	});

	test('replaces stale results when text, CW, model or API URL changes and separates languages', async () => {
		const { translate, note, settings, http, rows } = setup();
		await translate();
		note.text = 'こんばんは';
		http.send.mockResolvedValueOnce(completion('good evening'));
		await expect(translate()).resolves.toEqual({ text: 'good evening', sourceLang: 'ja' });
		note.cw = '挨拶';
		await translate();
		settings.llmTranslationModel = 'model-b';
		await translate();
		settings.llmTranslationBaseUrl = 'https://new-provider.example.test/v1';
		await translate();
		await translate('zh-CN');
		expect(http.send).toHaveBeenCalledTimes(6);
		expect(rows.size).toBe(2);
	});

	test('shares pending work for identical requests within a worker', async () => {
		const { translate, repo, http } = setup();
		const first = translate();
		const second = translate();
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ text: 'hello', sourceLang: 'ja' }, { text: 'hello', sourceLang: 'ja' },
		]);
		expect(repo.upsert).toHaveBeenCalledTimes(1);
		expect(http.send).toHaveBeenCalledTimes(1);
	});

	test('does not store an invalid provider result and allows another attempt', async () => {
		const { translate, repo, http } = setup();
		http.send.mockResolvedValueOnce(completion(''));
		await expect(translate()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(repo.upsert).not.toHaveBeenCalled();
		await expect(translate()).resolves.toEqual({ text: 'hello', sourceLang: 'ja' });
		expect(repo.upsert).toHaveBeenCalledTimes(1);
	});

	test('does not call the provider if the cache lookup fails', async () => {
		const { translate, repo, http } = setup();
		repo.findOneBy.mockRejectedValueOnce(new Error('Database unavailable'));
		await expect(translate()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
		expect(http.send).not.toHaveBeenCalled();
	});
});
