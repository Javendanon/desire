// User-facing copy lookup. The product speaks Spanish, so its text lives in the JSON catalog as
// data, the same split content/knowledge uses; code refers to it only through English keys.
import catalog from './messages.es.json' with { type: 'json' };

export type MessageKey = keyof typeof catalog;
export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: MessageKey, params: MessageParams = {}): string {
  return catalog[key].replace(PLACEHOLDER, (token: string, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}
