package in.shyne.tracex;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/console.html";
    private static final int PICK_FILE = 701;
    private static final int SAVE_SAMPLE = 702;
    private static final String SAMPLE = "downloads/jaipur-synthetic-case.zip";
    private WebView web;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    public void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(0xfff8fafc);
        web = new WebView(this);
        frame.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (Build.VERSION.SDK_INT >= 35) {
            frame.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars() |
                        android.view.WindowInsets.Type.displayCutout() |
                        android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        setContentView(frame);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new NativeActions(), "TraceXAndroid");
        web.setWebViewClient(new BundleClient());
        web.setDownloadListener((url,agent,disposition,type,size) -> {
            Uri target = Uri.parse(url);
            if (isLocal(target) && ("/" + SAMPLE).equals(target.getPath())) {
                Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE).setType("application/zip")
                        .putExtra(Intent.EXTRA_TITLE, "jaipur-synthetic-case.zip");
                try { startActivityForResult(save, SAVE_SAMPLE); }
                catch (ActivityNotFoundException e) { Toast.makeText(this, "File picker unavailable", Toast.LENGTH_SHORT).show(); }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> receive,
                                             FileChooserParams options) {
                cancelPendingFiles();
                pendingFiles = receive;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // CSV and TSV providers disagree about MIME types. The importer validates content.
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        options.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    cancelPendingFiles();
                    Toast.makeText(MainActivity.this, "File picker unavailable", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
        if (saved == null || web.restoreState(saved) == null) web.loadUrl(START);
    }

    private void cancelPendingFiles() {
        if (pendingFiles != null) {
            pendingFiles.onReceiveValue(null);
            pendingFiles = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == SAVE_SAMPLE) {
            if (result != RESULT_OK || data == null || data.getData() == null) return;
            Uri uri = data.getData();
            if (!"content".equals(uri.getScheme())) return;
            try (InputStream in = getAssets().open(SAMPLE); OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Destination unavailable");
                byte[] block = new byte[8192];
                for (int n; (n = in.read(block)) != -1;) out.write(block, 0, n);
                Toast.makeText(this, "Sample files saved", Toast.LENGTH_SHORT).show();
            } catch (IOException e) {
                Toast.makeText(this, "Could not save this sample", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        if (code != PICK_FILE || pendingFiles == null) return;
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
        pendingFiles.onReceiveValue(files.isEmpty() ? null : files.toArray(new Uri[0]));
        pendingFiles = null;
    }

    private void addDocument(ArrayList<Uri> list, Uri uri) {
        if (uri != null && "content".equals(uri.getScheme())) list.add(uri);
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private final class BundleClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request.getUrl());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isLocal(uri) || !"GET".equals(request.getMethod())) return missing();
            String path = uri.getPath();
            if (path == null || !path.startsWith("/") || path.contains("\\")
                    || path.contains("\u0000")) return missing();
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
                return new WebResourceResponse(mime == null ? "application/octet-stream" : mime,
                        mime != null && (mime.startsWith("text/") || mime.endsWith("json")) ? "UTF-8" : null,
                        200, "OK", Collections.singletonMap("X-Content-Type-Options", "nosniff"), content);
            } catch (IOException e) {
                return missing();
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (isLocal(Uri.parse(url))) {
                view.evaluateJavascript("window.print=function(){window.TraceXAndroid.printReport()};"
                        + "(()=>{const apk=document.querySelector('#apk-link');if(apk){"
                        + "apk.href='./console.html';apk.removeAttribute('download');apk.textContent='Open case workspace';"
                        + "document.querySelector('#install-button')?.remove();}})()", null);
            }
        }
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private final class NativeActions {
        @JavascriptInterface
        public void printReport() {
            runOnUiThread(() -> {
                if (isFinishing() || web.getUrl() == null || !isLocal(Uri.parse(web.getUrl()))) return;
                PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                if (manager != null) {
                    manager.print("TRACE-X case report", web.createPrintDocumentAdapter("TRACE-X case report"),
                            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    @Override
    protected void onDestroy() {
        cancelPendingFiles();
        web.removeJavascriptInterface("TraceXAndroid");
        ((ViewGroup) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }
}
