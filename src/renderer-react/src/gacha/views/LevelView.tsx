/**
 * 等级视图 —— 取代遗留 views/levelView.js。
 *
 * 依赖 store：levelSubMode（总览/差值对比）、growNumFull（数字缩写/完整）、
 * level（cachedLevel 镜像，同步的当前等级）。
 * 用户「差值对比」的等级 / 经验输入存于组件 state（userLevel / userExp），
 * 派生规则（clamp 上限 = 当前等级升级所需）与原实现逐字对应；
 * 渲染后自动滚动到当前等级行（原 scrollToCurrentLevel）。
 * 点击任何 .grow-num 数字：全局切换缩写(w)/完整（经 setGrowNumFull）。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { setGrowNumFull, useGachaSelector } from '../store';
import { numCellDisplay as sharedNumCellDisplay } from '../utils';

/** [等级, 下级所需经验, 累计经验]；80 级已满级（下级所需为 —） */
const LEVELS: [number, number | '—', number][] = [
  [1,400,0],[2,500,400],[3,600,900],[4,1100,1500],[5,1200,2600],[6,1300,3800],[7,1400,5100],[8,1500,6500],[9,1600,8000],[10,1600,9600],
  [11,1650,11200],[12,1650,12850],[13,1700,14500],[14,1700,16200],[15,1700,17900],[16,1750,19600],[17,1750,21350],[18,1800,23100],[19,1800,24900],[20,2300,26700],
  [21,2400,29000],[22,2500,31400],[23,2500,33900],[24,2500,36400],[25,2700,38900],[26,2900,41600],[27,3000,44500],[28,3200,47500],[29,3400,50700],[30,6500,54100],
  [31,6700,60600],[32,6800,67300],[33,7200,74100],[34,7600,81300],[35,8000,88900],[36,8400,96900],[37,9000,105300],[38,9600,114300],[39,10000,123900],[40,10200,133900],
  [41,10400,144100],[42,10600,154500],[43,10800,165100],[44,11200,175900],[45,11600,187100],[46,12000,198700],[47,12400,210700],[48,12800,223100],[49,13000,235900],[50,13100,248900],
  [51,13300,262000],[52,13500,275300],[53,13700,288800],[54,13900,302500],[55,14100,316400],[56,14300,330500],[57,14500,344800],[58,14700,359300],[59,15700,374000],[60,21600,389700],
  [61,21900,411300],[62,22300,433200],[63,23000,455500],[64,23800,478500],[65,24700,502300],[66,26100,527000],[67,27500,553100],[68,29400,580600],[69,29400,610000],[70,32400,639400],
  [71,32800,671800],[72,33500,704600],[73,34500,738100],[74,35600,772600],[75,37200,808200],[76,39100,845400],[77,41300,884500],[78,44100,925800],[79,47300,969900],[80,'—',1017200],
];
const MAX_EXP = 1017200;

