// Other people's profiles from the database: open by app ID (profile-13), from a profile link (profile-10).
// Contracts: supabase/README.md (profile_by_app_id). Sending a friend request from a profile is not in the
// database yet (requests go to a friend recruitment), so this screen has no request button.
import { useEffect, useState } from 'react';
import { AppBar, Card, Empty, Field, Note, Row, Stack, SubButton, Txt } from '../../app/src/ui';
import { C } from '../../app/src/theme';
import { useStore } from '../../app/src/store';
import { PersonMissing, PersonView } from '../../app/src/screens/Profile';
import type { MyGame, Person } from '../../app/src/data';
import { getSupabase } from '../lib/supabase';
import { IGDB_COVER, fromCloudProfile, type CloudProfile } from '../lib/profile-cloud';

const APP_ID = /^[a-z0-9_]{3,20}$/;
type Loaded = { status: 'loading' } | { status: 'missing' } | { status: 'error' } | { status: 'ok'; person: Person; cloud: CloudProfile };

export function LivePersonScreen({ params }: { params: Record<string, string> }) {
  const { go } = useStore();
  const appId = (params.id ?? '').trim().toLowerCase();
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!APP_ID.test(appId)) { setState({ status: 'missing' }); return; }
    const client = getSupabase();
    if (!client) { setState({ status: 'error' }); return; }
    let active = true;
    setState({ status: 'loading' });
    void Promise.resolve(client.rpc('profile_by_app_id', { p_app_id: appId })).then(({ data, error }) => {
      if (!active) return;
      if (error) return setState({ status: 'error' });
      const cloud = data as CloudProfile | null;
      if (!cloud) return setState({ status: 'missing' });
      setState({ status: 'ok', cloud, person: { ...fromCloudProfile(cloud), trust: null } });
    }, () => { if (active) setState({ status: 'error' }); });
    return () => { active = false; };
  }, [appId, attempt]);

  if (state.status === 'missing') return <PersonMissing />;
  if (state.status !== 'ok') {
    return (
      <Stack>
        <AppBar title="プロフィール" onBack={() => go('profile')} />
        <Card>{state.status === 'loading'
          ? <Empty title="プロフィールを読み込んでいます…" text="" />
          : <Empty title="プロフィールを読み込めませんでした" text="通信を確かめて、もう一度お試しください。" button={{ label: 'もう一度読み込む', onPress: () => setAttempt(n => n + 1) }} />}</Card>
      </Stack>
    );
  }
  const { cloud, person } = state;
  // Covers from the profile itself; a game the company asked to hide has none (app-13)
  const covers = new Map(cloud.games.filter(g => g.game_id && g.cover_image_id).map(g => [`igdb:${g.game_id}`, IGDB_COVER(g.cover_image_id!)]));
  const coverUrlOf = (g: MyGame) => covers.get(g.tag);
  const badge = cloud.is_self ? 'あなた' : cloud.is_friend ? 'フレンド' : null;
  return <PersonView p={person} onBack={() => go('profile')} coverUrlOf={coverUrlOf}
    showLocked={!!(cloud.is_self || cloud.is_friend)}
    right={badge ? <Txt size={12} weight="bold" color={C.ok}>{badge}</Txt> : null} />;
}

// Type an app ID to open that profile (profile-13)
export function LiveSearchIdScreen() {
  const { go, toast } = useStore();
  const [id, setId] = useState('');
  const submit = () => {
    const appId = id.trim().toLowerCase();
    if (!APP_ID.test(appId)) return toast('アプリIDは英数字と _ の3〜20文字です');
    go('person', { id: appId });
  };
  return (
    <Stack>
      <AppBar title="IDで探す" onBack={() => go('profile')} />
      <Card pad>
        <Stack gap={8}>
          <Note>LINEのステータスメッセージなどに書かれたアプリIDを入れると、その人のプロフィールが開きます。</Note>
          <Row>
            <Field value={id} onChangeText={setId} placeholder="例：yu_7" autoCapitalize="none" autoCorrect={false} style={{ flex: 1 }} onSubmitEditing={submit} />
            <SubButton label="開く" onPress={submit} />
          </Row>
        </Stack>
      </Card>
    </Stack>
  );
}
