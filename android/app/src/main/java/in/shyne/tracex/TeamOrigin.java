package in.shyne.tracex;

import java.net.URI;
import java.util.Locale;

final class TeamOrigin {
    private static final String BUNDLE_HOST = "appassets.androidplatform.net";

    static URI parse(String input, boolean demoHttp) {
        try {
            URI candidate = URI.create(input.trim());
            String scheme = candidate.getScheme();
            String host = candidate.getHost();
            int port = candidate.getPort();
            String path = candidate.getRawPath();
            if (host == null || scheme == null || BUNDLE_HOST.equalsIgnoreCase(host)
                    || (BUNDLE_HOST + ".").equalsIgnoreCase(host)
                    || candidate.getRawUserInfo() != null || candidate.getRawQuery() != null
                    || candidate.getRawFragment() != null || port == 0 || port > 65535
                    || (path != null && !path.isEmpty() && !"/".equals(path))) {
                throw new IllegalArgumentException();
            }
            boolean https = "https".equalsIgnoreCase(scheme);
            boolean http = "http".equalsIgnoreCase(scheme);
            if (!https && !(http && demoHttp && isPrivateIpv4(host))) {
                throw new IllegalArgumentException();
            }
            int normalizedPort = (https && port == 443) || (http && port == 80) ? -1 : port;
            return new URI(scheme.toLowerCase(Locale.ROOT), null, host.toLowerCase(Locale.ROOT),
                    normalizedPort, null, null, null);
        } catch (Exception error) {
            throw new IllegalArgumentException(demoHttp
                    ? "Enter an HTTPS server address, or an HTTP address using a private Wi-Fi IPv4 address."
                    : "Enter an HTTPS server address, such as https://tracex.example.org.");
        }
    }

    static boolean permits(URI origin, String url) {
        if (origin == null) return false;
        try {
            URI target = URI.create(url);
            return target.getRawUserInfo() == null
                    && origin.getScheme().equalsIgnoreCase(target.getScheme())
                    && origin.getHost().equalsIgnoreCase(target.getHost())
                    && effectivePort(origin) == effectivePort(target);
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }

    private static boolean isPrivateIpv4(String host) {
        String[] octets = host.split("\\.", -1);
        if (octets.length != 4) return false;
        int[] ip = new int[4];
        for (int i = 0; i < octets.length; i++) {
            if (!octets[i].matches("0|[1-9][0-9]{0,2}")) return false;
            ip[i] = Integer.parseInt(octets[i]);
            if (ip[i] > 255) return false;
        }
        return ip[0] == 10 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31)
                || (ip[0] == 192 && ip[1] == 168);
    }

    private TeamOrigin() { }
}
