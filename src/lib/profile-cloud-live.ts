// Connects the database profile repository to this app's Supabase client and device storage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveGame } from './games';
import { createCloudProfileRepository } from './profile-cloud';

export const cloudProfileRepository = (client: SupabaseClient, userId: string) => createCloudProfileRepository(userId, {
  rpc: (name, args) => client.rpc(name, args),
  storage: AsyncStorage,
  saveGame,
  newOpId: () => Crypto.randomUUID(),
});
