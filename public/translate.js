import { english } from './messages.js';

export function normalizeLanguage(language) {
  return language === 'en' ? 'en' : 'zh';
}

export function translate(language, message, ...values) {
  const template = typeof message === 'string'
    ? (language === 'en' && Object.hasOwn(english, message) ? english[message] : message)
    : message[language];
  return template.replace(/\{(\d+)\}/g, (slot, i) => i < values.length ? String(values[i]) : slot);
}
