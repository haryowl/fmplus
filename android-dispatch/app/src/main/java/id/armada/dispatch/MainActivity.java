package id.armada.dispatch;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/** Desk Jobs + Dispatch Live shell. NFC write/scan + camera for catalog labels. */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NfcScanPlugin.class);
        registerPlugin(NfcWritePlugin.class);
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.setWebViewClient(new TrustedHostWebViewClient(getBridge()));
            webView.addJavascriptInterface(new ArmadaNativeBridge(), "ArmadaNative");
        }
    }

    public static class ArmadaNativeBridge {
        @JavascriptInterface
        public String appKind() {
            return "dispatch";
        }

        @JavascriptInterface
        public String appId() {
            return "id.armada.dispatch";
        }
    }
}
