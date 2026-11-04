// Reads a whole API collection within a fixed budget, for any feature that lists records.
import type { Page, PageQuery } from '../../lib/api/client.ts';

const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export interface Collected<T> {
  items: T[];
  truncated: boolean;
}

/** Follows has_more up to the budget and says so when it stops early. O(pages). */
export async function collectPages<T>(
  fetchPage: (page: PageQuery) => Promise<Page<T>>,
): Promise<Collected<T>> {
  const items: T[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page = await fetchPage({ limit: PAGE_SIZE, offset: index * PAGE_SIZE });
    items.push(...page.items);
    if (!page.has_more) return { items, truncated: false };
  }
  return { items, truncated: true };
}
