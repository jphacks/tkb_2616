// 募集で伝える予定時間。終了の操作や受付期限とは別の目安。
export const DURATION_OPTIONS = [
  { minutes: null, label: '相談して決める' },
  { minutes: 30, label: '30分' },
  { minutes: 60, label: '1時間' },
  { minutes: 90, label: '1時間半' },
  { minutes: 120, label: '2時間' },
  { minutes: 180, label: '3時間' },
  { minutes: 240, label: '4時間以上' },
] as const;

export function durationLabel(minutes?: number | null) {
  const option = DURATION_OPTIONS.find(option => option.minutes === minutes);
  if (!option || option.minutes === null) return '時間は相談';
  return option.minutes === 240 ? '4時間以上の予定' : `${option.label}くらい`;
}
