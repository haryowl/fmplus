package id.armada.field;

import android.app.Activity;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/** Read-only NFC. Field never writes tags. */
@CapacitorPlugin(name = "NfcScan")
public class NfcScanPlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private static final int READER_FLAGS =
        NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V;

    private boolean listening = false;

    @PluginMethod
    public void available(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        JSObject out = new JSObject();
        out.put("available", adapter != null);
        out.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(out);
    }

    @PluginMethod
    public void start(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("NFC is not ready");
            return;
        }
        activity.runOnUiThread(
            () -> {
                NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
                if (adapter == null) {
                    call.reject("This phone has no NFC");
                    return;
                }
                if (!adapter.isEnabled()) {
                    call.reject("Turn on NFC in Android settings");
                    return;
                }
                adapter.enableReaderMode(activity, this, READER_FLAGS, null);
                listening = true;
                call.resolve();
            }
        );
    }

    @PluginMethod
    public void stop(PluginCall call) {
        disableReader();
        call.resolve();
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        if (tag == null) return;
        String uid = bytesToHex(tag.getId());
        String ndef = readNdefText(tag);
        String code = !ndef.isEmpty() ? ndef : uid;
        if (code.isEmpty()) return;
        JSObject ev = new JSObject();
        ev.put("code", code);
        ev.put("uid", uid);
        ev.put("fromNdef", !ndef.isEmpty());
        notifyListeners("tag", ev);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        disableReaderQuiet();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (!listening) return;
        Activity activity = getActivity();
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (activity == null || adapter == null || !adapter.isEnabled()) return;
        activity.runOnUiThread(() -> adapter.enableReaderMode(activity, this, READER_FLAGS, null));
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        disableReaderQuiet();
        super.handleOnDestroy();
    }

    private void disableReader() {
        listening = false;
        disableReaderQuiet();
    }

    private void disableReaderQuiet() {
        Activity activity = getActivity();
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (activity == null || adapter == null) return;
        activity.runOnUiThread(() -> {
            try {
                adapter.disableReaderMode(activity);
            } catch (Exception ignored) {
                /* adapter already gone */
            }
        });
    }

    private static String readNdefText(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return "";
        try {
            ndef.connect();
            NdefMessage message = ndef.getNdefMessage();
            if (message == null) return "";
            for (NdefRecord rec : message.getRecords()) {
                String text = recordToText(rec);
                if (!text.isEmpty()) return text;
            }
        } catch (Exception ignored) {
            return "";
        } finally {
            try {
                ndef.close();
            } catch (Exception ignored) {
                /* ignore */
            }
        }
        return "";
    }

    private static String recordToText(NdefRecord rec) {
        if (rec == null) return "";
        byte[] payload = rec.getPayload();
        if (payload == null || payload.length == 0) return "";
        short tnf = rec.getTnf();
        byte[] type = rec.getType();
        if (tnf == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(type, NdefRecord.RTD_TEXT)) {
            return decodeText(payload);
        }
        if (tnf == NdefRecord.TNF_WELL_KNOWN && java.util.Arrays.equals(type, NdefRecord.RTD_URI)) {
            return decodeUri(payload);
        }
        if (tnf == NdefRecord.TNF_ABSOLUTE_URI) {
            return new String(payload, StandardCharsets.UTF_8).trim();
        }
        String raw = new String(payload, StandardCharsets.UTF_8).trim();
        if (raw.regionMatches(true, 0, "am1:", 0, 4)) return raw;
        return "";
    }

    private static String decodeText(byte[] payload) {
        if (payload.length < 2) return "";
        int status = payload[0] & 0xff;
        int langLen = status & 0x3f;
        boolean utf16 = (status & 0x80) != 0;
        int start = 1 + langLen;
        if (start > payload.length) return "";
        Charset cs = utf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8;
        return new String(payload, start, payload.length - start, cs).trim();
    }

    private static String decodeUri(byte[] payload) {
        if (payload.length < 1) return "";
        String prefix = uriPrefix(payload[0] & 0xff);
        return (prefix + new String(payload, 1, payload.length - 1, StandardCharsets.UTF_8)).trim();
    }

    private static String uriPrefix(int code) {
        switch (code) {
            case 0x01:
                return "http://www.";
            case 0x02:
                return "https://www.";
            case 0x03:
                return "http://";
            case 0x04:
                return "https://";
            default:
                return "";
        }
    }

    private static String bytesToHex(byte[] id) {
        if (id == null || id.length == 0) return "";
        StringBuilder sb = new StringBuilder(id.length * 2);
        for (byte b : id) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
