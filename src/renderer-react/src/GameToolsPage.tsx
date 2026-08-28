/**
 * 分析页（抽卡分析）—— 全面 React 化（数据链路已迁入 gacha/data.ts + gacha/treasure.ts）。
 *
 * 职责（v5 起：UID 下拉 / 状态提示 / 刷新按钮 / 隐藏卡池弹窗 / 删除弹窗 / 账号切换 /
 * 快捷键 全部由 React 接管，遗留 gachaWuwa.js / gameTools.js 已删除）：
 *   - 挂载时调用 bootGacha() 启动数据链路（UID 下拉 + 记录 + 奇藏同步）。
 *   - .page-title / #analysis-tabbar / #sub-view-row / #record-display 由 store 状态驱动：
 *     currentView（bar/intuitive/detail/qizang/level）决定标题与两个 tabbar 的显隐/高亮；
 *     qizangSubMode / levelSubMode 决定子 tabbar 的高亮；status 决定 #record-display
 *     显示骨架屏还是六个视图。
 *   - 六个视图组件（Bar/Intuitive/Table/Detail/Qizang/Level）订阅 store 数据渲染。
 *   - 主 tab 点击 → data.ts switchAnalysisView（偏好持久化 + 冷启动奇藏同步兜底 +
 *     派发 'app-nav-view-changed' 给侧边栏）；子 tab 点击 → setQizangSubMode/setLevelSubMode。
 *   - UID 下拉：uidOptions 渲染选项，点击选中（setLastQueryUid + loadGachaRecords），
 *     每项「删除」按钮打开删除确认弹窗（runDeleteUid）。
 *   - 云鸣潮获取 / 鸣潮内获取：refreshGachaRecords / importGachaFromGame 成功后
 *     reloadGachaData 统一重载（含加载中骨架屏）。
 *   - 隐藏卡池弹窗：poolTitles() + 全部卡池，选中态经 applyHiddenPools 持久化并发布。
 *   - 奇藏/等级子行右侧账号切换下拉：accountOptions 渲染，switchAccount 切换同步账号。
 */
import { memo, useEffect, useMemo, useState } from 'react';
import {
  setLevelSubMode,
  setQizangSubMode,
  useGachaSelector,
} from './gacha/store';
import type { GachaNavView, GachaSubMode } from './gacha/types';
import {
  applyHiddenPools,
  bootGacha,
  getHiddenPools,
  loadGachaRecords,
  poolTitles,
  reloadGachaData,
  runDeleteUid,
  switchAnalysisView,
} from './gacha/data';
import { accountLabel as accountLabelOf, effectiveUid, switchAccount } from './gacha/treasure';
import type { TreasureAccount } from './gacha/types';
import { showNotification } from './notification/store';
import BarView from './gacha/views/BarView';
import IntuitiveView from './gacha/views/IntuitiveView';
import TableView from './gacha/views/TableView';
import DetailView from './gacha/views/DetailView';
import QizangView from './gacha/views/QizangView';
import LevelView from './gacha/views/LevelView';

/** 主 tabbar（列表/卡片/详情）仅在 bar/intuitive/detail 视图显示 */
function isAnalysisTabView(view: GachaNavView): boolean {
  return view === 'bar' || view === 'intuitive' || view === 'detail';
}

/** 子 tabbar（总览/差值对比）仅奇藏/等级视图显示 */
function isSubView(view: GachaNavView): boolean {
  return view === 'qizang' || view === 'level';
}

/** 骨架屏：与遗留 skeletonHtml() 结构逐字节一致（6 张占位卡片） */
function SkeletonScreen() {
  return (
    <div className="skeleton-screen" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="sk-line sk-title"></div>
          <div className="sk-grid">
            <div className="sk-cell"></div>
            <div className="sk-cell"></div>
            <div className="sk-cell"></div>
            <div className="sk-cell"></div>
          </div>
          <div className="sk-line sk-foot"></div>
        </div>
      ))}
    </div>
  );
}

/** 浮层通知（NotificationHost 渲染，见 notification/store.ts） */
function notify(success: boolean, message: string) {
  showNotification(success, message);
}

