/**
 * 奇藏视图 —— 取代遗留 views/qizangView.js。
 *
 * 依赖 store：qizangSubMode（总览/差值对比）、growNumFull（数字缩写/完整）、
 * treasure（cachedTreasure 镜像，同步的「已有」数据）。
 * 用户「差值对比」输入存于组件 state（userInputs，仅操作过的条目生效），
 * 表格内容 / 合计行由 state 派生，无需手动局部 DOM 更新。
 * 点击任何 .grow-num 数字：全局切换缩写(w)/完整（经 setGrowNumFull，
 * 与等级视图共用状态，切换 tab 不重置）。
 */
import { memo, useState } from 'react';
import { setGrowNumFull, useGachaSelector } from '../store';
import type { TreasureData } from '../types';
import { numCellDisplay as sharedNumCellDisplay } from '../utils';

const DATA = [
  { name: '朴素', count: 956, unit: 5 },
  { name: '基准', count: 1083, unit: 10 },
  { name: '精密', count: 453, unit: 20 },
  { name: '辉光', count: 111, unit: 40 },
  { name: '潮汐绿', count: 201, unit: 5 },
  { name: '潮汐紫', count: 207, unit: 5 },
  { name: '潮汐金', count: 233, unit: 10 },
].map((d) => ({ ...d, total: d.count * d.unit }));
const TOTAL_STARS = DATA.reduce((a, d) => a + d.total, 0);
const TOTAL_COUNT = DATA.reduce((a, d) => a + d.count, 0);

function QizangView() {
  const subMode = useGachaSelector((s) => s.qizangSubMode);
  const growNumFull = useGachaSelector((s) => s.growNumFull);
  const treasure = useGachaSelector((s) => s.treasure);
  const currentView = useGachaSelector((s) => s.currentView);

  // 用户已操作过的数值（含清空成空串 → 空串按 0）；未操作过则回退同步值 / 0
  const [userInputs, setUserInputs] = useState<Record<string, string>>({});

  function effUser(d: { name: string; count: number; unit: number; total: number }, treasureData: TreasureData | null): number {
    const raw = userInputs[d.name];
    if (raw !== undefined && raw !== null) return Math.max(0, parseInt(raw, 10) || 0);
    const synced = treasureData && treasureData[d.name] != null ? treasureData[d.name] : null;
    return synced != null ? synced : 0;
  }

  // 数字缩写改用 gacha/utils 的共享实现（原先两处视图各写一份）。
  const numCellDisplay = (n: number): string => sharedNumCellDisplay(n, growNumFull);

  function diffTotals(treasureData: TreasureData | null) {
    let su = 0;
    let sl = 0;
    let ss = 0;
    DATA.forEach((d) => {
      const u = effUser(d, treasureData);
      const l = Math.max(0, d.count - u);
      su += u;
      sl += l;
      ss += l * d.unit;
    });
    return { su, sl, ss };
  }

  const isDiff = subMode === 'diff';
  const totals = isDiff ? diffTotals(treasure) : null;

  /** 点击任意数字：全部一起在「缩写(w) / 完整」间切换（经 store 全局共享，切换 tab 不重置） */
  function toggleGrowNum() {
    setGrowNumFull(!growNumFull);
  }

  return (
    <div id="view-qizang" className={'analysis-view' + (currentView === 'qizang' ? ' active' : '')}>
      <div className="grow-card">
        <div className="grow-head">
          <h2 className="grow-title">奇藏 · 资源收集进度</h2>
        </div>
        <div className="grow-table-wrap">
          <table className="grow-table">
            <thead>
              <tr>
                {isDiff ? (
                  <>
                    <th>名称</th>
                    <th>已有</th>
                    <th>缺少</th>
                    <th>星声差</th>
                  </>
                ) : (
                  <>
                    <th>名称</th>
                    <th>参考数量</th>
                    <th>单个星声</th>
                    <th>合计星声</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {DATA.map((d) => {
                if (!isDiff) {
                  return (
                    <tr key={d.name}>
                      <td className="grow-name">{d.name}</td>
                      <td className="grow-qty">{d.count}</td>
                      <td className="grow-qty">{d.unit}</td>
                      <td className="grow-num" data-full={String(d.total)} data-short={d.total >= 10000 ? (d.total / 10000).toFixed(2) + 'w' : String(d.total)} onClick={() => toggleGrowNum()}>{numCellDisplay(d.total)}</td>
                    </tr>
                  );
                }
                const user = effUser(d, treasure);
                const lack = Math.max(0, d.count - user);
                const stars = lack * d.unit;
                return (
                  <tr key={d.name}>
                    <td className="grow-name">{d.name}</td>
                    <td>
                      <input
                        className="grow-input"
                        type="number"
                        min={0}
                        max={999999}
                        maxLength={6}
                        inputMode="numeric"
                        data-name={d.name}
                        value={userInputs[d.name] !== undefined ? userInputs[d.name] : (treasure && treasure[d.name] != null ? String(treasure[d.name]) : '')}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          // 仅允许纯数字、最多 6 位（已有输入框）
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
                          setUserInputs((prev) => ({ ...prev, [d.name]: clean }));
                        }}
                      />
                    </td>
                    <td className="grow-qty cell-lack">{lack}</td>
                    <td className="grow-num" data-full={String(stars)} data-short={stars >= 10000 ? (stars / 10000).toFixed(2) + 'w' : String(stars)} onClick={() => toggleGrowNum()}>{numCellDisplay(stars)}</td>
                  </tr>
                );
              })}
              {isDiff && totals ? (
                <tr className="grow-total-row">
                  <td>合计</td>
                  <td>{totals.su}</td>
                  <td>{totals.sl}</td>
                  <td className="grow-num" data-full={String(totals.ss)} data-short={totals.ss >= 10000 ? (totals.ss / 10000).toFixed(2) + 'w' : String(totals.ss)} onClick={() => toggleGrowNum()}>{numCellDisplay(totals.ss)}</td>
                </tr>
              ) : (
                <tr className="grow-total-row">
                  <td>合计</td>
                  <td>{TOTAL_COUNT}</td>
                  <td className="grow-dash">—</td>
                  <td className="grow-num" data-full={String(TOTAL_STARS)} data-short={TOTAL_STARS >= 10000 ? (TOTAL_STARS / 10000).toFixed(2) + 'w' : String(TOTAL_STARS)} onClick={() => toggleGrowNum()}>{numCellDisplay(TOTAL_STARS)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="grow-hint">
          参考 v3.6 上版本全收集所需资源；「差值对比」中输入你已有的数量，自动算出还差多少箱子与星声（点击数字可在缩写 / 完整间切换）。
        </p>
      </div>
    </div>
  );
}

export default memo(QizangView);