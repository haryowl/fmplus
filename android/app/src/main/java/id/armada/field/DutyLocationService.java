package id.armada.field;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Foreground GPS while the driver is on duty. Survives screen-off and leaving the
 * Field UI; stops if the user force-stops or swipes the app away.
 */
public class DutyLocationService extends Service implements LocationListener {

    static final String ACTION_START = "id.armada.field.duty.START";
    static final String ACTION_STOP = "id.armada.field.duty.STOP";
    static final String ACTION_FLUSH = "id.armada.field.duty.FLUSH";
    static final String EXTRA_JOB_ID = "jobId";
    static final String EXTRA_ORIGIN = "origin";

    private static final String CHANNEL_ID = "duty_location";
    private static final int NOTIF_ID = 4103;
    private static final float MIN_MOVE_M = 25f;
    private static final long MAX_QUIET_MS = 60_000L;
    private static final long MIN_INTERVAL_MS = 15_000L;
    private static final float MAX_ACCURACY_M = 2000f;

    private static final Object LOCK = new Object();
    private static final DutyStatus STATUS = new DutyStatus();
    private static StatusListener listener;

    interface StatusListener {
        void onStatus(DutyStatus status);
    }

    static void setListener(StatusListener next) {
        listener = next;
    }

    static DutyStatus snapshot() {
        synchronized (LOCK) {
            DutyStatus copy = new DutyStatus();
            copy.active = STATUS.active;
            copy.lastFixAt = STATUS.lastFixAt;
            copy.lastSentAt = STATUS.lastSentAt;
            copy.queued = STATUS.queued;
            copy.error = STATUS.error;
            copy.permission = STATUS.permission;
            return copy;
        }
    }

