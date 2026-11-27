import { normalizeLanguage, translate } from './translate.js';

const storageKey = 'collabstudio.language';
const url = new URL(window.location.href);
export const language = normalizeLanguage(window.electronAPI
  ? url.searchParams.get('lang')
  : localStorage.getItem(storageKey));
export const locale = language === 'en' ? 'en' : 'zh-CN';
export const shortcutModifier = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl';

export function t(message, ...values) {
  return translate(language, message, ...values);
}

export function localizePage() {
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.textContent);
  }
  for (const node of document.querySelectorAll('[data-i18n-rich]')) {
    node.innerHTML = t(node.innerHTML);
  }
  for (const node of document.querySelectorAll('[data-i18n-attrs]')) {
    for (const attr of node.dataset.i18nAttrs.split(' ')) {
      node.setAttribute(attr, t(node.getAttribute(attr)));
    }
  }
}

export async function setLanguage(next) {
  if (window.electronAPI) {
    await window.electronAPI.setLanguage(next);
    url.searchParams.set('lang', next);
    window.location.replace(url);
  } else {
    localStorage.setItem(storageKey, next);
    window.location.reload();
  }
}
