import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { getSupabase } from '../lib/supabase';
import { saveGame, searchGames } from '../lib/games';
import { GAMES } from '../../app/src/data';
import { readItem, writeItem } from '../../app/src/deviceStorage';
import { newOpId, type Failure, type GameRow, type Result } from './api';
import { createLocalFriendService, FRIEND_LOCAL_KEY } from './friends-local';
import type { FriendConnection, FriendRecruitment, FriendRequest, FriendService } from './friends-types';
export type { FriendConnection, FriendInput, FriendRecruitment, FriendRequest, FriendService } from './friends-types';

const LOCAL_TAGS = Object.keys(GAMES).filter(tag => !tag.includes(':'));
const LOCAL_GAMES: GameRow[] = LOCAL_TAGS.map((tag,i) => ({ id: -101-i, name: GAMES[tag].name, alternative_names: [], cover_image_id: null, hide_cover: false, platforms: [], modes: null, needs_participant_id_default: false }));
function localUserId() {
  const name = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('friendDemoUser') : null;
  return `local-${name === 'sora' || name === 'mei' ? name : 'yuu'}`;
}
export function currentFriendUserId(): string | null {
  try { return getSupabase() ? null : localUserId(); } catch { return null; }
}
export function useFriendUser(): string | null | undefined {
  const [id,setId] = useState<string|null|undefined>(() => { try { return getSupabase() ? undefined : localUserId(); } catch { return null; } });
  useEffect(() => {
    let client; try { client=getSupabase(); } catch { setId(null); return; }
    if (!client) return;
    let active=true;
    void client.auth.getSession().then(({data,error}) => { if(active) setId(!error && data.session?.user && !data.session.user.is_anonymous ? data.session.user.id : null); });
    const {data}=client.auth.onAuthStateChange((_event,session) => { if(active) setId(session?.user && !session.user.is_anonymous ? session.user.id : null); });
    return () => { active=false; data.subscription.unsubscribe(); };
  },[]);
  return id;
}
export function friendGameRoute(gameId:number):string {
  return LOCAL_TAGS[-101-gameId] ?? String(gameId);
}
function dataOf<T>({data,error}:{data:unknown;error:unknown}):T {
  if(error) throw new Error('フレンド募集を読み込めませんでした');
  return data as T;
}
export function createFriendService(userId:string|null):FriendService {
  let client;
  try { client=getSupabase(); } catch {
    const unavailable=async():Promise<never>=>{throw new Error('接続設定を確認してください');};
    return {list:unavailable,requests:unavailable,sent:unavailable,connections:unavailable,games:unavailable,publish:unavailable,apply:unavailable,accept:unavailable,close:unavailable,remove:unavailable,subscribe:()=>()=>{}};
  }
  if(!client) return createLocalFriendService(userId,{
    read:()=>readItem(FRIEND_LOCAL_KEY),
    write:value=>{ if(!writeItem(FRIEND_LOCAL_KEY,value)) throw new Error('この端末に保存できませんでした'); if(Platform.OS==='web') window.dispatchEvent(new Event('shumitomo:friends')); },
    subscribe:reload=>{
      if(Platform.OS!=='web') { const s=AppState.addEventListener('change',v=>{if(v==='active')reload();});return()=>s.remove(); }
      const storage=(e:StorageEvent)=>{if(e.key===FRIEND_LOCAL_KEY)reload();};
      window.addEventListener('storage',storage);window.addEventListener('shumitomo:friends',reload);window.addEventListener('focus',reload);
      return()=>{window.removeEventListener('storage',storage);window.removeEventListener('shumitomo:friends',reload);window.removeEventListener('focus',reload);};
    },
  },LOCAL_GAMES);
  async function call<T extends object>(name:string,opId:string,args:Record<string,unknown>):Promise<Result<T>> {
    if(!userId) return {ok:false,reason:'login_required'};
    const {data,error,status}=await client!.rpc(name,{p_op_id:opId,...args});
    if(error){ if(status===401||status===403||error.code==='42501')return {ok:false,reason:'login_required'}; throw new Error('保存できませんでした。もう一度お試しください'); }
    return data as Result<T>;
  }
  return {
    list:async()=>dataOf<FriendRecruitment[]>(await client.from('friend_recruitments').select('*, games(*)').order('created_at',{ascending:false})),
    requests:async()=>userId?dataOf<FriendRequest[]>(await client.from('friend_requests').select('*, friend_recruitments(*,games(*))').eq('recipient_id',userId).order('created_at',{ascending:false})):[],
    sent:async()=>userId?dataOf<FriendRequest[]>(await client.from('friend_requests').select('*, friend_recruitments(*,games(*))').eq('sender_id',userId).order('created_at',{ascending:false})):[],
    connections:async()=>userId?dataOf<FriendConnection[]>(await client.rpc('friend_connections')):[],
    games:async query=>{
      const saved=dataOf<GameRow[]>(await client.from('games').select('*').ilike('name',`%${query.trim()}%`).order('name').limit(12));
      if(!query.trim()||saved.length)return saved;
      const remote=await searchGames(query.trim(),8);
      return remote.games.map(g=>({id:g.id,name:g.name,alternative_names:[],cover_image_id:null,hide_cover:false,platforms:g.platforms.map(p=>p.name),modes:null,needs_participant_id_default:null}));
    },
    publish:async(opId,input)=>{
      if(!userId)return {ok:false,reason:'login_required'};
      const saved=await client.from('games').select('id').eq('id',input.gameId).maybeSingle();
      if(saved.error)throw new Error('ゲームを確認できませんでした');
      if(!saved.data)await saveGame(input.gameId);
      return call('publish_friend_recruitment',opId,{p_game_id:input.gameId,p_nickname:input.nickname,p_platform:input.platform,p_skill:input.skill,p_enthusiasm:input.enthusiasm,p_available_from:input.availableFrom,p_available_to:input.availableTo});
    },
    apply:(opId,id,nickname)=>call('request_friendship',opId,{p_recruitment_id:id,p_nickname:nickname}),
    accept:(opId,id)=>call('accept_friend_request',opId,{p_request_id:id}),
    close:(opId,id)=>call('close_friend_recruitment',opId,{p_recruitment_id:id}),
    remove:(opId,id)=>call('remove_friendship',opId,{p_peer_id:id}),
    subscribe:reload=>{
      const channel=client.channel(`friends-${newOpId()}`);
      for(const table of ['friend_recruitments','friend_requests','friendships'])channel.on('postgres_changes',{event:'*',schema:'public',table},reload);
      channel.subscribe(status=>{if(status==='SUBSCRIBED')reload();});
      const sub=AppState.addEventListener('change',v=>{if(v==='active')reload();});
      if(Platform.OS==='web')window.addEventListener('focus',reload);
      return()=>{void client.removeChannel(channel);sub.remove();if(Platform.OS==='web')window.removeEventListener('focus',reload);};
    },
  };
}
export function friendFailureText(f:Failure):string {
  return ({login_required:'ログインしてください',invalid_input:'名前・ゲーム・条件を確認してください',unknown_game:'ゲームを選び直してください',own_recruitment:'自分の募集には申請できません',not_owner:'募集した人だけができる操作です',not_recipient:'申請を受けた人だけが承認できます',not_accepting:'この募集は受付を終了しています',already_friends:'すでにフレンドです',not_found:'対象が見つかりません。読み直してください',operation_conflict:'操作の内容を確認して、もう一度お試しください'} as Record<string,string>)[f.reason]??'操作できませんでした。読み直してください';
}
