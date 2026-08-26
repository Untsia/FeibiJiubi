/**
 * get-gacha-records 内存缓存（独立小模块）。
 *
 * 同一账号在重绘 / 切回分析页时会被多次调用 get-gacha-records，缓存已查询结果
 * 可避免重复扫描 gacha_logs 全表。分析聚合等场景在渲染层已缓存，但主进程这里
 * 再兜底一层，减少高频 IPC 的数据库开销。
 *
 * 独立成模块是为了让会改动 gacha_logs 的模块（analysisIpc 的 refresh/import、
 * deleteUID 的 delete）共用同一份失效方法，又不引入 analysisIpc ↔ deleteUID 的
 * 循环依赖。写入时对行做一层浅拷贝，避免调用方误改共享数组。
 */
const cache = new Map(); // key: pid(string) 或 ''（查全库）  -> rows[]

function get(key) {
  return cache.get(key);
}

function set(key, rows) {
  cache.set(key, rows.map(r => ({ ...r })));
  return rows;
}

function invalidate() {
  cache.clear();
}

module.exports = { get, set, invalidate };