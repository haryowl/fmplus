package id.armada.field;

import com.getcapacitor.JSObject;

final class DutyStatus {

    boolean active;
    String lastFixAt;
    String lastSentAt;
    int queued;
    String error;
    String permission = "unknown";

    JSObject toJS() {
        JSObject o = new JSObject();
        o.put("active", active);
        o.put("lastFixAt", lastFixAt);
        o.put("lastSentAt", lastSentAt);
        o.put("queued", queued);
        o.put("error", error);
        o.put("permission", permission);
        return o;
    }
}
