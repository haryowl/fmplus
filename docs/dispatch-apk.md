# ARMADA Dispatch APK

Sideload Android app for desk **Jobs** and **Dispatch Live**. Separate from the Field APK (`id.armada.field`). Uses the same live desk host over a WebView; no duty GPS, NFC, or offline outbox.

The Field APK and [`capacitor.config.ts`](../capacitor.config.ts) are unchanged.

## Build

Needs **JDK 21** and the **Android SDK**.

```bash
# Optional: override the desk host baked into the WebView
# FIELD_APP_URL=https://81.17.100.7:4173

npm run apk:dispatch:sync
npm run apk:dispatch:debug
```

APK path:

`android-dispatch/app/build/outputs/apk/debug/app-debug.apk`

`FIELD_APP_URL` is read at sync time. Re-sync after changing it.

## On the phone

1. Install **ARMADA Dispatch** (package `id.armada.dispatch`).
2. First open: enter the desk embed tenant key (`k=` from the Jobs URL). Optional `appId` / `userId` / `groupId` match embed filters. The key is stored on the device only.
3. Use **Jobs** and **Dispatch Live** from the top nav (other desk modules are hidden in this APK).
4. On a phone-width screen, Jobs shows **Inbox | Map | Job** tabs. While creating or editing an order, **Pin map** opens a bottom sheet so you can drop a pin without scrolling past the whole inbox.

## Not in this APK

Field login, duty location sharing, NFC read/write plugins, offline outbox, Play Store listing, and iOS.
