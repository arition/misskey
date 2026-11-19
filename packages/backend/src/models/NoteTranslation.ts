/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';

@Entity('note_translation')
export class MiNoteTranslation {
	@PrimaryColumn(id())
	public noteId: MiNote['id'];

	@PrimaryColumn('varchar', { length: 64 })
	public targetLang: string;

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId' })
	public note: MiNote;

	@Column('varchar', { length: 64 })
	public fingerprint: string;

	@Column('text')
	public sourceLang: string;

	@Column('text')
	public text: string;
}
