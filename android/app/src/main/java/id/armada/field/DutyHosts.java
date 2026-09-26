package id.armada.field;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Hosts this sideload APK is allowed to talk to over a private cert. */
final class DutyHosts {

    private static final Set<String> ALLOWED = new HashSet<>(
        Arrays.asList("81.17.100.7", "localhost", "127.0.0.1", "10.0.2.2")
    );

    private DutyHosts() {}

    static boolean allowsUrl(String url) {
        String host = hostOf(url);
        return host != null && ALLOWED.contains(host.toLowerCase(Locale.ROOT));
    }

    static boolean allowsHost(String host) {
        return host != null && ALLOWED.contains(host.toLowerCase(Locale.ROOT));
    }

    static String hostOf(String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            return new URI(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }
}
