/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { mock } from 'vitest-mock-extended';
import TranslateCached from '@/server/api/endpoints/notes/translate-cached.js';
import { translationFingerprint } from '@/misc/note-translation-cache.js';
import type { DataSource, Repository } from 'typeorm';
import type { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import type { RoleService } from '@/core/RoleService.js';
import type { MiMeta, MiNote } from '@/models/_.js';
import type { MiNoteTranslation } from '@/models/NoteTranslation.js';
import type { MiLocalUser } from '@/models/User.js';

function setup() {
	const settings = mock<MiMeta>({
		translationProvider: 'llm', llmTranslationBaseUrl: 'https://example.test/v1', llmTranslationModel: 'a',
	});
	const repo = mock<Repository<MiNoteTranslation>>();
	const db = mock<DataSource>();
	db.getRepository.mockReturnValue(repo);
	const notes = mock<NoteEntityService>();
	notes.isVisibleForMe.mockImplementation(async note => note.id !== 'private');
	notes.pack.mockImplementation(async note => ({ isHidden: typeof note !== 'string' && note.id === 'hidden' }) as Awaited<ReturnType<NoteEntityService['pack']>>);
	const roles = mock<RoleService>();
	roles.getUserPolicies.mockResolvedValue({ canUseTranslator: true } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
	function row(noteId: string, text = 'こんにちは') {
		const note = mock<MiNote>({ id: noteId, text, cw: null });
		return mock<MiNoteTranslation>({ noteId, note, fingerprint: translationFingerprint(settings, note), sourceLang: 'ja', text: '你好' });
	}
	const endpoint = new TranslateCached(settings, db, notes, roles);
	const me = mock<MiLocalUser>({ id: 'viewer' });
	const exec = (noteIds: string[], targetLang = 'zh-CN') => endpoint.exec({ noteIds, targetLang }, me, null);
	return { exec, row, repo, notes, roles, settings };
}

describe('notes/translate-cached', () => {
	test('returns only fresh, visible hits for a batch and omits private, hidden and missing notes', async () => {
		const { exec, row, repo, notes } = setup();
		const edited = row('edited');
		edited.note.cw = 'new content warning';
		repo.find.mockResolvedValue([row('public'), row('private'), row('hidden'), edited]);
		await expect(exec(['public', 'private', 'hidden', 'edited', 'missing'])).resolves.toEqual([{ noteId: 'public', sourceLang: 'ja', text: '你好' }]);
		expect(repo.find).toHaveBeenCalledTimes(1);
		expect(repo.find.mock.calls[0][0]?.where).toMatchObject({ targetLang: 'zh-cn' });
		expect(notes.pack.mock.calls.some(([note]) => typeof note !== 'string' && note.id === 'private')).toBe(false);
	});

	test('rejects stale records after a provider model change', async () => {
		const { exec, row, repo, settings } = setup();
		repo.find.mockResolvedValue([row('public')]);
		settings.llmTranslationModel = 'b';
		await expect(exec(['public'])).resolves.toEqual([]);
	});

	test('does not read the cache without the translator role or when DeepL is selected', async () => {
		const { exec, repo, roles, settings } = setup();
		roles.getUserPolicies.mockResolvedValueOnce({ canUseTranslator: false } as Awaited<ReturnType<RoleService['getUserPolicies']>>);
		await expect(exec(['note'])).resolves.toEqual([]);
		settings.translationProvider = 'deepl';
		await expect(exec(['note'])).resolves.toEqual([]);
		expect(repo.find).not.toHaveBeenCalled();
	});

	test('bounds batch size and rejects duplicates', async () => {
		const { exec, repo } = setup();
		await expect(exec(Array.from({ length: 21 }, (_, i) => `note${i}`))).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(exec(['note', 'note'])).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(repo.find).not.toHaveBeenCalled();
	});
});
