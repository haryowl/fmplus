# ARMADA Field APK

Sideload Android app for Field `/m`. Same login, Dispatch + Maintenance tabs. While a job is in progress and the driver has opted in, a native foreground service keeps sending GPS with the screen off or another app open.

The browser PWA is unchanged. Swiping the app away or force-stopping it still stops sharing.

## Build

Needs **JDK 21** and the **Android SDK** (Android Studio is the usual install).

```bash
# Optional: override the live Field host baked into the WebView
# FIELD_APP_URL=https://81.17.100.7:4173

npm run apk:sync
npm run apk:debug
```

APK path:

`android/app/build/outputs/apk/debug/app-debug.apk`

Install on a phone (`adb install -r` or copy the file). Allow **Location** and **Notifications** when the driver starts a route.

`FIELD_APP_URL` is read at `apk:sync` time. Re-sync after changing it.

## On the phone

1. Open **ARMADA Field** and sign in as usual (`/m`).
2. Enable **Share my location while on duty**.
3. Start a route. A notification stays up: “Sharing location with Dispatch”.
4. Lock the screen or switch apps — Dispatch Live should keep receiving pings.

If GPS dies on Xiaomi / Oppo / Vivo after a few minutes, exempt **ARMADA Field** from battery optimisation (Settings → Apps → ARMADA Field → Battery → Unrestricted).

The current server uses a private HTTPS cert on `81.17.100.7`. The APK trusts that host only.

## Not in this APK

Play Store listing, iOS, tracking when no job is in progress, and push notifications for new jobs.
