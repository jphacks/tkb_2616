import { useEffect, useMemo, useState } from 'react';
import { ShumitomoApp } from '../../app/App';
import { SettingsScreen } from '../../app/src/screens/Settings';
import { ConnectedSettingsScreen } from '../settings/ConnectedSettings';
import { getSupabase } from '../lib/supabase';
import { liveScreens } from '../live/screens';
import { FriendConnectionsScreen } from '../live/friends-screen';
import { SteamProfileSync } from '../local/SteamProfileSync';
import { SteamPreview } from '../local/SteamPreview';
import { ownSteamLibrary } from '../lib/own-steam';
import { cloudGameCatalog, localGameCatalog } from '../lib/profile-game-catalog';
import { cloudProfileCovers, localProfileCovers } from '../lib/profile-covers';
import { useLocalIntegrations } from '../local/useLocalIntegrations';
import { cloudProfileRepository } from '../lib/profile-cloud-live';
import { LivePersonScreen, LiveSearchIdScreen } from '../live/profile-screens';

function LocalSettings() {
  return <SettingsScreen accountPanel={<SteamPreview />} steamOnly />;
}
function SteamOnlyConnectedSettings() {
  return <ConnectedSettingsScreen steamOnly />;
}

function CloudSteamProfileSync() {
  return <SteamProfileSync readLibrary={ownSteamLibrary} />;
}

// Enable the connected screen only after its migration has been applied.
// Local recording and tests always use the new screen; deploys without the new schema keep their current tab.
const connectedScreens = {
  ...(process.env.EXPO_PUBLIC_ENABLE_FRIEND_RECRUITMENT === 'true' ? liveScreens : { ...liveScreens, connections: undefined }),
  // Profiles open from a link or an app ID, signed in or not (profile-10, profile-13)
  person: LivePersonScreen,
  'search-id': LiveSearchIdScreen,
};

export default function Home() {
  const local = useLocalIntegrations();
  let configured = false;
  let invalid = false;
  try { configured = !!getSupabase(); } catch { invalid = true; }
  const [account, setAccount] = useState<{ ready: boolean; userId: string | null }>({ ready: false, userId: null });
  useEffect(() => {
    if (!configured) return;
    const client = getSupabase()!;
    const { data: { subscription } } = client.auth.onAuthStateChange((_, session) => {
      // No Supabase calls inside the Auth callback. The remounted profile owns its requests.
      setAccount({ ready: true, userId: session?.user && !session.user.is_anonymous ? session.user.id : null });
    });
    return () => subscription.unsubscribe();
  }, [configured]);
  // A signed-in account keeps its profile in the database; before sign-in it stays on this device
  const profileRepository = useMemo(
    () => (configured && account.userId ? cloudProfileRepository(getSupabase()!, account.userId) : undefined),
    [configured, account.userId],
  );
  if (configured && !account.ready) return null;
  // Only implemented DB screens replace their demo counterparts. A failed DB request
  // remains an error on the real screen; it must never look like a successful demo write.
  return <ShumitomoApp
    key={configured ? account.userId ?? 'guest' : 'local'}
    gameCatalog={configured ? cloudGameCatalog : local ? localGameCatalog : undefined}
    readProfileCovers={configured ? cloudProfileCovers : local ? localProfileCovers : undefined}
    profileStorageKey={configured ? `shumitomo.profile.v1:${account.userId ?? 'guest'}` : undefined}
    profileRepository={profileRepository}
    integration={configured ? (account.userId ? CloudSteamProfileSync : undefined) : local ? SteamProfileSync : undefined}
    settingsScreen={configured ? (local ? SteamOnlyConnectedSettings : ConnectedSettingsScreen) : invalid ? ConnectedSettingsScreen : local ? LocalSettings : SettingsScreen}
    liveScreens={configured ? connectedScreens : { connections: FriendConnectionsScreen }}
    modeLabel={configured ? 'DB接続版' : local ? 'Steam実接続・フレンド募集はローカル実演' : 'ローカル実演'}
  />;
}
