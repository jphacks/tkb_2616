import type { GameRow, Result } from './api';

export type FriendRecruitment = {
  id: string; owner_id: string; nickname: string; game_id: number; platform: string;
  skill: number; enthusiasm: number; available_from: string; available_to: string;
  created_at: string; closed_at: string | null; games?: GameRow | null;
};
export type FriendRequest = {
  id: string; recruitment_id: string; sender_id: string; recipient_id: string; nickname: string;
  status: 'pending' | 'accepted'; created_at: string; friend_recruitments?: FriendRecruitment | null;
};
export type FriendConnection = { peer_id: string; nickname: string; game_id: number; game_name: string; created_at: string };
export type FriendInput = { gameId: number; nickname: string; platform: string; skill: number; enthusiasm: number; availableFrom: string; availableTo: string };
export type FriendService = {
  list(): Promise<FriendRecruitment[]>;
  requests(): Promise<FriendRequest[]>;
  sent(): Promise<FriendRequest[]>;
  connections(): Promise<FriendConnection[]>;
  games(query: string): Promise<GameRow[]>;
  publish(opId: string, input: FriendInput): Promise<Result<{ recruitment_id: string }>>;
  apply(opId: string, recruitmentId: string, nickname: string): Promise<Result<{ request_id: string }>>;
  accept(opId: string, requestId: string): Promise<Result>;
  close(opId: string, recruitmentId: string): Promise<Result>;
  remove(opId: string, peerId: string): Promise<Result>;
  subscribe(reload: () => void): () => void;
};
