import { useEffect, useState } from 'react';
import { ShumitomoApp } from '../../app/App';
import { SettingsScreen } from '../../app/src/screens/Settings';
import { ConnectedSettingsScreen } from '../settings/ConnectedSettings';
import { getSupabase } from '../lib/supabase';
import { liveScreens } from '../live/screens';
import { SteamProfileSync } from '../local/SteamProfileSync';
import { SteamPreview } from '../local/SteamPreview';
import { ownSteamLibrary } from '../lib/own-steam';
import { useLocalIntegrations } from '../local/useLocalIntegrations';

function LocalSettings() {
  return <SettingsScreen accountPanel={<SteamPreview />} steamOnly />;
}
function SteamOnlyConnectedSettings() {
  return <ConnectedSettingsScreen steamOnly />;
}

function CloudSteamProfileSync() {
  return <SteamProfileSync readLibrary={ownSteamLibrary} />;
}

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
  if (configured && !account.ready) return null;
  // Only implemented DB screens replace their demo counterparts. A failed DB request
  // remains an error on the real screen; it must never look like a successful demo write.
  return <ShumitomoApp
    key={configured ? account.userId ?? 'guest' : 'local'}
    profileStorageKey={configured ? `shumitomo.profile.v1:${account.userId ?? 'guest'}` : undefined}
    integration={configured ? (account.userId ? CloudSteamProfileSync : undefined) : local ? SteamProfileSync : undefined}
    settingsScreen={configured ? (local ? SteamOnlyConnectedSettings : ConnectedSettingsScreen) : invalid ? ConnectedSettingsScreen : local ? LocalSettings : SettingsScreen}
    liveScreens={configured ? liveScreens : undefined}
    modeLabel={configured ? 'DB接続版' : local ? 'Steam実接続・ほかはデモ' : undefined}
  />;
}
