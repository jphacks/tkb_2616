import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { ownSteamLibrary } from '../lib/own-steam';
import { importSteamGames } from '../../app/src/steam-profile-import';
import { useStore } from '../../app/src/store';
import { C, useLayout } from '../../app/src/theme';
import { AppBar, Badge, Block, Card, Cols, Note, Row, Stack, SubButton, TextButton, Txt } from '../../app/src/ui';
import { createConnectedSettings } from '../auth/settings';
import { isLoginEnabled, loginProviders } from '../auth/flow';
import { externalBrowserMessage, needsExternalBrowser } from '../auth/browser-environment';
import { lastUpdatedLabel, linkStatusLabels, type LinkStatus } from '../../packages/integrations/src/link-status';

const names = { discord: 'Discord', google: 'Google', steam: 'Steam', apple: 'Apple' };
const explanations: Record<string, string> = {
  pending: 'まだ取得が完了していません。',
  available: '最後に取得できた情報です。',
  private: '非公開を確認したため、取得データを表示しません。0時間としては扱いません。',
  unavailable: '情報を取得できません。0時間としては扱いません。',
  retry_wait: '一時的に取得できませんでした。前回取得した情報は保持し、自動で再試行します。',
  relink_required: 'もう一度連携してください。',
  configuration_error: '接続先の設定を確認する必要があります。',
};
function dateLabel(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ja-JP') : null;
}

