This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

This repository uses npm and `package-lock.json`. Paths and commands below are relative to the repository root, not the `app/` directory. The root project runs the connected app; `app/` also has a standalone demo entry point.

```bash
npm run setup               # install root and integration dependencies when needed
npm run web                 # start the root web development server
npm run typecheck           # root and stricter auth typechecks
npm run typecheck:frontend  # shared frontend typecheck
npm run check               # typechecks, tests, Edge checks, and web export
npm run build:native        # export iOS/Android bundles when relevant
```

Use `npx expo install <package>` for Expo/React Native dependencies so versions match the installed SDK. Check which project owns the dependency before changing a package file.

Use the repository's checks for code changes. There is currently no configured lint script or ESLint configuration; do not report lint as passing unless it was actually configured and run. Markdown-only changes should be checked for valid references, consistency with the code, and `git diff --check`.

## Navigation & Routing

- The root Expo Router routes live in `src/app/`, including the auth callbacks and `_layout.tsx`. Keep non-route modules outside this directory and use Expo Router APIs for these routes.
- `src/app/index.tsx` renders `ShumitomoApp` from `app/App.tsx`. The top-level `app/` directory is the shared frontend and standalone demo project; it is not the root project's Router route directory.
- Main screens live in `app/src/screens/`. Their existing navigation uses `go`, `resolveRoute`, and route state in `app/src/store.tsx`; on Web this is synchronized with the URL hash. Use that navigation for the existing screens and preserve its behavior unless a routing migration is explicitly requested.
- Docs for Router-managed routes: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
