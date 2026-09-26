package id.armada.field;

import android.Manifest;
import android.os.Build;
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
        DutyLocationService.start(getContext(), origin, jobId);
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
