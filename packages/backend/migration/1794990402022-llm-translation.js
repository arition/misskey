/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class LlmTranslation1794990402022 {
    name = 'LlmTranslation1794990402022';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "meta" ADD "translationProvider" character varying(16) NOT NULL DEFAULT 'deepl'`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "llmTranslationBaseUrl" character varying(1024) NOT NULL DEFAULT 'https://api.openai.com/v1'`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "llmTranslationApiKey" character varying(1024)`);
        await queryRunner.query(`ALTER TABLE "meta" ADD "llmTranslationModel" character varying(128) NOT NULL DEFAULT 'gpt-4o-mini'`);
    }

    async down(queryRunner) {
        await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "llmTranslationModel"');
        await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "llmTranslationApiKey"');
        await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "llmTranslationBaseUrl"');
        await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "translationProvider"');
    }
}