    static void start(Context context, String origin, String jobId) {
        Intent intent = new Intent(context, DutyLocationService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_ORIGIN, origin);
        intent.putExtra(EXTRA_JOB_ID, jobId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    static void stop(Context context) {
        Intent intent = new Intent(context, DutyLocationService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    static void flush(Context context) {
        Intent intent = new Intent(context, DutyLocationService.class);
        intent.setAction(ACTION_FLUSH);
        context.startService(intent);
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private DutyLocationQueue queue;
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private String origin;
    private String jobId;
    private Location lastKept;
    private boolean listening;

    @Override
    public void onCreate() {
        super.onCreate();
        queue = new DutyLocationQueue(this);
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "armada.field:duty");
            wakeLock.setReferenceCounted(false);
        }
        createChannel();
        syncQueued();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_STOP.equals(action)) {
            executor.execute(() -> {
                flushQueue();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            });
            return START_NOT_STICKY;
        }
        if (intent != null) {
            if (intent.hasExtra(EXTRA_ORIGIN)) {
                String next = intent.getStringExtra(EXTRA_ORIGIN);
                if (next != null && !next.isEmpty()) origin = next;
            }
            if (intent.hasExtra(EXTRA_JOB_ID)) {
                jobId = intent.getStringExtra(EXTRA_JOB_ID);
            }
        }
        if (origin == null || origin.isEmpty()) {
            origin = "https://81.17.100.7:4173";
        }
        startInForeground();
        acquireWake();
        ensureListening();
        patchStatus(s -> {
            s.active = true;
            s.permission = "granted";
            s.error = null;
        });
        if (ACTION_FLUSH.equals(action) || ACTION_START.equals(action)) {
            executor.execute(this::flushQueue);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        stopListening();
        releaseWake();
        unregisterNetwork();
        executor.shutdownNow();
        patchStatus(s -> {
            s.active = false;
        });
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onLocationChanged(@NonNull Location location) {
        if (!shouldKeep(location)) return;
        lastKept = location;
        JSONObject ping = new JSONObject();
        try {
            ping.put("lat", location.getLatitude());
            ping.put("lon", location.getLongitude());
            ping.put("accuracyM", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            ping.put("speedMps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
            ping.put("headingDeg", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            ping.put("recordedAt", iso(location.getTime() > 0 ? location.getTime() : System.currentTimeMillis()));
            ping.put("jobId", jobId == null || jobId.isEmpty() ? JSONObject.NULL : jobId);
        } catch (Exception e) {
            return;
        }
        executor.execute(() -> {
            queue.enqueue(ping);
            patchStatus(s -> {
                s.lastFixAt = iso(location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());
                s.queued = queue.count();
                s.error = null;
            });
            flushQueue();
        });
    }

    private boolean shouldKeep(Location next) {
        if (next == null) return false;
        if (next.hasAccuracy() && next.getAccuracy() > MAX_ACCURACY_M) return false;
        if (lastKept == null) return true;
        long elapsed = next.getTime() - lastKept.getTime();
        if (elapsed < 0) elapsed = System.currentTimeMillis() - lastKept.getTime();
        if (elapsed >= MAX_QUIET_MS) return true;
        if (elapsed < MIN_INTERVAL_MS) return false;
        return next.distanceTo(lastKept) >= MIN_MOVE_M;
    }

    private void flushQueue() {
        if (origin == null || origin.isEmpty()) return;
        try {
            for (;;) {
                List<DutyLocationQueue.Row> rows = queue.peek(DutyLocationQueue.MAX_BATCH);
                if (rows.isEmpty()) {
                    patchStatus(s -> s.queued = 0);
                    return;
                }
                List<JSONObject> pings = new ArrayList<>();
                List<Long> ids = new ArrayList<>();
                for (DutyLocationQueue.Row row : rows) {
                    pings.add(row.ping);
                    ids.add(row.id);
                }
                DutyHttp.Result result = DutyHttp.postPings(origin, pings);
                if (result.retry) {
                    patchStatus(s -> {
                        s.queued = queue.count();
                        s.error = "Waiting to send location";
                    });
                    return;
                }
                if (result.code == 401 || result.code == 403) {
                    patchStatus(s -> {
                        s.queued = queue.count();
                        s.error = "Session expired — sign in again to keep sharing location";
                    });
                    return;
                }
                queue.delete(ids);
                patchStatus(s -> {
                    s.queued = queue.count();
                    if (result.code >= 200 && result.code < 300) {
                        s.lastSentAt = iso(System.currentTimeMillis());
                        s.error = null;
                    }
                });
            }
        } catch (Exception e) {
            patchStatus(s -> {
                s.queued = queue.count();
                s.error = "No connection — queued positions will send later";
            });
        }
    }

    private void ensureListening() {
        if (listening || locationManager == null) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, 0f, this, Looper.getMainLooper());
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, MIN_INTERVAL_MS, 0f, this, Looper.getMainLooper());
            }
            listening = true;
            watchNetwork();
        } catch (SecurityException e) {
            patchStatus(s -> {
                s.permission = "denied";
                s.error = "Location permission is off — Dispatch cannot see your position";
                s.active = false;
            });
            stopSelf();
        }
    }

    private void stopListening() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception ignored) {}
        }
        listening = false;
    }

    private void watchNetwork() {
        if (networkCallback != null) return;
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (connectivity == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                executor.execute(() -> flushQueue());
            }
        };
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception ignored) {
            networkCallback = null;
        }
    }

    private void unregisterNetwork() {
        if (connectivity != null && networkCallback != null) {
            try {
                connectivity.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
        networkCallback = null;
    }

    private void startInForeground() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(
            this,
            0,
            launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.duty_location_title))
            .setContentText(getString(R.string.duty_location_text))
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setContentIntent(pending)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, notification);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.duty_location_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.duty_location_text));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void acquireWake() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseWake() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
    }

    private void syncQueued() {
        patchStatus(s -> s.queued = queue.count());
    }

    private interface Mutate {
        void apply(DutyStatus status);
    }

    private void patchStatus(Mutate mutate) {
        DutyStatus copy;
        synchronized (LOCK) {
            mutate.apply(STATUS);
            copy = snapshot();
        }
        StatusListener sink = listener;
        if (sink != null) sink.onStatus(copy);
    }

    private static String iso(long at) {
        java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            java.util.Locale.US
        );
        fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return fmt.format(new java.util.Date(at));
    }
}
