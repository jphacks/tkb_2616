import { useEffect, useRef, useState } from 'react';
import type { GameCandidate } from '../../packages/integrations/src/igdb';
import type { GameCatalog } from './game-catalog';
import { Field, Note, Stack, SubButton, Txt } from './ui';

export function GamePicker({ catalog, onPick, onCreate }: {
  catalog: GameCatalog;
  onPick: (game: GameCandidate) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<GameCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const search = async () => {
    if (!query.trim()) return;
    const ticket = ++request.current;
    setBusy(true); setFound([]); setNote('');
    try {
      const games = await catalog.search(query.trim());
      if (ticket !== request.current) return;
      setFound(games);
      if (!games.length) setNote('候補が見つかりませんでした。別の名前で検索するか、名前だけで追加できます。');
    } catch {
      if (ticket === request.current) setNote('検索できませんでした。もう一度検索するか、名前だけで追加できます。');
    } finally { if (ticket === request.current) setBusy(false); }
  };
  const save = async (run: () => Promise<void>) => {
    setSaving(true);
    try { await run(); } finally { setSaving(false); }
  };
  return <Stack gap={10}>
    <Note>ゲーム名で検索し、発売年・対応機種を確認して選んでください。</Note>
    <Field value={query} maxLength={100} placeholder="ゲーム名" onChangeText={text => {
      request.current++; setQuery(text); setFound([]); setBusy(false); setNote('');
    }} onSubmitEditing={() => { void search(); }} />
    <SubButton label={busy ? '検索中…' : 'ゲームを検索'} disabled={busy || saving || !query.trim()} onPress={() => { void search(); }} />
    {note ? <Note>{note}</Note> : null}
    {found.map(game => <SubButton key={game.id} disabled={saving} onPress={() => { void save(() => onPick(game)); }}
      label={`${game.name} · ${game.releaseYear ?? '発売年不明'}
${game.platforms.map(p => p.name).join(' / ') || '対応機種不明'}`} />)}
    {found.length ? <Note>ゲーム情報・画像の提供元：IGDB.com</Note> : null}
    <Txt size={13}>候補にない場合</Txt>
    <SubButton label="この名前だけで追加（画像なし）" disabled={saving || !query.trim()} onPress={() => { void save(() => onCreate(query.trim())); }} />
  </Stack>;
}
