import { AsyncLocalStorage } from 'node:async_hooks';
import { normalizeLanguage, translate } from '../public/translate.js';
import { workflows } from './workflow-messages.mjs';

const requestLanguage = new AsyncLocalStorage();

export function withLanguage(language, handler) {
  return requestLanguage.run(normalizeLanguage(language), handler);
}

export function t(message, ...values) {
  const template = Object.hasOwn(workflows, message) ? workflows[message] : message;
  return translate(requestLanguage.getStore() || 'zh', template, ...values);
}
