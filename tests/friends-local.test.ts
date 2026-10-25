import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalFriendService } from '../src/live/friends-local.ts';
import type { FriendLocalStorage } from '../src/live/friends-local.ts';

const game = { id:-101,name:'ゲームA',alternative_names:[],cover_image_id:null,hide_cover:false,platforms:['PC'],modes:null,needs_participant_id_default:false };
const input = { gameId:-101,nickname:'ゆう',platform:'PC',skill:6,enthusiasm:3,availableFrom:'21:00',availableTo:'24:00' };
function memory() { let raw:string|null=null; const subs=new Set<()=>void>(); return { read:()=>raw,write:(s:string)=>{raw=s;subs.forEach(fn=>fn());},subscribe:(fn:()=>void)=>{subs.add(fn);return()=>{subs.delete(fn);};} } satisfies FriendLocalStorage; }

test('local filming users publish, apply and accept; both connections survive reopening',async()=>{
  const storage=memory();const owner=createLocalFriendService('local-yuu',storage,[game]);const applicant=createLocalFriendService('local-sora',storage,[game]);const third=createLocalFriendService('local-mei',storage,[game]);
  const published=await owner.publish('publish',input);assert.equal(published.ok,true);if(!published.ok)return;
  assert.equal((await applicant.list())[0]?.skill,6);
  const applied=await applicant.apply('apply',published.recruitment_id,'ゆう');assert.equal(applied.ok,true);if(!applied.ok)return;
  assert.equal((await owner.requests())[0]?.nickname,'そら');
  assert.equal((await owner.requests())[0]?.friend_recruitments?.games?.name,'ゲームA');
  assert.deepEqual(await third.requests(),[]);assert.deepEqual(await third.connections(),[]);
  assert.deepEqual(await third.accept('unauthorized',applied.request_id),{ok:false,reason:'not_recipient'});
  assert.equal((await owner.accept('accept',applied.request_id)).ok,true);
  assert.equal((await owner.connections())[0]?.nickname,'そら');
  assert.equal((await applicant.connections())[0]?.nickname,'ゆう');
  assert.equal((await createLocalFriendService('local-sora',storage,[game]).connections())[0]?.peer_id,'local-yuu');
  assert.deepEqual(await owner.remove('self-remove','local-yuu'),{ok:false,reason:'invalid_input'});
  assert.equal((await owner.connections()).length,1);
  await owner.remove('remove','local-sora');
  await owner.accept('accept',applied.request_id);
  await owner.accept('new-accept',applied.request_id);
  assert.deepEqual(await owner.connections(),[]);assert.deepEqual(await applicant.connections(),[]);
});

test('local demo does not claim success without storage, and prevents self/closed requests',async()=>{
  const storage=memory();const owner=createLocalFriendService('local-yuu',storage,[game]);const applicant=createLocalFriendService('local-sora',storage,[game]);
  const published=await owner.publish('a',input);assert.ok(published.ok);if(!published.ok)return;
  assert.deepEqual(await owner.apply('self',published.recruitment_id,'ゆう'),{ok:false,reason:'own_recruitment'});
  const a=await applicant.apply('one',published.recruitment_id,'そら');const b=await applicant.apply('two',published.recruitment_id,'そら');assert.deepEqual(a,b);assert.equal((await owner.requests()).length,1);
  await owner.close('close',published.recruitment_id);
  assert.deepEqual(await applicant.apply('closed',published.recruitment_id,'そら'),{ok:false,reason:'not_accepting'});
  if(a.ok)assert.equal((await owner.accept('accept',a.request_id)).ok,true);
  const blocked=createLocalFriendService('local-yuu',{...memory(),write:()=>{throw new Error('blocked');}},[game]);
  await assert.rejects(blocked.publish('p',input),/blocked/);
  assert.deepEqual(await owner.publish('a',{...input,skill:4}),{ok:false,reason:'operation_conflict'});
});
