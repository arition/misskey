<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/external-services" :label="i18n.ts.externalServices" :keywords="['external', 'services', 'thirdparty']" icon="ti ti-link">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>Google Analytics</SearchLabel><span class="_beta">{{ i18n.ts.beta }}</span></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="googleAnalyticsMeasurementId">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Measurement ID</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<MkButton primary @click="save_googleAnalytics">Save</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._translationSettings.title }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSelect v-model="translationProvider" :items="translationProviderDef">
									<template #label><SearchLabel>{{ i18n.ts._translationSettings.provider }}</SearchLabel></template>
								</MkSelect>
							</SearchMarker>

							<div v-if="translationProvider === 'llm'" class="_gaps_m">
								<MkInfo>{{ i18n.ts._translationSettings.llmDescription }}</MkInfo>
								<SearchMarker>
									<MkInput v-model="llmTranslationBaseUrl" type="url" placeholder="https://api.openai.com/v1">
										<template #label><SearchLabel>{{ i18n.ts._translationSettings.baseUrl }}</SearchLabel></template>
										<template #caption>{{ i18n.ts._translationSettings.baseUrlDescription }}</template>
									</MkInput>
								</SearchMarker>
								<SearchMarker>
									<MkInput v-model="llmTranslationApiKey" type="password">
										<template #label><SearchLabel>{{ i18n.ts._translationSettings.apiKey }}</SearchLabel></template>
										<template #caption>{{ i18n.ts._translationSettings.apiKeyDescription }}</template>
									</MkInput>
								</SearchMarker>
								<SearchMarker>
									<MkInput v-model="llmTranslationModel" placeholder="gpt-4o-mini">
										<template #label><SearchLabel>{{ i18n.ts._translationSettings.model }}</SearchLabel></template>
									</MkInput>
								</SearchMarker>
							</div>

							<SearchMarker v-if="translationProvider === 'deepl'">
								<MkInput v-model="deeplAuthKey" type="password">
									<template #prefix><i class="ti ti-key"></i></template>
									<template #label><SearchLabel>Auth Key</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker v-if="translationProvider === 'deepl'">
								<MkSwitch v-model="deeplIsPro">
									<template #label><SearchLabel>Pro account</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>

							<MkButton primary :disabled="translationProvider === 'llm' && (!llmTranslationBaseUrl.trim() || !llmTranslationModel.trim())" @click="saveTranslation">{{ i18n.ts.save }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInfo from '@/components/MkInfo.vue';
import { useMkSelect } from '@/composables/use-mkselect.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';

const meta = await misskeyApi('admin/meta');

const { model: translationProvider, def: translationProviderDef } = useMkSelect({
	items: [
		{ label: 'DeepL', value: 'deepl' },
		{ label: i18n.ts._translationSettings.llm, value: 'llm' },
	],
	initialValue: meta.translationProvider,
});
const llmTranslationBaseUrl = ref(meta.llmTranslationBaseUrl);
const llmTranslationApiKey = ref(meta.llmTranslationApiKey ?? '');
const llmTranslationModel = ref(meta.llmTranslationModel);
const deeplAuthKey = ref(meta.deeplAuthKey ?? '');
const deeplIsPro = ref(meta.deeplIsPro);
const googleAnalyticsMeasurementId = ref(meta.googleAnalyticsMeasurementId ?? '');

function saveTranslation() {
	os.apiWithDialog('admin/update-meta', {
		translationProvider: translationProvider.value,
		...(translationProvider.value === 'llm' ? {
			llmTranslationBaseUrl: llmTranslationBaseUrl.value.trim(),
			llmTranslationApiKey: llmTranslationApiKey.value,
			llmTranslationModel: llmTranslationModel.value.trim(),
		} : {}),
		deeplAuthKey: deeplAuthKey.value,
		deeplIsPro: deeplIsPro.value,
	}).then(() => {
		fetchInstance(true);
	});
}

function save_googleAnalytics() {
	os.apiWithDialog('admin/update-meta', {
		googleAnalyticsMeasurementId: googleAnalyticsMeasurementId.value,
	}).then(() => {
		fetchInstance(true);
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.externalServices,
	icon: 'ti ti-link',
}));
</script>
