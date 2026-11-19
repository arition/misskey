/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class NoteTranslation1795020002868 {
    name = 'NoteTranslation1795020002868'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "note_translation" ("noteId" character varying(32) NOT NULL, "targetLang" character varying(64) NOT NULL, "fingerprint" character varying(64) NOT NULL, "sourceLang" text NOT NULL, "text" text NOT NULL, CONSTRAINT "PK_ce2432905f45e8852f57893790c" PRIMARY KEY ("noteId", "targetLang"), CONSTRAINT "FK_446d4419b094e960cf75688ce56" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "note_translation"`);
    }
}
