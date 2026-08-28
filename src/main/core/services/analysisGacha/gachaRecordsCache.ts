/**
 * get-gacha-records 内存缓存（独立小模块）。
 * 原 src/core/services/analysisGacha/gachaRecordsCache.js → TypeScript 迁移。
 * 独立成模块是为了让会改动 gacha_logs 的模块共用同一份失效方法，又不引入循环依赖。
 * 写入时对行做一层浅拷贝，避免调用方误改共享数组。
 */
// 最多保留的 key 数量。原实现是无上限 Map：每个 UID 一份全量行数组的浅拷贝常驻，
// 多账号 + 万级记录累积可达数百 MB。改为简单 LRU：命中即刷新热度，超过上限淘汰最久未用的。
const MAX_ENTRIES = 3;

const cache = new Map<string, any[]>(); // key: pid(string) 或 ''（查全库）  -> rows[]

function get(key: string): any[] | undefined {
  const hit = cache.get(key);
  if (hit) {
    // Map 按插入顺序迭代：先删再插等于把该 key 移到末尾（最新）。
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function set(key: string, rows: any[]): any[] {
  const copy = rows.map(r => ({ ...r }));
  cache.delete(key);
  cache.set(key, copy);
  // 淘汰最久未使用的（迭代顺序的第一个）
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return rows;
}

function invalidate(): void {
  cache.clear();
}

module.exports = { get, set, invalidate };