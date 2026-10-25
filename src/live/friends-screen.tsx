// The same screen uses server data in the connected app and the explicit local demonstration service.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { GAMES, HEAT, PLATFORMS, SKILLS, type MyGame } from '../../app/src/data';
import { useStore } from '../../app/src/store';
import { C, useLayout } from '../../app/src/theme';
import {
  AppBar, Badge, Block, Card, Chip, Cols, Divider, Empty, Field, HeatSlider, HeatTag, MainButton,
  Note, Opt, PillButton, Row, SkillSlider, Stack, SubButton, TextButton, Txt,
} from '../../app/src/ui';
import { newOpId, type GameRow, type Result } from './api';
import {
  createFriendService, friendFailureText, friendGameRoute, useFriendUser,
  type FriendConnection, type FriendRecruitment, type FriendRequest,
} from './friends-api';
import { createOperation } from './operation';
import { rememberReturn } from './return-to';

type Data = { listings: FriendRecruitment[]; incoming: FriendRequest[]; sent: FriendRequest[]; friends: FriendConnection[] };
type Form = { game: GameRow | null; platform: string; skill: number | null; heat: number | null; from: string; to: string };
const validTime = (value: string, end = false) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || (end && value === '24:00');

function Initial({ name }: { name: string }) {
  const { s } = useLayout();
  return <View style={{ width: s(36), height: s(36), borderRadius: s(18), backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
    <Txt weight="bold" color={C.accent}>{name.slice(0, 1) || '友'}</Txt>
  </View>;
}

function GameImage({ game }: { game: GameRow | null | undefined }) {
  const { s } = useLayout();
  const url = game?.cover_image_id && !game.hide_cover ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover_image_id}.jpg` : null;
  return <View style={{ width: s(38), height: s(50), borderRadius: s(6), backgroundColor: C.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
    {url ? <Image source={{ uri: url }} accessibilityLabel={`${game?.name}のカバー画像`} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Feather name="image" size={s(18)} color={C.muted} />}
  </View>;
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  const { s } = useLayout();
  return <Stack gap={7} style={{ padding: s(14) }}><Txt size={13} weight="bold" color={C.muted}>{label}</Txt>{children}</Stack>;
}

function Section({ id, title, count, right, children }: { id: string; title: string; count?: number; right?: ReactNode; children: ReactNode }) {
  return <View testID={`friendrecruit:${id}`}><Block title={title} count={count} right={right}>{children}</Block></View>;
}

function RequestGame({ request }: { request: FriendRequest }) {
  const listing = request.friend_recruitments;
  return <Note>{listing?.games?.name ?? 'ゲーム'}のフレンド募集への申請</Note>;
}

/** Connections is a top-level tab: it never silently falls back to fixed PEOPLE data. */
export function FriendConnectionsScreen() {
  const { s: store, go, toast, confirm, open } = useStore();
  const { s } = useLayout();
  const userId = useFriendUser();
  const service = useMemo(() => createFriendService(userId ?? null), [userId]);
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Form>({ game: null, platform: '', skill: null, heat: null, from: store.me.times.start, to: store.me.times.end });
  const [query, setQuery] = useState('');
  const [games, setGames] = useState<GameRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [gameError, setGameError] = useState('');
  const [busy, setBusy] = useState(false);
  const [operation] = useState(() => createOperation(newOpId));
  const active = useRef(true);
  const loadVersion = useRef(0);
  const searchVersion = useRef(0);
  const currentService = useRef(service);
  currentService.current = service;

  useEffect(() => { active.current = true; return () => { active.current = false; loadVersion.current++; searchVersion.current++; }; }, []);

  const load = useCallback(async () => {
    if (userId === undefined) return;
    const version = ++loadVersion.current;
    try {
      const [listings, incoming, sent, friends] = await Promise.all([
        service.list(),
        userId ? service.requests() : Promise.resolve([]),
        userId ? service.sent() : Promise.resolve([]),
        userId ? service.connections() : Promise.resolve([]),
      ]);
      if (!active.current || version !== loadVersion.current || currentService.current !== service) return;
      setData({ listings, incoming, sent, friends }); setLoadError(false);
    } catch {
      if (active.current && version === loadVersion.current && currentService.current === service) setLoadError(true);
    }
  }, [service, userId]);

  useEffect(() => {
    setData(null); setLoadError(false); setMutationError(''); setShowForm(false);
    void load();
    return service.subscribe(() => { void load(); });
  }, [service, load]);

  const myGameFor = (game: GameRow): MyGame | undefined => store.me.games.find(item =>
    item.igdb?.id === game.id || item.igdb?.name === game.name || GAMES[item.tag]?.name === game.name);
  const chooseGame = (game: GameRow) => {
    const mine = myGameFor(game);
    setForm(previous => ({ ...previous, game, platform: mine?.platform ?? '', skill: mine?.skill ?? null, heat: mine?.heat ?? null }));
    setMutationError('');
  };
  const search = async (value: string, initial = false) => {
    const version = ++searchVersion.current;
    setSearching(true); setGameError('');
    try {
      const found = await service.games(value.trim());
      if (!active.current || version !== searchVersion.current || currentService.current !== service) return;
      setGames(found);
      if (initial && !form.game && found.length) {
        const fromProfile = found.find(game => myGameFor(game));
        if (fromProfile) chooseGame(fromProfile);
      }
    } catch {
      if (active.current && version === searchVersion.current) setGameError('ゲームを読み込めませんでした。もう一度探してください。');
    } finally { if (active.current && version === searchVersion.current) setSearching(false); }
  };

  const login = () => { rememberReturn(); toast('ログインすると、続けられます'); go('settings'); };
  const startForm = () => {
    if (!userId) return login();
    setShowForm(true); setMutationError('');
    if (!games.length) void search('', true);
  };
  const mutate = async (key: string, send: (opId: string) => Promise<Result>, success: string, done?: () => void) => {
    if (!userId) return login();
    if (operation.isPending()) return;
    setBusy(true); setMutationError('');
    const atService = service;
    try {
      const result = await operation.run(send, `${userId}:${key}`);
      if (!active.current || currentService.current !== atService) return;
      if (!result) return;
      if (!result.ok) { setMutationError(friendFailureText(result)); return; }
      done?.(); toast(success); await load();
    } catch {
      if (active.current && currentService.current === atService) setMutationError('処理結果を確認できませんでした。同じボタンでもう一度確認できます。');
    } finally { if (active.current && currentService.current === atService) setBusy(false); }
  };
  const publish = () => {
    if (!form.game || !form.platform || form.skill == null || form.heat == null) return setMutationError('ゲーム・機種・実力・熱量を選んでください');
    if (!validTime(form.from) || !validTime(form.to, true)) return setMutationError('遊ぶ時間は21:00のように入れてください。終わりには24:00も使えます');
    const input = { gameId: form.game.id, nickname: store.me.nickname, platform: form.platform, skill: form.skill, enthusiasm: form.heat, availableFrom: form.from, availableTo: form.to };
    void mutate(`publish:${JSON.stringify(input)}`, id => service.publish(id, input), 'フレンド募集を出しました', () => setShowForm(false));
  };

  const header = <AppBar title="フレンド" subtitle="一緒に遊ぶ仲間を見つけて、つながりましょう。" right={<SubButton label="＋ フレンド募集" onPress={startForm} disabled={busy || userId === undefined} />} />;
  const error = mutationError ? <Card pad style={{ borderColor: C.danger }}><Note color={C.danger}>{mutationError}</Note></Card> : null;
  const formView = showForm ? <Section id="募集の条件" title="フレンドを募集する" right={<TextButton label="閉じる" onPress={() => setShowForm(false)} disabled={busy} />}>
    <Cols even left={<Card>
      <FormRow label="ゲーム">
        {form.game ? <Row gap={10}><GameImage game={form.game} /><Txt size={16} weight="bold" style={{ flex: 1 }}>{form.game.name}</Txt></Row> : <Note>ゲームを選んでください</Note>}
        <Row gap={8}>
          <Field value={query} onChangeText={setQuery} onSubmitEditing={() => { void search(query); }} placeholder="ゲーム名で探す" accessibilityLabel="フレンド募集のゲーム名" maxLength={100} style={{ flex: 1 }} />
          <SubButton label={searching ? '探しています…' : '探す'} disabled={searching || busy} onPress={() => { void search(query); }} />
        </Row>
        {gameError ? <Note color={C.danger}>{gameError}</Note> : null}
        <Row wrap gap={6}>{games.map(game => <Opt key={game.id} label={game.name} on={form.game?.id === game.id} onPress={() => chooseGame(game)} />)}</Row>
        {!searching && !gameError && !games.length ? <Note>ゲームが見つかりません。名前を変えて探してください。</Note> : null}
        <TextButton label="ゲームの名前と画像：IGDB.com" onPress={() => open('https://www.igdb.com/')} />
      </FormRow>
      <Divider />
      <FormRow label="機種"><Row wrap gap={6}>{PLATFORMS.map(value => <Opt key={value} label={value} on={form.platform === value} onPress={() => setForm(previous => ({ ...previous, platform: value }))} />)}</Row></FormRow>
    </Card>} right={<Card>
      <FormRow label="熱量">
        {form.heat == null ? <Row wrap gap={6}>{HEAT.map((value, i) => <Opt key={value} label={value} on={false} onPress={() => setForm(previous => ({ ...previous, heat: i }))} />)}</Row>
          : <><HeatTag value={form.heat} /><HeatSlider value={form.heat} onChange={heat => setForm(previous => ({ ...previous, heat }))} /></>}
      </FormRow>
      <Divider />
      <FormRow label="実力">
        {form.skill == null ? <Row wrap gap={6}>{SKILLS.map(value => <Opt key={value} label={String(value)} on={false} onPress={() => setForm(previous => ({ ...previous, skill: value }))} />)}</Row>
          : <><Note>{form.skill} / 9 ・ 大きいほど上手い</Note><SkillSlider value={form.skill} onChange={skill => setForm(previous => ({ ...previous, skill }))} /></>}
      </FormRow>
      <Divider />
      <FormRow label="いつも遊ぶ時間">
        <Row gap={10} wrap>
          <Field mono value={form.from} maxLength={5} accessibilityLabel="フレンド募集の遊ぶ時間の始まり" onChangeText={from => setForm(previous => ({ ...previous, from }))} style={{ width: s(110) }} />
          <Txt>〜</Txt>
          <Field mono value={form.to} maxLength={5} accessibilityLabel="フレンド募集の遊ぶ時間の終わり" onChangeText={to => setForm(previous => ({ ...previous, to }))} style={{ width: s(110) }} />
        </Row>
        <Note>この募集に使う条件です。プロフィールは変更しません。</Note>
      </FormRow>
      <View testID="friendrecruit:募集を出す" style={{ padding: s(14), paddingTop: 0 }}><MainButton label={busy ? '確認しています…' : 'フレンドを募集する'} disabled={busy || searching || !form.game || !form.platform || form.skill == null || form.heat == null} onPress={publish} /></View>
    </Card>} />
  </Section> : null;

  if (userId === undefined || !data) return <Stack>{header}{error}{formView}<Card><Empty
    title={loadError ? 'フレンド募集を読み込めませんでした' : 'フレンド募集を読み込んでいます…'} text=""
    button={loadError ? { label: 'もう一度読み込む', onPress: () => { void load(); } } : undefined}
  /></Card></Stack>;

  const incoming = data.incoming.filter(request => request.status === 'pending');
  const listings = data.listings.filter(listing => !listing.closed_at || listing.owner_id === userId);
  const friendsById = new Set(data.friends.map(friend => friend.peer_id));
  const sentByRecruitment = new Map(data.sent.filter(request => request.status === 'pending').map(request => [request.recruitment_id, request]));
  const sentTo = new Set(data.sent.filter(request => request.status === 'pending').map(request => request.recipient_id));
  const incomingFrom = new Set(incoming.map(request => request.sender_id));
  const loginCard = <Card><Empty title="ログインすると使えます" text="届いた申請と、つながったフレンドがここに出ます。" button={{ label: 'ログインする', onPress: login }} /></Card>;
  const list = <Section id="募集一覧" title="フレンド募集" count={listings.length}>
    <Note>日時や人数を決める募集とは別に、いつも遊べる仲間を探せます。</Note>
    <TextButton label="ゲームの名前と画像：IGDB.com" onPress={() => open('https://www.igdb.com/')} />
    {loadError ? <Card pad><Stack gap={8}><Note color={C.danger}>最新の内容を読み込めませんでした。表示中の内容を残しています。</Note><TextButton label="もう一度読み込む" onPress={() => { void load(); }} /></Stack></Card> : null}
    {listings.length ? listings.map(listing => {
      const own = listing.owner_id === userId;
      const connected = friendsById.has(listing.owner_id);
      const sent = sentByRecruitment.get(listing.id) || sentTo.has(listing.owner_id);
      return <Card pad key={listing.id}><Stack gap={12}>
        <Row gap={10}><Initial name={listing.nickname} /><Stack gap={2} style={{ flex: 1 }}><Txt weight="bold">{listing.nickname}</Txt><Note>{own ? 'あなたのフレンド募集' : 'フレンド募集中'}</Note></Stack>{listing.closed_at ? <Badge label="受付終了" tone="rest" /> : <Badge label="募集中" tone="ok" />}</Row>
        <Row gap={10}><GameImage game={listing.games} /><Txt size={17} weight="bold" style={{ flex: 1 }}>{listing.games?.name ?? 'ゲーム'}</Txt></Row>
        <Row wrap gap={6}><Chip label={listing.platform} /><Chip label={`実力 ${listing.skill} / 9`} /><HeatTag value={listing.enthusiasm} /></Row>
        <Row gap={7}><Feather name="clock" size={s(14)} color={C.muted} /><Note>{listing.available_from}〜{listing.available_to}</Note></Row>
        <View testID="friendrecruit:フレンド申請を送る"><Row style={{ justifyContent: 'flex-end' }}>
          {own ? listing.closed_at ? <Note>新しい申請の受付を終えています</Note> : <TextButton label="募集を閉じる" disabled={busy} onPress={() => { void (async () => {
            if (!await confirm('このフレンド募集を閉じますか？ 届いている申請は引き続き承認できます。')) return;
            await mutate(`close:${listing.id}`, id => service.close(id, listing.id), 'フレンド募集を閉じました');
          })(); }} />
            : <PillButton label={connected ? 'フレンドです' : sent ? '申請済み' : incomingFrom.has(listing.owner_id) ? '相手から申請が届いています' : 'フレンド申請を送る'}
              disabled={busy || connected || !!sent || incomingFrom.has(listing.owner_id) || !!listing.closed_at}
              onPress={() => { if (!userId) return login(); void mutate(`apply:${listing.id}:${store.me.nickname}`, id => service.apply(id, listing.id, store.me.nickname), 'フレンド申請を送りました'); }} />}
        </Row></View>
      </Stack></Card>;
    }) : <Card><Empty title="フレンド募集はまだありません" text="好きなゲームと遊び方を選んで、フレンドを募集できます。" button={{ label: 'フレンドを募集する', onPress: startForm }} /></Card>}
  </Section>;
  const requests = <Section id="届いた申請" title="届いた申請" count={incoming.length}>
    {!userId ? loginCard : incoming.length ? incoming.map(request => <Card pad key={request.id}><Stack gap={10}>
      <Row gap={10}><Initial name={request.nickname} /><Txt weight="bold" style={{ flex: 1 }}>{request.nickname}</Txt><Badge label="承認待ち" tone="warn" /></Row>
      <RequestGame request={request} />
      <View testID="friendrecruit:承認する"><Row style={{ justifyContent: 'flex-end' }}><PillButton ok label={busy ? '確認しています…' : '承認してフレンドになる'} disabled={busy} onPress={() => { void mutate(`accept:${request.id}`, id => service.accept(id, request.id), `${request.nickname}さんとフレンドになりました`); }} /></Row></View>
    </Stack></Card>) : <Card><Empty title="届いたフレンド申請はありません" text="あなたのフレンド募集から申請が届くと、ここで確認できます。" /></Card>}
  </Section>;
  const friends = <Section id="フレンド" title="フレンド" count={data.friends.length}>
    {!userId ? null : data.friends.length ? data.friends.map(friend => <Card pad key={friend.peer_id}><Stack gap={10}>
      <Row gap={10}><Initial name={friend.nickname} /><Txt weight="bold" style={{ flex: 1 }}>{friend.nickname}</Txt><Badge label="フレンド" tone="ok" /></Row>
      <Chip label={friend.game_name} common />
      <Row gap={8} wrap style={{ justifyContent: 'space-between' }}>
        <TextButton danger label="フレンドを外す" disabled={busy} onPress={() => { void (async () => {
          if (!await confirm(`${friend.nickname}さんをフレンドから外しますか？`)) return;
          await mutate(`remove:${friend.peer_id}`, id => service.remove(id, friend.peer_id), 'フレンドを外しました');
        })(); }} />
        <PillButton label="このゲームで募集" disabled={busy} onPress={() => go('create', { game: friendGameRoute(friend.game_id) })} />
      </Row>
    </Stack></Card>) : <Card><Empty title="フレンドはまだいません" text="募集から届いた申請を承認すると、ここに相手が並びます。" /></Card>}
  </Section>;
  return <View testID="friendrecruit:画面全体"><Stack>{header}{error}{formView}<Cols even left={list} right={<>{requests}{friends}</>} /></Stack></View>;
}
