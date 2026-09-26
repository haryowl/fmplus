package id.armada.field;

import android.webkit.CookieManager;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** POST pings using the Field session cookie from the WebView. */
final class DutyHttp {

    static final class Result {
        final int code;
        final boolean retry;

        Result(int code, boolean retry) {
            this.code = code;
            this.retry = retry;
        }
    }

    private DutyHttp() {}

    static Result postPings(String origin, List<JSONObject> pings) throws Exception {
        String base = origin.endsWith("/") ? origin.substring(0, origin.length() - 1) : origin;
        URL url = new URL(base + "/api/field/location");
        JSONObject body = new JSONObject();
        JSONArray arr = new JSONArray();
        for (JSONObject ping : pings) arr.put(ping);
        body.put("pings", arr);
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);

        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        if (conn instanceof HttpsURLConnection && DutyHosts.allowsUrl(base)) {
            trustPrivateHost((HttpsURLConnection) conn);
        }
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(20_000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        String cookie = CookieManager.getInstance().getCookie(base);
        if (cookie != null && !cookie.isEmpty()) {
            conn.setRequestProperty("Cookie", cookie);
        }
        try (OutputStream out = conn.getOutputStream()) {
            out.write(payload);
        }
        int code = conn.getResponseCode();
        InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (stream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                while (reader.readLine() != null) {
                    /* drain */
                }
            }
        }
        conn.disconnect();
        boolean retry = code == 429 || code >= 500;
        return new Result(code, retry);
    }

    private static void trustPrivateHost(HttpsURLConnection conn) throws Exception {
        TrustManager[] managers = new TrustManager[] {
            new X509TrustManager() {
                @Override
                public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public void checkServerTrusted(X509Certificate[] chain, String authType) {}

                @Override
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }
            }
        };
        SSLContext ctx = SSLContext.getInstance("TLS");
        ctx.init(null, managers, new SecureRandom());
        conn.setSSLSocketFactory(ctx.getSocketFactory());
        conn.setHostnameVerifier((hostname, session) -> DutyHosts.allowsHost(hostname));
    }
}
