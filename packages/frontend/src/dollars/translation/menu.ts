/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed } from 'vue';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import type { MenuItem } from '@/types/menu.js';

export function getTimelineTranslationMenu(): MenuItem[] {
	if (!$i?.policies.canUseTranslator || !instance.translatorAvailable) return [];
	let confirming = false;
	return [{
		type: 'switch',
		icon: 'ti ti-language',
		text: i18n.ts._timelineTranslation.title,
		ref: computed({
			get: () => prefer.r.timelineAutoTranslate.value,
			set: (enabled: boolean) => { void update(enabled); },
		}),
	}];

	async function update(enabled: boolean) {
		if (confirming) return;
		if (enabled) {
			confirming = true;
			try {
				const { canceled } = await os.confirm({
					type: 'warning',
					title: i18n.ts._timelineTranslation.title,
					text: i18n.ts._timelineTranslation.confirm,
				});
				if (canceled) return;
			} finally {
				confirming = false;
			}
		}
		prefer.commit('timelineAutoTranslate', enabled);
	}
}