function LevelView() {
  const subMode = useGachaSelector((s) => s.levelSubMode);
  const growNumFull = useGachaSelector((s) => s.growNumFull);
  const cachedLevel = useGachaSelector((s) => s.level);
  const currentView = useGachaSelector((s) => s.currentView);

  const [userLevel, setUserLevel] = useState('');
  const [userExp, setUserExp] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const isDiff = subMode === 'diff';
  const hasLevel = userLevel !== '' || cachedLevel != null;
  const effLevelRaw = hasLevel ? (userLevel !== '' ? userLevel : String(cachedLevel)) : '1';
  const ul = hasLevel ? Math.max(1, Math.min(80, parseInt(effLevelRaw, 10) || 1)) : 0;
  const expCap = ul >= 1 && ul <= 80 && LEVELS[ul - 1][1] !== '—' ? (LEVELS[ul - 1][1] as number) : 0;
  const ue = hasLevel ? Math.max(0, Math.min(expCap, parseInt(userExp || '0', 10) || 0)) : 0;
  const userCum = hasLevel ? LEVELS[ul - 1][2] + ue : 0;

  function expCapOf(lv: number): number {
    const r = LEVELS[Math.max(1, Math.min(80, lv)) - 1];
    return r && r[1] !== '—' ? (r[1] as number) : 0;
  }

  /** 同步经验输入到当前等级上限（原 syncExpInput：clamp 后按 0 值回退空串） */
  function clampExp(lv: number, exp: string): string {
    const cap = expCapOf(lv);
    let n = parseInt(exp || '0', 10);
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(cap, n));
    return n === 0 && exp !== '0' ? '' : String(n);
  }

  function currentLevelNum(): number {
    let n = userLevel !== '' ? parseInt(userLevel, 10) : 1;
    if (isNaN(n)) n = 1;
    return Math.max(1, Math.min(80, n));
  }

  // 数字缩写改用 gacha/utils 的共享实现（原先两处视图各写一份）。
  const numCellDisplay = (n: number): string => sharedNumCellDisplay(n, growNumFull);

  // 差值对比且已定位当前等级：渲染后自动滚动到该行（原 rAF scrollToCurrentLevel）
  useEffect(() => {
    if (!isDiff || !hasLevel) return;
    const raf = requestAnimationFrame(() => {
      const wrap = rootRef.current?.querySelector('.grow-scroll');
      const row = rootRef.current?.querySelector('.level-current-row');
      if (!(wrap instanceof HTMLElement) || !(row instanceof HTMLElement)) return;
      const rowRect = row.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const target = wrap.scrollTop + (rowRect.top - wrapRect.top) - (wrap.clientHeight - rowRect.height) / 2;
      wrap.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiff, hasLevel, userLevel, userExp]);

  /** 等级输入：非数字整体清空；clamp 1-80；随后按新上限收紧经验 */
  function onLevelInput(raw: string) {
    if (raw !== '' && !/^[0-9]+$/.test(raw)) {
      setUserLevel('');
      setUserExp(clampExp(1, userExp));
      return;
    }
    if (raw === '') {
      setUserLevel('');
      setUserExp(clampExp(1, userExp));
      return;
    }
    let n = parseInt(raw, 10);
    if (n < 1) n = 1;
    else if (n > 80) n = 80;
    setUserLevel(String(n));
    setUserExp(clampExp(n, userExp));
  }

  /** 等级输入失焦：空 / 非法回退为 1 */
  function onLevelBlur(raw: string) {
    if (raw === '' || !/^[0-9]+$/.test(raw)) {
      setUserLevel('1');
      setUserExp(clampExp(1, userExp));
    }
  }

  /** 经验输入：clamp 到当前等级上限 */
  function onExpInput(raw: string) {
    if (raw !== '' && !/^[0-9]+$/.test(raw)) {
      setUserExp('');
      return;
    }
    if (raw === '') {
      setUserExp('');
      return;
    }
    const cap = expCapOf(currentLevelNum());
    let n = parseInt(raw, 10);
    if (n < 0) n = 0;
    else if (n > cap) n = cap;
    setUserExp(String(n));
  }

  const levelInputValue = userLevel !== '' ? userLevel : cachedLevel != null ? String(cachedLevel) : '';
  const expInputValue = userExp;

  return (
    <div ref={rootRef} id="view-level" className={'analysis-view' + (currentView === 'level' ? ' active' : '')}>
      <div className="grow-card">
        <div className="grow-head">
          <h2 className="grow-title">等级 · 经验养成表</h2>
          {isDiff ? (
            <div className="grow-inputs grow-inputs-inline">
              <label className="grow-field">
                当前等级
                <input
                  className="grow-input"
                  type="number"
                  min={1}
                  max={80}
                  id="lvl-input"
                  value={levelInputValue}
                  placeholder="1-80"
                  onChange={(e) => onLevelInput(e.target.value)}
                  onBlur={(e) => onLevelBlur(e.target.value)}
                />
              </label>
              <label className="grow-field">
                当前经验
                <input
                  className="grow-input"
                  type="number"
                  min={0}
                  id="exp-input"
                  max={expCap}
                  value={expInputValue}
                  placeholder="0"
                  onChange={(e) => onExpInput(e.target.value)}
                />
              </label>
            </div>
          ) : null}
        </div>
        <div className="grow-table-wrap grow-scroll">
          <table className="grow-table">
            <thead>
              <tr>
                {isDiff ? (
                  <>
                    <th>等级</th>
                    <th>累计经验</th>
                    <th>满级还需</th>
                    <th>距此等级</th>
                  </>
                ) : (
                  <>
                    <th>等级</th>
                    <th>下级所需</th>
                    <th>累计经验</th>
                    <th>满级还需</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="grow-level-body">
              {LEVELS.map(([lv, need, cum]) => {
                if (!isDiff) {
                  const remain = lv === 80 ? -1 : MAX_EXP - cum;
                  return (
                    <tr key={lv}>
                      <td className="grow-name">{lv}</td>
                      {need === '—' ? <td className="grow-dash">—</td> : <td className="grow-num" data-full={String(need)} data-short={need >= 10000 ? (need / 10000).toFixed(2) + 'w' : String(need)} onClick={toggleGrowNum}>{numCellDisplay(need)}</td>}
                      <td className="grow-num" data-full={String(cum)} data-short={cum >= 10000 ? (cum / 10000).toFixed(2) + 'w' : String(cum)} onClick={toggleGrowNum}>{numCellDisplay(cum)}</td>
                      {remain === -1 ? <td className="grow-dash">—</td> : <td className="grow-num" data-full={String(remain)} data-short={remain >= 10000 ? (remain / 10000).toFixed(2) + 'w' : String(remain)} onClick={toggleGrowNum}>{numCellDisplay(remain)}</td>}
                    </tr>
                  );
                }
                const isCur = hasLevel && lv === ul;
                const toLevel = !hasLevel ? -1 : lv <= ul ? 0 : Math.max(0, cum - userCum);
                const cumRemain = lv === 80 ? -1 : MAX_EXP - cum;
                return (
                  <tr key={lv} className={isCur ? 'level-current-row' : ''}>
                    <td className="grow-name">{lv}</td>
                    <td className="grow-num" data-full={String(cum)} data-short={cum >= 10000 ? (cum / 10000).toFixed(2) + 'w' : String(cum)} onClick={toggleGrowNum}>{numCellDisplay(cum)}</td>
                    {cumRemain === -1 ? <td className="grow-dash">—</td> : <td className="grow-num" data-full={String(cumRemain)} data-short={cumRemain >= 10000 ? (cumRemain / 10000).toFixed(2) + 'w' : String(cumRemain)} onClick={toggleGrowNum}>{numCellDisplay(cumRemain)}</td>}
                    {toLevel === -1 ? <td className="grow-dash">—</td> : <td className="grow-num" data-full={String(toLevel)} data-short={toLevel >= 10000 ? (toLevel / 10000).toFixed(2) + 'w' : String(toLevel)} onClick={toggleGrowNum}>{numCellDisplay(toLevel)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="grow-hint">
          鸣潮 1-80 级角色养成经验参考；「差值对比」中输入当前等级与经验，自动高亮当前等级并算出到各等级还差多少经验（点击数字可切换缩写 / 完整）。
        </p>
      </div>
    </div>
  );

  /** 点击任意数字：全部一起在「缩写(w) / 完整」间切换（经 store 全局共享，切换 tab 不重置） */
  function toggleGrowNum() {
    setGrowNumFull(!growNumFull);
  }
}

export default memo(LevelView);