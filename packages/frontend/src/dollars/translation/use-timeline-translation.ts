/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onDeactivated, ref, toValue, watch } from 'vue';
import { parse } from 'mfm-js';
import type { MfmNode } from 'mfm-js';
import type { InjectionKey, MaybeRef, Ref } from 'vue';
import type { entities } from 'misskey-js';
import { useDocumentVisibility } from '@@/js/use-document-visibility.js';
import { $i } from '@/i.js';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { createTranslationQueue } from './queue.js';
import type { TranslationNote } from './queue.js';

// Profile notes can translate without inheriting the main timeline’s mute rules.
export const profileNoteTranslation = Symbol() as InjectionKey<boolean>;

const queue = createTranslationQueue(
	(noteId, targetLang, signal, accountId) => {
		if ($i?.id !== accountId) return Promise.resolve(undefined);
		return misskeyApi('notes/translate', { noteId, targetLang }, $i.token, AbortSignal.any([signal, AbortSignal.timeout(65000)]));
	},
	(accountId, noteIds, targetLang) => {
		if ($i?.id !== accountId) return Promise.resolve([]);
		return misskeyApi('notes/translate-cached', { noteIds, targetLang }, $i.token, AbortSignal.timeout(5000));
	},
);

const hasLetter = /\p{L}/u;

function hasTextNode(node: MfmNode): boolean {
	if (node.type === 'text') return hasLetter.test(node.props.text);
	return 'children' in node && (node.children?.some(hasTextNode) ?? false);
}

function hasTranslatableText(text: string | null | undefined): boolean {
	return !!text && hasLetter.test(text) && parse(text).some(hasTextNode);
}

/** Observe the rendered note, not its list wrapper: muted/collapsed/CW-hidden notes stay local. */
export function useTimelineTranslation(options: {
	root: Ref<HTMLElement | null>;
	eligible: Ref<boolean>;
	note: MaybeRef<TranslationNote | null>;
	accountId: string;
	translation: Ref<entities.NotesTranslateResponse | null>;
	translating: Ref<boolean>;
}) {
	const visible = ref(false);
	const active = ref(true);
	const failed = ref(false);
	const documentVisibility = useDocumentVisibility();

	onActivated(() => { active.value = true; });
	onDeactivated(() => { active.value = false; });

	watch([options.root, options.eligible, active], ([element, eligible, isActive], _old, onCleanup) => {
		visible.value = false;
		if (!element || !eligible || !isActive || typeof IntersectionObserver === 'undefined') return;
		const observer = new IntersectionObserver(([entry]) => {
			visible.value = entry.isIntersecting;
		});
		observer.observe(element);
		onCleanup(() => observer.disconnect());
	}, { flush: 'post', immediate: true });

	const noteContent = () => {
		const note = toValue(options.note);
		return note && { id: note.id, text: note.text, cw: note.cw };
	};
	watch([visible, options.eligible, active, documentVisibility, noteContent], ([isVisible, eligible, isActive, visibility, note], _old, onCleanup) => {
		failed.value = false;
		if (!isVisible || !eligible || !isActive || visibility !== 'visible' || options.translation.value || options.translating.value) return;
		if (!note || (!hasTranslatableText(note.text) && !hasTranslatableText(note.cw))) return;
		const controller = new AbortController();
		const targetLang = miLocalStorage.getItem('lang') ?? navigator.language;
		options.translating.value = true;
		onCleanup(() => {
			controller.abort();
			options.translating.value = false;
		});
		queue.translate(options.accountId, note, targetLang, controller.signal).then(result => {
			if (controller.signal.aborted) return;
			// A manual result, if one arrived first, must not be overwritten.
			if (result && !options.translation.value) options.translation.value = result;
		}).catch(() => {
			if (!controller.signal.aborted) failed.value = true;
		}).finally(() => {
			if (!controller.signal.aborted) options.translating.value = false;
		});
	}, { immediate: true });

	return { failed };
}
