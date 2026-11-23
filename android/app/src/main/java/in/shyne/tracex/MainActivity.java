package in.shyne.tracex;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String OFFLINE = "https://" + ASSET_HOST + "/console.html?demo=1";
    private static final int PICK_FILES = 701;
    private static final int SAVE_DOCUMENT = 702;
    private static final String SAMPLE = "downloads/jaipur-synthetic-case.zip";
    private static final long MAX_DOWNLOAD = 50L * 1024 * 1024;
    private static final int NAVY = Color.rgb(17, 30, 52);
    private static final int BLUE = Color.rgb(32, 68, 218);
    private static final int PAPER = Color.rgb(248, 250, 252);
    private static final int MUTED = Color.rgb(76, 91, 112);

    private final ExecutorService downloadExecutor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private FrameLayout root;
    private FrameLayout viewport;
    private ProgressBar progress;
    private WebView web;
    private URI server;
    private boolean offline;
    private View errorCard;
    private String failedUrl;
    private ValueCallback<Uri[]> pendingFiles;
    private String pendingDownload;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("connection", MODE_PRIVATE);
        root = new FrameLayout(this);
        root.setBackgroundColor(PAPER);
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars()
                        | android.view.WindowInsets.Type.displayCutout()
                        | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(root);

        String saved = preferences.getString("server", "");
        if (state != null && state.getBoolean("offline")) {
            openWorkspace(null, state.getString("url"));
        } else if (!saved.isEmpty()) {
            try {
                openWorkspace(TeamOrigin.parse(saved, BuildConfig.DEBUG), state == null ? null : state.getString("url"));
            } catch (IllegalArgumentException invalid) {
                showConnection();
            }
        } else {
            showConnection();
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private LinearLayout vertical() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        return box;
    }

    private TextView text(String content, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(content);
        view.setTextColor(color);
        view.setTextSize(size);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setTextColor(primary ? Color.WHITE : BLUE);
        if (primary) button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(BLUE));
        return button;
    }

    private void showConnection() {
        disposeWeb();
        root.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        root.addView(scroll, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout content = vertical();
        content.setPadding(dp(26), dp(36), dp(26), dp(26));
        scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
        TextView brand = text("TRACE-X AI", 32, NAVY, true);
        content.addView(brand);
        TextView team = text("TEAM SHYNE  ·  PS03", 13, BLUE, true);
        content.addView(team);
        TextView title = text("Connect to your team", 25, NAVY, true);
        title.setPadding(0, dp(36), 0, dp(10));
        content.addView(title);
        TextView help = text(
                "Enter the address of your TRACE-X team server. Use your investigator, reviewer or admin account to sign in.",
                16, MUTED, false);
        content.addView(help);
        TextView addressLabel = text("Server address", 15, NAVY, true);
        addressLabel.setPadding(0, dp(26), 0, dp(5));
        content.addView(addressLabel);
        EditText address = new EditText(this);
        address.setId(View.generateViewId());
        addressLabel.setLabelFor(address.getId());
        address.setHint(BuildConfig.DEBUG ? "http://192.168.1.20:4318" : "https://tracex.example.org");
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine();
        address.setText(preferences.getString("server", ""));
        content.addView(address, new LinearLayout.LayoutParams(-1, -2));
        if (BuildConfig.DEBUG) {
            TextView lan = text("On a physical phone, use your computer’s Wi-Fi IPv4 address. For demo HTTP, use synthetic cases only.", 14, MUTED, false);
            content.addView(lan);
        }
        Button connect = button("Connect to team server", true);
        LinearLayout.LayoutParams primary = new LinearLayout.LayoutParams(-1, -2);
        primary.topMargin = dp(20);
        content.addView(connect, primary);
        connect.setOnClickListener(v -> {
            try {
                URI origin = TeamOrigin.parse(address.getText().toString(), BuildConfig.DEBUG);
                if ("http".equals(origin.getScheme())) {
                    new AlertDialog.Builder(this).setTitle("Connect over HTTP?")
                            .setMessage("This debug connection sends credentials and case data without encryption. Use a trusted private network and disposable demo accounts with synthetic data.")
                            .setNegativeButton("Cancel", null)
                            .setPositiveButton("Use debug connection", (dialog, which) -> saveConnection(origin))
                            .show();
                } else {
                    saveConnection(origin);
                }
            } catch (IllegalArgumentException invalid) {
                address.setError(invalid.getMessage());
                address.requestFocus();
            }
        });
        Button demo = button("Explore offline sample", false);
        content.addView(demo, new LinearLayout.LayoutParams(-1, -2));
        demo.setOnClickListener(v -> openWorkspace(null, null));
        TextView demoLabel = text("Read-only synthetic case · works without a server", 14, MUTED, false);
        demoLabel.setGravity(Gravity.CENTER);
        content.addView(demoLabel);
    }

    private void saveConnection(URI origin) {
        String previous = preferences.getString("server", "");
        preferences.edit().putString("server", origin.toString()).apply();
        if (!previous.isEmpty() && !previous.equals(origin.toString())) {
            CookieManager.getInstance().removeAllCookies(ignored -> openWorkspace(origin, null));
        } else {
            openWorkspace(origin, null);
        }
    }

    private void openWorkspace(URI origin, String lastPage) {
        disposeWeb();
        root.removeAllViews();
        server = origin;
        offline = server == null;
        LinearLayout column = vertical();
        root.addView(column, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setPadding(dp(12), 0, dp(6), 0);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setBackgroundColor(Color.WHITE);
        column.addView(toolbar, new LinearLayout.LayoutParams(-1, dp(50)));
        String label = offline ? "Offline synthetic sample"
                : "http".equals(server.getScheme()) ? "Team server · demo HTTP" : "Team server · HTTPS";
        TextView state = text(label, 14, NAVY, true);
        toolbar.addView(state, new LinearLayout.LayoutParams(0, -2, 1));
        Button configure = button("Server settings", false);
        toolbar.addView(configure);
        configure.setOnClickListener(v -> showConnection());
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        column.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        viewport = new FrameLayout(this);
        column.addView(viewport, new LinearLayout.LayoutParams(-1, 0, 1));

        web = new WebView(this);
        viewport.addView(web, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WorkspaceClient(origin));
        web.setDownloadListener(this::offerDownload);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> receive,
                                            FileChooserParams options) {
                if (offline || !TeamOrigin.permits(server, view.getUrl())) {
                    receive.onReceiveValue(null);
                    return true;
                }
                cancelPendingFiles();
                pendingFiles = receive;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                                options.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(picker, PICK_FILES);
                } catch (ActivityNotFoundException missing) {
                    cancelPendingFiles();
                    notifyUser("File picker unavailable.");
                }
                return true;
            }
        });
        web.loadUrl(lastPage != null && permitted(lastPage) ? lastPage : entryPoint());
    }

    private String entryPoint() {
        return offline ? OFFLINE : server + "/console.html";
    }

    private boolean permitted(String url) {
        if (url == null) return false;
        return offline ? bundled(Uri.parse(url)) : TeamOrigin.permits(server, url);
    }

    private static boolean bundled(Uri uri) {
        return "https".equals(uri.getScheme()) && ASSET_HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    private void showNetworkFailure(String url, String label) {
        if (web == null || offline) return;
        removeNetworkFailure();
        failedUrl = permitted(url) ? url : entryPoint();
        progress.setVisibility(View.INVISIBLE);
        web.setVisibility(View.INVISIBLE);
        LinearLayout panel = vertical();
        panel.setPadding(dp(24), dp(24), dp(24), dp(24));
        panel.setGravity(Gravity.CENTER_VERTICAL);
        panel.setBackgroundColor(PAPER);
        panel.addView(text("Team server unavailable", 25, NAVY, true));
        TextView reason = text(label, 16, MUTED, false);
        reason.setPadding(0, dp(10), 0, dp(14));
        panel.addView(reason);
        Button retry = button("Retry connection", true);
        panel.addView(retry, new LinearLayout.LayoutParams(-1, -2));
        retry.setOnClickListener(button -> {
            String next = failedUrl;
            removeNetworkFailure();
            web.loadUrl(next);
        });
        Button settings = button("Change server address", false);
        panel.addView(settings, new LinearLayout.LayoutParams(-1, -2));
        settings.setOnClickListener(button -> showConnection());
        errorCard = panel;
        viewport.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void removeNetworkFailure() {
        if (errorCard != null) {
            viewport.removeView(errorCard);
            errorCard = null;
            if (web != null) web.setVisibility(View.VISIBLE);
        }
    }

    private final class WorkspaceClient extends WebViewClient {
        private final URI workspace;

        WorkspaceClient(URI workspace) {
            this.workspace = workspace;
        }

        private boolean inWorkspace(String url) {
            return workspace == null ? bundled(Uri.parse(url)) : TeamOrigin.permits(workspace, url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            boolean blocked = !inWorkspace(request.getUrl().toString());
            if (blocked && request.isForMainFrame()) notifyUser("This address is outside the configured workspace.");
            return blocked;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (!inWorkspace(url)) return missing();
            if (workspace != null) return null;
            if (!"GET".equals(request.getMethod())) return missing();
            return asset(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (view != web) return;
            removeNetworkFailure();
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view != web) return;
            progress.setVisibility(View.INVISIBLE);
            if (workspace == null && bundled(Uri.parse(url))) {
                view.evaluateJavascript("(()=>{const apk=document.querySelector('#apk-link');if(apk){"
                        + "apk.href='./console.html?demo=1';apk.removeAttribute('download');apk.textContent='Open offline sample';"
                        + "document.querySelector('#install-button')?.remove();}})()", null);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (view == web && request.isForMainFrame()) {
                showNetworkFailure(request.getUrl().toString(),
                        "Check your Wi-Fi and confirm the team server is running at the configured address.");
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (view == web && request.isForMainFrame()) {
                showNetworkFailure(request.getUrl().toString(), "The team server returned HTTP " + response.getStatusCode() + ".");
            }
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            if (view == web) showNetworkFailure(error.getUrl(), "Android could not verify the server’s HTTPS certificate.");
        }
    }

    private WebResourceResponse asset(Uri location) {
        String path = location.getPath();
        if (path == null || !path.startsWith("/") || path.contains("\\") || path.indexOf(0) >= 0) return missing();
        for (String segment : path.split("/")) {
            if ("..".equals(segment) || ".".equals(segment)) return missing();
        }
        if ("/".equals(path)) path = "/index.html";
        String extension = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        switch (extension) {
            case "js": case "mjs": mime = "text/javascript"; break;
            case "css": mime = "text/css"; break;
            case "html": mime = "text/html"; break;
            case "svg": mime = "image/svg+xml"; break;
            case "json": mime = "application/json"; break;
            case "webmanifest": mime = "application/manifest+json"; break;
            default: break;
        }
        try {
            InputStream content = getAssets().open(path.substring(1));
            if ("/console.html".equals(path)) {
                try (InputStream html = content; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                    copy(html, buffer, 100_000);
                    String page = buffer.toString("UTF-8").replace("<head>",
                            "<head><script>window.TRACEX_READ_ONLY=true;</script>");
                    content = new ByteArrayInputStream(page.getBytes(StandardCharsets.UTF_8));
                }
            }
            return new WebResourceResponse(mime == null ? "application/octet-stream" : mime,
                    mime != null && (mime.startsWith("text/") || mime.endsWith("json")) ? "UTF-8" : null,
                    200, "OK", Collections.singletonMap("X-Content-Type-Options", "nosniff"), content);
        } catch (IOException error) {
            return missing();
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private void offerDownload(String url, String agent, String disposition, String mime, long size) {
        if (!permitted(url) || size > MAX_DOWNLOAD || pendingDownload != null) return;
        if (offline && !("/" + SAMPLE).equals(Uri.parse(url).getPath())) return;
        String filename = URLUtil.guessFileName(url, disposition, mime).replaceAll("[^A-Za-z0-9._ -]", "_");
        if (filename.length() > 160) filename = filename.substring(filename.length() - 160);
        Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime)
                .putExtra(Intent.EXTRA_TITLE, offline ? "jaipur-synthetic-case.zip" : filename);
        try {
            pendingDownload = url;
            startActivityForResult(save, SAVE_DOCUMENT);
        } catch (ActivityNotFoundException missing) {
            pendingDownload = null;
            notifyUser("File picker unavailable.");
        }
    }

    private void saveDownload(Uri destination, String url) {
        if (!permitted(url)) return;
        boolean sample = offline;
        String cookies = sample ? null : CookieManager.getInstance().getCookie(url);
        notifyUser("Saving download…");
        downloadExecutor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                InputStream input;
                if (sample) {
                    input = getAssets().open(SAMPLE);
                } else {
                    connection = (HttpURLConnection) URI.create(url).toURL().openConnection();
                    connection.setInstanceFollowRedirects(false);
                    connection.setConnectTimeout(12000);
                    connection.setReadTimeout(20000);
                    if (cookies != null) connection.setRequestProperty("Cookie", cookies);
                    int status = connection.getResponseCode();
                    if (status == 401) throw new IOException("Sign in again, then retry the download.");
                    if (status < 200 || status >= 300 || connection.getContentLengthLong() > MAX_DOWNLOAD)
                        throw new IOException("The server could not prepare this download.");
                    input = connection.getInputStream();
                }
                try (InputStream body = input; OutputStream output = getContentResolver().openOutputStream(destination)) {
                    if (output == null) throw new IOException("The save location is unavailable.");
                    copy(body, output, MAX_DOWNLOAD);
                }
                runOnUiThread(() -> notifyUser("Download saved."));
            } catch (IOException error) {
                runOnUiThread(() -> notifyUser("Download failed. Check your connection and sign-in, then retry."));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private static void copy(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] block = new byte[8192];
        long total = 0;
        for (int count; (count = input.read(block)) != -1;) {
            total += count;
            if (total > limit) throw new IOException("This file exceeds the download size limit.");
            output.write(block, 0, count);
        }
    }

    private void cancelPendingFiles() {
        if (pendingFiles == null) return;
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        callback.onReceiveValue(null);
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == SAVE_DOCUMENT) {
            String url = pendingDownload;
            pendingDownload = null;
            Uri destination = data == null ? null : data.getData();
            if (result == RESULT_OK && destination != null && "content".equals(destination.getScheme()) && url != null) {
                saveDownload(destination, url);
            }
            return;
        }
        if (code != PICK_FILES || pendingFiles == null) return;
        ArrayList<Uri> files = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    addDocument(files, data.getClipData().getItemAt(i).getUri());
                }
            } else {
                addDocument(files, data.getData());
            }
        }
        ValueCallback<Uri[]> callback = pendingFiles;
        pendingFiles = null;
        callback.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
    }

    private static void addDocument(ArrayList<Uri> list, Uri uri) {
        if (uri != null && "content".equals(uri.getScheme())) list.add(uri);
    }

    private void notifyUser(String message) {
        if (!isFinishing()) Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void disposeWeb() {
        cancelPendingFiles();
        if (web == null) return;
        WebView old = web;
        web = null;
        errorCard = null;
        old.stopLoading();
        ((ViewGroup)old.getParent()).removeView(old);
        old.destroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && errorCard == null && web.canGoBack()) {
            web.goBack();
        } else if (web != null) {
            showConnection();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (web != null) {
            state.putString("url", web.getUrl());
            state.putBoolean("offline", offline);
        }
    }

    @Override
    protected void onDestroy() {
        disposeWeb();
        downloadExecutor.shutdown();
        super.onDestroy();
    }
}