function GameToolsPage() {
  const currentView = useGachaSelector((s) => s.currentView);
  const status = useGachaSelector((s) => s.status);
  const qizangSubMode = useGachaSelector((s) => s.qizangSubMode);
  const levelSubMode = useGachaSelector((s) => s.levelSubMode);
  const uid = useGachaSelector((s) => s.uid);
  const uidOptions = useGachaSelector((s) => s.uidOptions);
  const statusMessage = useGachaSelector((s) => s.statusMessage);
  const hiddenPools = useGachaSelector((s) => s.hiddenPools);
  const accountOptions = useGachaSelector((s) => s.accountOptions);
  const accountOauthCode = useGachaSelector((s) => s.accountOauthCode);
  const accountLabel = useGachaSelector((s) => s.accountLabel);

  /* ---------- 局部 UI 状态 ---------- */
  const [uidMenuOpen, setUidMenuOpen] = useState(false);
  const [accMenuOpen, setAccMenuOpen] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [hideModalOpen, setHideModalOpen] = useState(false);
  const [hideSelected, setHideSelected] = useState<Set<string>>(() => new Set());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pendingDeleteUid, setPendingDeleteUid] = useState<string | null>(null);

  // 挂载即启动数据链路；切页重挂载时重新拉取最新数据（module 级状态保留 uid 等）
  useEffect(() => {
    bootGacha().catch((e) => console.error('[GameToolsPage] bootGacha failed', e));
  }, []);

  const subMode = currentView === 'qizang' ? qizangSubMode : levelSubMode;
  const title = currentView === 'qizang' ? '奇藏计算' : currentView === 'level' ? '等级计算' : '抽卡分析';
  const showTabbar = isAnalysisTabView(currentView);
  const showSubRow = isSubView(currentView);
  const loading = status === 'loading';

  /* ---------- 主 tab / 子 tab ---------- */
  const onAnalysisTab = (view: GachaNavView) => () => switchAnalysisView(view);
  const onSubTab = (mode: GachaSubMode) => () => {
    if (currentView === 'qizang') setQizangSubMode(mode);
    else if (currentView === 'level') setLevelSubMode(mode);
  };

  /* ---------- UID 下拉 ---------- */
  const uidDisplay = uid != null && uid !== '' ? String(uid) : '请选择 UID';
  const toggleUidMenu = () => {
    if (!uidOptions.length) return; // 没有任何账号时不展开
    setUidMenuOpen((o) => !o);
  };
  const onSelectUid = async (selectedUid: string) => {
    setUidMenuOpen(false);
    try {
      await window.electronAPI.setLastQueryUid(selectedUid);
    } catch (e) {
      /* ignore */
    }
    await loadGachaRecords(selectedUid);
  };
  const onAskDeleteUid = (delUid: string) => {
    setUidMenuOpen(false);
    setPendingDeleteUid(delUid);
    setDeleteModalOpen(true);
  };
  const onConfirmDelete = async () => {
    const delUid = pendingDeleteUid;
    setDeleteModalOpen(false);
    setPendingDeleteUid(null);
    if (delUid != null) await runDeleteUid(delUid);
  };

  /* ---------- 刷新 / 鸣潮内获取 ---------- */
  const onRefresh = async () => {
    if (refreshLoading || importLoading) return;
    setRefreshLoading(true);
    try {
      const result = await window.electronAPI.refreshGachaRecords();
      if (result && result.success) {
        await reloadGachaData(result.playerId);
      } else {
        console.error(result && result.error);
      }
    } catch (error) {
      console.error('发生错误:', error);
    } finally {
      setRefreshLoading(false);
    }
  };
  const onImport = async () => {
    if (importLoading || refreshLoading) return;
    setImportLoading(true);
    try {
      const result = await window.electronAPI.importGachaFromGame();
      if (result && result.success) {
        await reloadGachaData(result.playerId);
      } else {
        console.error(result && result.error);
      }
    } catch (error) {
      console.error('鸣潮内获取发生错误:', error);
    } finally {
      setImportLoading(false);
    }
  };

  /* ---------- 隐藏卡池弹窗 ---------- */
  const records = useGachaSelector((s) => s.records);
  const hideOptions = useMemo(
    () => poolTitles().concat([{ key: '__SUMMARY_ALL__', title: '全部卡池' }]),
    // poolTitles() 基于 store 快照 records 同步派生；records 变化时重建选项
    [records],
  );
  const hideSelectedCount = useMemo(
    () => hideOptions.filter((o) => hideSelected.has(o.key)).length,
    [hideOptions, hideSelected],
  );
  const allHideSelected = hideOptions.length > 0 && hideSelectedCount === hideOptions.length;
  const onOpenHideModal = () => {
    setHideSelected(new Set(getHiddenPools()));
    setHideModalOpen(true);
  };
  const toggleHidePool = (key: string) => {
    setHideSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const onSelectAllHide = () => {
    setHideSelected(allHideSelected ? new Set() : new Set(hideOptions.map((o) => o.key)));
  };
  const onApplyHidePools = () => {
    const selected = hideOptions.filter((o) => hideSelected.has(o.key)).map((o) => o.key);
    applyHiddenPools(selected);
    setHideModalOpen(false);
    notify(true, '已应用隐藏卡池设置');
  };

  /* ---------- 同步账号下拉（奇藏/等级子行右侧） ---------- */
  const onSwitchAccount = (a: TreasureAccount) => {
    setAccMenuOpen(false);
    switchAccount(a);
  };

  return (
    <>
      <div className="tool-container">
        <div className="page-head">
          <h1 className="page-title">{title}</h1>
        </div>
        <div className="tool-header">
          <div
            id="uid-dropdown"
            className="custom-dropdown"
            onMouseLeave={() => setUidMenuOpen(false)}
          >
            <div className="selected-display" data-value={uid != null ? String(uid) : ''} onClick={toggleUidMenu}>
              {uidDisplay}
            </div>
            <ul className={'options-list' + (uidMenuOpen ? ' show' : '')}>
              {uidOptions.map((optUid) => (
                <li
                  key={optUid}
                  className={'dropdown-option' + (String(optUid) === String(uid) ? ' active' : '')}
                  data-value={optUid}
                  onClick={() => onSelectUid(optUid)}
                >
                  {optUid}
                  <button
                    className="delete-btn"
                    type="button"
                    title="删除该 UID 的所有记录"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskDeleteUid(optUid);
                    }}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div id="status-display" className="status-display">
            <span className="status-text">{statusMessage}</span>
          </div>
          <div className="tool-actions">
            <button
              id="refresh-data"
              className={'refresh-button' + (refreshLoading ? ' is-loading' : '')}
              title="通过云鸣潮读取唤取链接"
              disabled={refreshLoading || importLoading}
              aria-busy={refreshLoading}
              onClick={onRefresh}
            >
              {refreshLoading ? (
                <>
                  <span className="btn-spinner" aria-hidden="true"></span>
                  <span>云鸣潮获取</span>
                </>
              ) : (
                '云鸣潮获取'
              )}
            </button>
            <button
              id="import-from-game"
              className={'refresh-button' + (importLoading ? ' is-loading' : '')}
              title="从本地鸣潮游戏日志读取唤取链接"
              disabled={importLoading || refreshLoading}
              aria-busy={importLoading}
              onClick={onImport}
            >
              {importLoading ? (
                <>
                  <span className="btn-spinner" aria-hidden="true"></span>
                  <span>鸣潮内获取</span>
                </>
              ) : (
                '鸣潮内获取'
              )}
            </button>
            <button
              id="hidePoolsBtn"
              className="refresh-button secondary"
              title="隐藏卡池"
              onClick={onOpenHideModal}
            >
              隐藏卡池
            </button>
          </div>
        </div>
        <div className="record-wrapper">
          <div
            id="analysis-tabbar"
            className="analysis-tabbar"
            role="tablist"
            aria-label="抽卡分析视图"
            style={{ display: showTabbar ? '' : 'none' }}
          >
            <button
              className={'analysis-tab' + (currentView === 'bar' ? ' active' : '')}
              data-view="bar"
              role="tab"
              aria-selected={currentView === 'bar'}
              onClick={onAnalysisTab('bar')}
            >
              列表
            </button>
            <button
              className={'analysis-tab' + (currentView === 'intuitive' ? ' active' : '')}
              data-view="intuitive"
              role="tab"
              aria-selected={currentView === 'intuitive'}
              onClick={onAnalysisTab('intuitive')}
            >
              卡片
            </button>
            <button
              className={'analysis-tab' + (currentView === 'detail' ? ' active' : '')}
              data-view="detail"
              role="tab"
              aria-selected={currentView === 'detail'}
              onClick={onAnalysisTab('detail')}
            >
              详情
            </button>
          </div>
          <div id="sub-view-row" className="sub-view-row" style={{ display: showSubRow ? '' : 'none' }}>
            <div id="sub-view-tabbar" className="analysis-tabbar" role="tablist" aria-label="数据视图切换">
              <button
                className={'analysis-tab' + (subMode === 'overview' ? ' active' : '')}
                data-mode="overview"
                role="tab"
                aria-selected={subMode === 'overview'}
                onClick={onSubTab('overview')}
              >
                数据总览
              </button>
              <button
                className={'analysis-tab' + (subMode === 'diff' ? ' active' : '')}
                data-mode="diff"
                role="tab"
                aria-selected={subMode === 'diff'}
                onClick={onSubTab('diff')}
              >
                差值对比
              </button>
            </div>
            {accountOptions.length > 0 ? (
              <div
                className="custom-dropdown ai-switch account-sync-inline"
                id="account-switch-sync"
                onMouseLeave={() => setAccMenuOpen(false)}
              >
                <div
                  className="selected-display"
                  title="切换同步账号"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAccMenuOpen((o) => !o);
                  }}
                >
                  {accountLabel}
                </div>
                <ul className={'options-list' + (accMenuOpen ? ' show' : '')}>
                  {accountOptions.map((a, i) => {
                    const resolved = !!effectiveUid(a);
                    const label = accountLabelOf(a);
                    const active = a.oauthCode != null && a.oauthCode === accountOauthCode;
                    return (
                      <li
                        key={a.oauthCode != null ? a.oauthCode : 'acc_' + i}
                        className={'dropdown-option' + (active ? ' active' : '')}
                        data-idx={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSwitchAccount(a);
                        }}
                      >
                        <span className="option-label">{effectiveUid(a) || label}</span>
                        <span className={'option-badge ' + (resolved ? 'resolved' : 'unresolved')}>
                          {resolved ? '已解析' : '未解析'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
          <div id="record-display" className="record-display">
            {loading ? (
              <SkeletonScreen />
            ) : (
              <>
                <BarView />
                <IntuitiveView />
                <TableView />
                <DetailView />
                <QizangView />
                <LevelView />
              </>
            )}
          </div>
        </div>
      </div>

      <div
        id="hidePoolsModal"
        className="modal"
        style={{ display: hideModalOpen ? 'flex' : 'none' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setHideModalOpen(false);
        }}
      >
        <div className="modal-content-game">
          <div className="modal-header-game">
            <div className="modal-title-group">
              <h2>隐藏卡池</h2>
              <p className="modal-subtitle">勾选后，所选卡池将从各分析视图中隐藏</p>
            </div>
            <button
              id="closeHidePoolsModal"
              className="close-button"
              onClick={() => setHideModalOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="modal-body-game">
            <div id="hidePoolsList" className="hide-pools-list">
              {hideOptions.map((opt) => (
                <div
                  key={opt.key}
                  className={'pool-row' + (hideSelected.has(opt.key) ? ' selected' : '')}
                  data-pool={opt.key}
                  onClick={() => toggleHidePool(opt.key)}
                >
                  <span className="pool-name">{opt.title}</span>
                  <span className="pool-check"></span>
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer-game has-left">
            <span className="modal-footnote">
              已选 <span id="hidePoolsCount">{hideSelectedCount}</span> 项
            </span>
            <div className="modal-foot-actions">
              <button
                id="hidePoolsSelectAll"
                className={'modal-button' + (allHideSelected ? ' primary' : '')}
                onClick={onSelectAllHide}
              >
                {allHideSelected ? '取消全选' : '全选'}
              </button>
              <button
                id="hidePoolsConfirm"
                className="modal-button primary"
                onClick={onApplyHidePools}
              >
                应用
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        id="deleteUidModal"
        className="modal"
        style={{ display: deleteModalOpen ? 'flex' : 'none' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setDeleteModalOpen(false);
            setPendingDeleteUid(null);
          }
        }}
      >
        <div className="modal-content-game" style={{ maxWidth: 360 }}>
          <div className="modal-header-game">
            <div className="modal-title-group">
              <h2 id="deleteUidTitle">删除确认</h2>
              <p className="modal-subtitle">删除后该账号的抽卡记录将被清除，且无法恢复</p>
            </div>
            <button
              id="closeDeleteUidModal"
              className="close-button"
              onClick={() => {
                setDeleteModalOpen(false);
                setPendingDeleteUid(null);
              }}
            >
              ×
            </button>
          </div>
          <div className="modal-body-game">
            <p id="deleteUidText" className="delete-uid-text">
              确定要删除 UID <strong>{pendingDeleteUid}</strong> 的所有记录吗？
            </p>
          </div>
          <div className="modal-footer-game">
            <button
              id="deleteUidCancel"
              className="modal-button"
              onClick={() => {
                setDeleteModalOpen(false);
                setPendingDeleteUid(null);
              }}
            >
              取消
            </button>
            <button id="deleteUidConfirm" className="modal-button primary danger" onClick={onConfirmDelete}>
              确认
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default memo(GameToolsPage);
