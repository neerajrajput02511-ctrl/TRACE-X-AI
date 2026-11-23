package in.shyne.tracex;

import java.net.URI;

public final class TeamOriginCheck {
    public static void main(String[] args) {
        URI secure = TeamOrigin.parse(" https://TEAM.EXAMPLE.ORG:443/ ", false);
        expect(secure.toString().equals("https://team.example.org"), "HTTPS canonical origin");
        expect(TeamOrigin.permits(secure, "https://team.example.org:443/api/session"), "HTTPS default port");
        expect(!TeamOrigin.permits(secure, "https://team.example.org:4318/api/session"), "Port isolation");
        expect(!TeamOrigin.permits(secure, "https://intruder@team.example.org/api/session"), "User-info rejection");
        expect(!TeamOrigin.permits(secure, "https://lookalike.team.example.org/api/session"), "Cross-origin isolation");

        URI lan = TeamOrigin.parse("http://192.168.4.8:4318", true);
        expect(TeamOrigin.permits(lan, "http://192.168.4.8:4318/console.html"), "Private LAN connection");
        expect(TeamOrigin.parse("http://10.0.2.2:4318", true).getHost().equals("10.0.2.2"), "Emulator host mapping");
        expect(!TeamOrigin.permits(lan, "https://192.168.4.8:4318/console.html"), "Scheme isolation");
        for (String bad : new String[] {"http://8.8.8.8", "http://172.32.0.1", "http://192.168.004.8",
                "http://192.168.1.257:4318", "https://appassets.androidplatform.net", "https://appassets.androidplatform.net.",
                "https://team.example.org/console.html", "https://team.example.org?token=value",
                "https://u:p@team.example.org", "file:///android_asset/console.html", "javascript:void(0)"}) {
            reject(bad, true);
        }
        reject("http://192.168.4.8:4318", false);
        System.out.println("Android origin checks passed.");
    }

    private static void reject(String bad, boolean demo) {
        try {
            TeamOrigin.parse(bad, demo);
            throw new AssertionError("Invalid origin was accepted.");
        } catch (IllegalArgumentException expected) { }
    }

    private static void expect(boolean valid, String name) {
        if (!valid) throw new AssertionError(name);
    }
}
