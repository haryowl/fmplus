package id.armada.field;

import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Proceed on TLS errors only for the Field host we wrap (private / self-signed cert).
 */
public class TrustedHostWebViewClient extends BridgeWebViewClient {

    public TrustedHostWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        String url = error != null ? error.getUrl() : null;
        if (DutyHosts.allowsUrl(url)) {
            handler.proceed();
            return;
        }
        super.onReceivedSslError(view, handler, error);
    }
}
