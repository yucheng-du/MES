export type RecordPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** Read the API's pagination contract without silently truncating reference data. */
export async function readAllPages<T extends { id: string }>(
  fetchPage: (page: number, pageSize: number) => Promise<RecordPage<T>>,
  requestedPageSize = 100,
): Promise<RecordPage<T>> {
  const records = new Map<string, T>();
  let page = 1;
  for (;;) {
    const result = await fetchPage(page, requestedPageSize);
    const previousCount = records.size;
    for (const item of result.items) records.set(item.id, item);
    const actualPageSize = Math.max(1, result.pageSize || requestedPageSize);
    if (!result.items.length || page * actualPageSize >= result.total) break;
    if (page > 1 && records.size === previousCount) {
      throw new Error("关联记录分页未继续返回新数据，请重新加载或联系管理员。");
    }
    page += 1;
  }
  const items = [...records.values()];
  return { items, total: items.length, page: 1, pageSize: items.length };
}