export function ConnectedSettingsScreen({ steamOnly = false }: { steamOnly?: boolean }) {
  const { go, copy, open, confirm, editProfile, toast } = useStore();
  const [importing, setImporting] = useState(false);
  const { s } = useLayout();
  const [controller] = useState(createConnectedSettings);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [, tick] = useState(0);
  useEffect(() => controller.start(), [controller]);
  useEffect(() => {
    const refresh = () => { if (!controller.getSnapshot().busy) void controller.refresh(); };
    const subscription = AppState.addEventListener('change', value => { if (value === 'active') refresh(); });
    if (Platform.OS === 'web') window.addEventListener('focus', refresh);
    const timer = setInterval(() => tick(value => value + 1), 60_000);
    return () => { subscription.remove(); clearInterval(timer); if (Platform.OS === 'web') window.removeEventListener('focus', refresh); };
  }, [controller]);
  const embedded = Platform.OS === 'web' && needsExternalBrowser(navigator.userAgent);
  const disabled = !state.configured || state.authLoading || !!state.busy;
  const linkDisabled = disabled || !state.userId || state.linksLoading || state.links === null;
  const copyPage = () => { if (Platform.OS === 'web') void copy(window.location.href, 'リンクをコピーしました。SafariやChromeで開いてください'); };

  const importGames = async () => {
    const userId = state.userId;
    if (!userId || importing) return;
    setImporting(true);
    try {
      const library = await ownSteamLibrary();
      if (controller.getSnapshot().userId !== userId) return;
      if (!library) { toast('Steamでログインするか、下の「Steamと連携」からゲーム情報をつないでください'); return; }
      if (library.status !== 'available') { toast('Steamのゲーム詳細が非公開か、取得できない状態です'); return; }
      const saved = await editProfile(profile => { profile.steamImportDisabled = false; importSteamGames(profile, library); });
      if (saved) toast('Steamのゲームとプレイ時間をプロフィールに追加しました');
    } catch { if (controller.getSnapshot().userId === userId) toast('Steamの情報を取得できませんでした。時間をおいて再取得してください'); }
    finally { setImporting(false); }
  };

  const account = <>
    <Block title="アカウント">
      <Card pad><Stack gap={16}>
        <Row gap={10} wrap>
          <Feather name="user" size={s(22)} color={C.ink} />
          <Txt size={15} weight="bold" style={{ flex: 1 }}>{state.authLoading ? 'ログイン状態を確認しています…' : state.userId ? 'ログイン中' : '未ログイン'}</Txt>
          {!state.configured ? <Badge label="未設定" tone="warn" /> : null}
        </Row>
        <Note>{state.configured
          ? 'この設定画面は実際のログイン・連携状態を表示します。募集・参加・承認も実際のデータで動きます。プロフィールはこのブラウザにアカウント別で保存します。フレンドはデモです。'
          : 'この設定画面は実際のログイン・連携状態を表示します。募集DBの接続先が未設定です。プロフィールとフレンドは端末内のデモデータです。'}</Note>
        <Note>Steamでログインすると、本人の公開ゲームと累計プレイ時間を取得し、プロフィールへ追加します。実力・熱量は自分で変更できます。</Note>
        {state.userId ? <SubButton label={importing ? 'ゲームを取得しています…' : 'Steamのゲームを取得してプロフィールに追加'} disabled={disabled || importing} onPress={() => { void importGames(); }} /> : null}
        {state.userId ? <SubButton label={state.busy === 'logout' ? 'ログアウト中…' : 'ログアウト'} disabled={disabled} onPress={async () => {
          const userId = state.userId;
          if (await confirm('ログアウトしますか？') && controller.getSnapshot().userId === userId) await controller.logout();
        }} /> : <>
          <Note>{steamOnly ? '募集DBにはSteamでログインできます。Discordなど外部アカウントの追加連携は、ログイン後に設定できます。' : 'Discord・Google・Steamからログイン方法を選べます。Discordなど外部アカウントの追加連携は、ログイン後に設定できます。'}</Note>
          <Row gap={8} wrap>{loginProviders.filter(provider => !steamOnly || provider === 'steam').map(provider => <SubButton key={provider}
            label={state.busy === `login:${provider}` ? '接続中…' : names[provider]}
            accessibilityLabel={provider === 'steam' ? 'Steamでログインしてゲームを取得' : `${names[provider]}でログイン`} icon={({ discord: 'logo-discord', google: 'logo-google', steam: 'logo-steam', apple: 'logo-apple' } as const)[provider]} style={{ flexGrow: 1, minWidth: '44%', minHeight: s(46) }}
            disabled={disabled || !isLoginEnabled(provider) || (provider === 'google' && embedded)} onPress={() => { void controller.login(provider); }} />)}</Row>
        </>}
        {state.message ? <View accessibilityRole="alert" style={{ padding: s(12), borderRadius: s(12), backgroundColor: C.warnBg }}><Txt size={12} color={C.warn}>{state.message}</Txt></View> : null}
      </Stack></Card>
    </Block>
    {embedded ? <Card pad><Stack gap={8}>
      <Note color={C.warn}>{externalBrowserMessage}</Note>
      <SubButton label="このページのリンクをコピー" onPress={copyPage} />
    </Stack></Card> : null}
    <Card pad><Stack gap={6}>
      <Txt size={13} weight="bold">このアプリについて</Txt>
      <TextButton label="IGDB.com（ゲーム検索の提供元）" onPress={() => open('https://www.igdb.com/')} />
    </Stack></Card>
  </>;
  const integrations = <Block title="外部アカウント">
    {state.userId ? <Card pad><Stack gap={8}>
      <Note>{state.linksLoading ? '連携状態を読み込んでいます…' : state.linksError ? '連携状態を確認できませんでした。未連携かどうかはまだ分かりません。' : '連携は任意です。ログイン方法とは別に管理します。'}</Note>
      <SubButton label={state.linksError ? '連携状態を再確認' : '連携状態を確認'} disabled={disabled || state.linksLoading} onPress={() => { void controller.refresh(); }} />
    </Stack></Card> : null}
    {(['steam', 'discord'] as const).filter(provider => !steamOnly || provider === 'steam').map(provider => {
      const link = state.links?.find(item => item.provider === provider);
      return <Card key={provider} pad><Stack gap={14}>
        <Row gap={10} wrap>
          <Ionicons name={provider === 'steam' ? 'logo-steam' : 'logo-discord'} size={s(24)} color={C.ink} />
          <Stack gap={0} style={{ flex: 1 }}><Txt size={16} weight="bold">{names[provider]}</Txt><Note>{provider === 'steam' ? 'ゲームとプレイ時間' : 'アカウントのID確認'}</Note></Stack>
          <Badge label={!state.configured ? '未設定' : !state.userId ? 'ログインが必要' : state.linksLoading ? '確認中' : state.links === null ? '未確認' : link ? linkStatusLabels[link.status] ?? '状態を確認してください' : '未連携'} tone={link?.status === 'available' ? 'ok' : 'rest'} />
        </Row>
        <Note>{provider === 'discord' ? 'DiscordのアカウントをIDで確認します。名前・アイコン・メール・アカウントの作成時期は取得・表示しません。実名の本人確認ではありません。' : 'Steamでログインした場合は本人のゲームを自動取得します。別の方法でログインした場合も、ここからSteamと連携して取得できます。'}</Note>
        {link ? <LinkDetails link={link} /> : null}
        {embedded ? <Note color={C.warn}>連携はSafariやChromeなどのブラウザで開いて行ってください。</Note> : null}
        <Row gap={8} wrap>
          {!link || link.status === 'relink_required' ? <SubButton style={{ flex: 1 }} icon="link-outline"
            label={state.busy === `link:${provider}` ? '認証ページを開いています…' : link ? 'もう一度連携する' : `${names[provider]}と連携`}
            disabled={linkDisabled} onPress={() => { void controller.link(provider); }} /> : null}
          {link ? <SubButton label={state.busy === `unlink:${provider}` ? '解除中…' : '連携を解除'} disabled={linkDisabled} danger onPress={async () => {
            const userId = state.userId;
            if (await confirm(`${names[provider]}との情報連携を解除しますか？連携で取得したデータを削除します。ログイン方法、手入力の情報、募集・成立記録は残ります。`)) {
              if (controller.getSnapshot().userId === userId) {
                await controller.unlink(provider);
                if (provider === 'steam' && controller.getSnapshot().message === '連携を解除しました。') {
                  await editProfile(profile => {
                    profile.steamImportDisabled = true;
                    profile.games = profile.games.filter(game => !game.steam?.appId);
                    profile.steamImportedAppIds = [];
                  });
                }
              }
            }
          }} /> : null}
        </Row>
      </Stack></Card>;
    })}
  </Block>;
  return <Stack><AppBar title="設定" subtitle="アカウントと連携を、あなたのペースで。" onBack={() => go('profile')} /><Cols even left={account} right={integrations} /></Stack>;
}

function LinkDetails({ link }: { link: LinkStatus }) {
  const last = dateLabel(link.lastSuccessAt);
  const next = dateLabel(link.nextAttemptAt);
  return <Stack gap={6}>
    <Txt size={14}>連携先ID：{link.externalId}</Txt>
    <Note>{explanations[link.status] ?? '連携状態を再確認してください。'}</Note>
    <Note>最終成功：{lastUpdatedLabel(link.lastSuccessAt)}{last ? `（${last}）` : ''}</Note>
    {link.provider === 'steam' ? <>
      {next ? <Note>次回の取得予定：{next}</Note> : null}
      <Note>本人のゲームと累計プレイ時間はプロフィールで確認できます。再取得には上の「Steamのゲームを取得」を使ってください。実力・熱量はSteamの実測値ではなく、自分で変更する設定です。</Note>
    </> : null}
  </Stack>;
}
