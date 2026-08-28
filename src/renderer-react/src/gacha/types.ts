/**
 * 抽卡分析视图 —— 共享类型定义。
 *
 * 这些类型与主进程返回的 gacha_logs 记录字段保持一致（player_id 为 TEXT 列，
 * 与遗留 gachaWuwa.js 的字符串 UID 约束完全对齐）。
 */

/** 一条唤取记录（gacha_logs 行） */
export interface GachaRecord {
  id?: number;
  player_id: string | number;
  card_pool_type: string;
  resource_id?: string | number;
  name: string;
  quality_level: number;
  timestamp: string;
  time?: string;
  lang?: string;
}

/** card_pool_type -> 该卡池的记录数组 */
export type GachaPool = Record<string, GachaRecord[]>;

/** 头像映射：resource_id / name -> local:// 头像 url（主进程 getGachaAvatars 预解析） */
export interface AvatarMap {
  byResourceId: Record<string, string>;
  byName: Record<string, string>;
}

/** 常驻物品条目（get-common-items 返回：纯名字字符串，或 {name, addedTime} 对象） */
export type CommonItemShape = string | { name: string; addedTime: string };

/** 奇藏「已有」数据（cachedTreasure 镜像：名称 -> 数量） */
export type TreasureData = Record<string, number>;

/** 奇藏同步账号（list-treasure-accounts / get-game-account-state 返回；uid 为游戏内 UID，可能为 null） */
export interface TreasureAccount {
  oauthCode: string | null;
  username: string | null;
  accountId: string | null;
  maskedPhone: string | null;
  isGlobal: boolean;
  regionKey: string;
  uid: string | null;
  /** 兜底账号（启动器缓存为空时用游戏本地状态），无 oauthCode 无法刷新奇藏 */
  _fromGame?: boolean;
}

/** 视图数据状态：idle=尚无数据 · loading=重载骨架 · ready=数据就绪（含空数据） */
export type GachaStatus = 'idle' | 'loading' | 'ready';

/** 分析页视图状态（侧边栏 / 主 tabbar）；table 为遗留隐藏视图，保留迁移不激活 */
export type GachaNavView = 'bar' | 'intuitive' | 'table' | 'detail' | 'qizang' | 'level';

/** 奇藏/等级子模式：总览 / 差值对比 */
export type GachaSubMode = 'overview' | 'diff';

/** React 视图侧的数据快照（由 gacha/data.ts + gacha/treasure.ts 发布） */
export interface GachaDataState {
  status: GachaStatus;
  records: GachaRecord[];
  pools: GachaPool;
  /** 当前选中账号 UID（下拉框显示 + 记录加载依据） */
  uid: string | null;
  /** UID 下拉框选项（get-player-uids 返回） */
  uidOptions: string[];
  /** 状态栏提示文案（主进程 gacha-records-status 推送 / 默认引导） */
  statusMessage: string;
  avatarMap: AvatarMap;
  commonItems: CommonItemShape[];
  /** 当前账号隐藏卡池 key 列表（含 '__SUMMARY_ALL__'） */
  hiddenPools: string[];
  /** 当前账号奇藏「已有」数据（cachedTreasure 镜像） */
  treasure: TreasureData | null;
  /** 当前账号角色等级（cachedLevel 镜像） */
  level: number | null;
  /** 奇藏同步账号下拉框选项（list-treasure-accounts） */
  accountOptions: TreasureAccount[];
  /** 当前选中同步账号 oauthCode（_accountState.oauthCode 镜像） */
  accountOauthCode: string | null;
  /** 当前选中同步账号区服 */
  accountIsGlobal: boolean | null;
  /** 当前选中同步账号的显示文案（已解析 UID 优先，回退账号标识） */
  accountLabel: string;
  /** 当前分析子视图（bar/intuitive/detail/qizang/level，缺省 bar） */
  currentView: GachaNavView;
  /** 奇藏视图子模式（总览/差值对比），由 sub-view-tabbar 切换 */
  qizangSubMode: GachaSubMode;
  /** 等级视图子模式（总览/差值对比），由 sub-view-tabbar 切换 */
  levelSubMode: GachaSubMode;
  /** 数字缩写(w)/完整切换（奇藏/等级共用） */
  growNumFull: boolean;
}