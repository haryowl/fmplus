# ARMADA Dispatch APK

Sideload Android app for desk **Jobs** and **Dispatch Live**. Separate from the Field APK (`id.armada.field`). Uses the same live desk host over a WebView.

The Field APK and [`capacitor.config.ts`](../capacitor.config.ts) are unchanged.

## Capabilities

- Jobs + Dispatch Live (other desk modules are hidden)
- **NFC write** for catalog goods / location / vehicle payloads (same `am1:v1:…` text Field scans)
- **NFC read** + **camera barcode/QR** when scanning into orders or location fields
- **Print QR / barcode** via an in-app label sheet → Android print / Save as PDF

No duty GPS, Field login, or offline outbox.

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

**Rebuild the APK** after changing native plugins or permissions (NFC / camera). Pure web CSS/JS still only needs a desk deploy.

## On the phone

1. Install **ARMADA Dispatch** (package `id.armada.dispatch`).
2. First open: enter the desk embed tenant key (`k=` from the Jobs URL). Optional `appId` / `userId` / `groupId` match embed filters. The key is stored on the device only.
3. Allow **NFC** and **Camera** when prompted (App info → Permissions).
4. Use **Jobs** and **Dispatch Live** from the top nav.
5. Goods catalog / Codes: **Write NFC** or **Print QR / barcode**. Order goods and location fields: **Scan** (camera) or tap NFC when on the Dispatch APK.
6. On a phone-width screen, Jobs shows **Inbox | Map | Job** tabs. While creating or editing an order, **Pin map** opens a bottom sheet so you can drop a pin without scrolling past the whole inbox.

## Not in this APK

Field login, duty location sharing, offline outbox, Play Store listing, and iOS. Field still never writes NFC tags.
