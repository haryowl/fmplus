package id.armada.dispatch;

import android.app.Activity;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;

/**
 * Desk NFC write for Dispatch APK. Waits for one tag, writes a single NDEF Text record, then stops.
 */
@CapacitorPlugin(name = "NfcWrite")
public class NfcWritePlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private static final int READER_FLAGS =
        NfcAdapter.FLAG_READER_NFC_A
            | NfcAdapter.FLAG_READER_NFC_B
            | NfcAdapter.FLAG_READER_NFC_F
            | NfcAdapter.FLAG_READER_NFC_V
            | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

    private PluginCall pendingWrite;
    private String pendingText = "";

    @PluginMethod
    public void available(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        JSObject out = new JSObject();
        out.put("available", adapter != null);
        out.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(out);
    }

    @PluginMethod
    public void write(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null) text = "";
        text = text.trim();
        if (text.isEmpty()) {
            call.reject("SKU is required to write a tag");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("NFC is not ready");
            return;
        }

        cancelPendingQuiet();
        pendingText = text;
        pendingWrite = call;
        call.setKeepAlive(true);

        final String payload = text;
        activity.runOnUiThread(
            () -> {
                NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
                if (adapter == null) {
                    failPending("This phone has no NFC");
                    return;
                }
                if (!adapter.isEnabled()) {
                    failPending("Turn on NFC in Android settings");
                    return;
                }
                adapter.enableReaderMode(activity, this, READER_FLAGS, null);
            }
        );
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelPendingQuiet();
        call.resolve();
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        PluginCall call = pendingWrite;
        String text = pendingText;
        if (call == null || text.isEmpty() || tag == null) return;

        try {
            NdefMessage message = new NdefMessage(new NdefRecord[] { createTextRecord(text) });
            writeMessage(tag, message);
            pendingWrite = null;
            pendingText = "";
            disableReaderQuiet();
            JSObject out = new JSObject();
            out.put("ok", true);
            call.resolve(out);
        } catch (Exception err) {
            String msg = err.getMessage() != null ? err.getMessage() : "Could not write the tag";
            failPending(msg);
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // Keep pending write across brief pauses; only disable reader quietly.
        disableReaderQuiet();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingWrite == null || pendingText.isEmpty()) return;
        Activity activity = getActivity();
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (activity == null || adapter == null || !adapter.isEnabled()) return;
        activity.runOnUiThread(() -> adapter.enableReaderMode(activity, this, READER_FLAGS, null));
    }

    @Override
    protected void handleOnDestroy() {
        cancelPendingQuiet();
        super.handleOnDestroy();
    }

    private void failPending(String message) {
        PluginCall call = pendingWrite;
        pendingWrite = null;
        pendingText = "";
        disableReaderQuiet();
        if (call != null) call.reject(message);
    }

    private void cancelPendingQuiet() {
        PluginCall call = pendingWrite;
        pendingWrite = null;
        pendingText = "";
        disableReaderQuiet();
        if (call != null) {
            call.reject("NFC write cancelled");
        }
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

    private static void writeMessage(Tag tag, NdefMessage message) throws Exception {
        Ndef ndef = Ndef.get(tag);
        if (ndef != null) {
            ndef.connect();
            try {
                if (!ndef.isWritable()) {
                    throw new Exception("This tag is locked (not writable)");
                }
                int size = message.toByteArray().length;
                if (ndef.getMaxSize() < size) {
                    throw new Exception("Tag is too small for this payload");
                }
                ndef.writeNdefMessage(message);
            } finally {
                try {
                    ndef.close();
                } catch (Exception ignored) {
                    /* ignore */
                }
            }
            return;
        }

        NdefFormatable formatable = NdefFormatable.get(tag);
        if (formatable == null) {
            throw new Exception("This tag does not support NDEF");
        }
        formatable.connect();
        try {
            formatable.format(message);
        } finally {
            try {
                formatable.close();
            } catch (Exception ignored) {
                /* ignore */
            }
        }
    }

    /** Well-known Text record with English language code (matches Web NFC text records). */
    private static NdefRecord createTextRecord(String text) {
        byte[] lang = "en".getBytes(StandardCharsets.US_ASCII);
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        byte[] payload = new byte[1 + lang.length + body.length];
        payload[0] = (byte) (lang.length & 0x3f);
        System.arraycopy(lang, 0, payload, 1, lang.length);
        System.arraycopy(body, 0, payload, 1 + lang.length, body.length);
        return new NdefRecord(NdefRecord.TNF_WELL_KNOWN, NdefRecord.RTD_TEXT, new byte[0], payload);
    }
}
