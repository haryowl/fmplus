package id.armada.field;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** API calls for the offline Field APK, including the private Field host cert. */
@CapacitorPlugin(name = "OfflineHttp")
public class OfflineHttpPlugin extends Plugin {

    @PluginMethod
    public void request(PluginCall call) {
        String urlText = call.getString("url", "");
        String method = call.getString("method", "GET");
        String body = call.getString("body");
        String authorization = call.getString("authorization", "");
        if (urlText == null || urlText.isEmpty()) {
            call.reject("url is required");
            return;
        }
        try {
            URL url = new URL(urlText);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            if (conn instanceof HttpsURLConnection && DutyHosts.allowsUrl(urlText)) {
                trustPrivateHost((HttpsURLConnection) conn);
            }
            conn.setConnectTimeout(30_000);
            conn.setReadTimeout(60_000);
            conn.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
            conn.setRequestProperty("Accept", "application/json");
            if (authorization != null && !authorization.isEmpty()) {
                conn.setRequestProperty("Authorization", authorization);
            }
            conn.setRequestProperty("X-Field-Offline", "1");
            if (body != null && !body.isEmpty() && !"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(payload);
                }
            }
            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = readStream(stream);
            String session = sessionFromSetCookie(conn.getHeaderField("Set-Cookie"));
            conn.disconnect();
            JSObject result = new JSObject();
            result.put("status", status);
            result.put("body", text);
            result.put("session", session);
            call.resolve(result);
        } catch (Throwable err) {
            JSObject result = new JSObject();
            result.put("status", 0);
            result.put("body", "");
            call.resolve(result);
        }
    }

    private static String sessionFromSetCookie(String header) {
        if (header == null) return "";
        int key = header.indexOf("fmplus_field_sid=");
        if (key < 0) return "";
        int start = key + "fmplus_field_sid=".length();
        int end = header.indexOf(';', start);
        String token = (end < 0 ? header.substring(start) : header.substring(start, end)).trim();
        return token;
    }

    private static String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = stream.read(chunk)) >= 0) buf.write(chunk, 0, n);
        stream.close();
        return buf.toString(StandardCharsets.UTF_8);
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
