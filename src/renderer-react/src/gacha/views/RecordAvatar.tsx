/**
 * 记录头像单元格（共享）—— 等价遗留 recordAvatarHtml：有本地头像显示 <img>，
 * 无则回退星级文字 span。供表格 / 详情两视图复用。
 */
import { avatarUrlOf } from '../utils';
import type { AvatarMap, GachaRecord } from '../types';

export default function RecordAvatar({ record, map }: { record: GachaRecord; map: AvatarMap }) {
  const url = avatarUrlOf(record, map);
  if (url) {
    return <img className={`record-avatar q${record.quality_level}`} src={url} alt={record.name || ''} />;
  }
  const cls = record.quality_level === 5 ? 'gold' : record.quality_level === 4 ? 'purple' : 'blue';
  return <span className={`record-star ${cls}`}>{record.quality_level} 星</span>;
}