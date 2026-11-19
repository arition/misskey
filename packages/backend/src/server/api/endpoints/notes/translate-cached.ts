/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { RoleService } from '@/core/RoleService.js';
import { MiMeta } from '@/models/_.js';
import { MiNoteTranslation } from '@/models/NoteTranslation.js';
import { DI } from '@/di-symbols.js';
import { isTranslatorAvailable } from '@/misc/translation.js';
import { translationCacheLanguage, translationFingerprint } from '@/misc/note-translation-cache.js';
import type { DataSource } from 'typeorm';

export const meta = {
	tags: ['notes'],
	requireCredential: true,
	kind: 'read:account',
	limit: { duration: 60000, max: 30 },
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				noteId: { type: 'string' },
				sourceLang: { type: 'string' },
				text: { type: 'string' },
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteIds: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: { type: 'string', format: 'misskey:id', maxLength: 32 } },
		targetLang: { type: 'string', maxLength: 64 },
	},
	required: ['noteIds', 'targetLang'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta) settings: MiMeta,
		@Inject(DI.db) db: DataSource,
		notes: NoteEntityService,
		roles: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const targetLang = translationCacheLanguage(ps.targetLang);
			if (!targetLang || settings.translationProvider !== 'llm' || !isTranslatorAvailable(settings)) return [];
			if (!(await roles.getUserPolicies(me.id)).canUseTranslator) return [];

			const rows = await db.getRepository(MiNoteTranslation).find({
				where: { noteId: In(ps.noteIds), targetLang },
				relations: { note: true },
			});
			const results = await Promise.all(rows.map(async ({ note, noteId, fingerprint, sourceLang, text }) => {
				// Use the same access checks as notes/translate. Omit misses and unauthorized notes alike.
				if (!(await notes.isVisibleForMe(note, me.id)) || (await notes.pack(note, me)).isHidden) return null;
				if (settings.translationProvider !== 'llm' || fingerprint !== translationFingerprint(settings, note)) return null;
				return { noteId, sourceLang, text };
			}));
			return results.filter(result => result !== null);
		});
	}
}
