// One-time IGDB API lookup for the games in the current profile (2026-10-25).
// Keys are Steam titles; IGDB calls "Slay the Spire 2" "Slay the Spire II".
// The exact PC title was checked. Demo/playtest editions without their own match stay absent.
// Only public metadata is stored. Image bytes and API credentials are not bundled.
export type ProfileCover = { id: number; name: string; slug: string; imageId: string; fetchedAt: string };
export const PROFILE_IGDB_COVERS: Readonly<Record<string, ProfileCover>> = {
  "Cuphead": {
    "id": 9061,
    "name": "Cuphead",
    "slug": "cuphead",
    "imageId": "co62ao",
    "fetchedAt": "2026-10-25T03:58:46.279Z"
  },
  "RPG Maker MV": {
    "id": 24624,
    "name": "RPG Maker MV",
    "slug": "rpg-maker-mv",
    "imageId": "co86ih",
    "fetchedAt": "2026-10-25T03:58:48.869Z"
  },
  "Overcooked! 2": {
    "id": 103341,
    "name": "Overcooked! 2",
    "slug": "overcooked-2",
    "imageId": "coasbb",
    "fetchedAt": "2026-10-25T03:58:51.274Z"
  },
  "A Dance of Fire and Ice": {
    "id": 114392,
    "name": "A Dance of Fire and Ice",
    "slug": "a-dance-of-fire-and-ice",
    "imageId": "co20u0",
    "fetchedAt": "2026-10-25T03:58:53.711Z"
  },
  "Peglin": {
    "id": 133512,
    "name": "Peglin",
    "slug": "peglin",
    "imageId": "co4oot",
    "fetchedAt": "2026-10-25T03:58:56.122Z"
  },
  "Cookie Clicker": {
    "id": 3241,
    "name": "Cookie Clicker",
    "slug": "cookie-clicker",
    "imageId": "co8e5m",
    "fetchedAt": "2026-10-25T03:58:58.535Z"
  },
  "Die in the Dungeon": {
    "id": 147285,
    "name": "Die in the Dungeon",
    "slug": "die-in-the-dungeon",
    "imageId": "coc08t",
    "fetchedAt": "2026-10-25T03:59:01.290Z"
  },
  "Dungeon Clawler": {
    "id": 290897,
    "name": "Dungeon Clawler",
    "slug": "dungeon-clawler",
    "imageId": "co7ygu",
    "fetchedAt": "2026-10-25T03:59:03.918Z"
  },
  "Balatro": {
    "id": 251833,
    "name": "Balatro",
    "slug": "balatro",
    "imageId": "co9f4g",
    "fetchedAt": "2026-10-25T03:59:06.721Z"
  },
  "Backpack Battles": {
    "id": 253659,
    "name": "Backpack Battles",
    "slug": "backpack-battles",
    "imageId": "coaaw3",
    "fetchedAt": "2026-10-25T03:59:09.306Z"
  },
  "Megaloot": {
    "id": 274998,
    "name": "Megaloot",
    "slug": "megaloot",
    "imageId": "co7u6b",
    "fetchedAt": "2026-10-25T03:59:11.782Z"
  },
  "9 Kings": {
    "id": 288741,
    "name": "9 Kings",
    "slug": "9-kings",
    "imageId": "coab5q",
    "fetchedAt": "2026-10-25T03:59:16.580Z"
  },
  "Slay the Spire 2": {
    "id": 296831,
    "name": "Slay the Spire II",
    "slug": "slay-the-spire-ii",
    "imageId": "cocle0",
    "fetchedAt": "2026-10-25T03:59:19.062Z"
  },
  "Magical Girl Witch Trials": {
    "id": 324791,
    "name": "Magical Girl Witch Trials",
    "slug": "magical-girl-witch-trials",
    "imageId": "cobp62",
    "fetchedAt": "2026-10-25T03:59:21.550Z"
  },
  "Grail": {
    "id": 364214,
    "name": "Grail",
    "slug": "grail",
    "imageId": "cobxg2",
    "fetchedAt": "2026-10-25T03:59:27.672Z"
  }
};

export function profileCover(name: string) {
  const cover = Object.hasOwn(PROFILE_IGDB_COVERS, name) ? PROFILE_IGDB_COVERS[name] : undefined;
  return cover ? { ...cover, imageUrl: `https://images.igdb.com/igdb/image/upload/t_cover_big/${cover.imageId}.jpg`, sourceUrl: `https://www.igdb.com/games/${cover.slug}` } : null;
}
