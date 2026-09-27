package id.armada.field;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

@CapacitorPlugin(
    name = "DutyLocation",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class DutyLocationPlugin extends Plugin {

    @Override
    public void load() {
        DutyLocationService.setListener(status -> notifyListeners("status", status.toJS()));
    }

    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            call.resolve(statusJS("granted"));
            return;
        }
        requestPermissionForAlias("location", call, "onEnsurePerm");
    }

    @PermissionCallback
    private void onEnsurePerm(PluginCall call) {
        boolean ok = getPermissionState("location") == PermissionState.GRANTED;
        if (!ok) {
            call.reject("Location permission is off — Dispatch cannot see your position");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "onEnsureNotif");
            return;
        }
        call.resolve(statusJS("granted"));
    }

    @PermissionCallback
    private void onEnsureNotif(PluginCall call) {
        call.resolve(statusJS("granted"));
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "onLocationPerm");
            return;
        }
        maybeAskNotificationsThenStart(call);
    }

    @PermissionCallback
    private void onLocationPerm(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission is off — Dispatch cannot see your position");
            return;
        }
        maybeAskNotificationsThenStart(call);
    }

    @PermissionCallback
    private void onNotifPerm(PluginCall call) {
        begin(call);
    }

    private void maybeAskNotificationsThenStart(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotifPerm");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        String origin = call.getString("origin", "");
        if (origin == null || origin.isEmpty()) {
            origin = getBridge().getWebView() != null ? uriOrigin(getBridge().getWebView().getUrl()) : "";
        }
        if (origin == null || origin.isEmpty()) {
            origin = "https://81.17.100.7:4173";
        }
        String jobId = call.getString("jobId");
        int intervalSec = Math.max(5, intOr(call.getInt("intervalSec"), 15));
        int quietSec = Math.max(intervalSec, intOr(call.getInt("quietSec"), 60));
        int minMoveM = Math.max(5, intOr(call.getInt("minMoveM"), 25));
        DutyLocationService.start(
            getContext(),
            origin,
            jobId,
            intervalSec * 1000L,
            quietSec * 1000L,
            (float) minMoveM
        );
        call.resolve(DutyLocationService.snapshot().toJS());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        DutyLocationService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void flush(PluginCall call) {
        DutyLocationService.flush(getContext());
        call.resolve(DutyLocationService.snapshot().toJS());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(DutyLocationService.snapshot().toJS());
    }

    private static int intOr(Integer value, int fallback) {
        return value != null ? value : fallback;
    }

    private static JSObject statusJS(String permission) {
        JSObject o = new JSObject();
        o.put("permission", permission);
        return o;
    }

    private static String uriOrigin(String url) {
        try {
            java.net.URI uri = new java.net.URI(url);
            int port = uri.getPort();
            String host = uri.getHost();
            if (host == null) return null;
            return uri.getScheme() + "://" + host + (port > 0 ? ":" + port : "");
        } catch (Exception e) {
            return null;
        }
    }
}
