// Parche nativo de Android: pantalla completa inmersiva, zona de la cámara y orientación libre.
// Es idempotente (se puede ejecutar varias veces) y nunca rompe la compilación.
const fs = require('fs'), path = require('path');
const log = m => console.log('[patch-android] ' + m);
try {
  const root = process.cwd();
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  const appId = cfg.appId;
  const base = path.join(root, 'android', 'app', 'src', 'main');
  if (!fs.existsSync(base)) { log('la carpeta android todavía no existe; se omite'); process.exit(0); }

  // 1) MainActivity: oculta barras del sistema, usa el área de la cámara, pantalla siempre encendida
  const javaDir = path.join(base, 'java', ...appId.split('.'));
  fs.mkdirSync(javaDir, { recursive: true });
  const java = `package ${appId};

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().setBackgroundDrawable(new ColorDrawable(Color.BLACK));
    if (Build.VERSION.SDK_INT >= 28) {
      WindowManager.LayoutParams lp = getWindow().getAttributes();
      lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
        ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(lp);
    }
    try { getBridge().getWebView().setBackgroundColor(Color.BLACK); } catch (Exception e) {}
    hideBars();
  }

  @Override
  public void onResume() {
    super.onResume();
    hideBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideBars();
  }

  private void hideBars() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    c.hide(WindowInsetsCompat.Type.systemBars());
  }
}
`;
  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), java);
  log('MainActivity.java escrita');

  // 2) Tema: sin barra de estado, usa la zona de la cámara y fondo negro
  const sp = path.join(base, 'res', 'values', 'styles.xml');
  if (fs.existsSync(sp)) {
    let x = fs.readFileSync(sp, 'utf8');
    if (x.includes('windowFullscreen')) log('styles.xml ya estaba parcheado');
    else {
      const items = '\n        <item name="android:windowFullscreen">true</item>' +
        '\n        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>' +
        '\n        <item name="android:windowBackground">@android:color/black</item>' +
        '\n        <item name="android:statusBarColor">@android:color/transparent</item>' +
        '\n        <item name="android:navigationBarColor">@android:color/transparent</item>';
      let n = 0;
      x = x.replace(/(<style\s+name="AppTheme\.NoActionBar[^"]*"[^>]*>)/g, (m, g1) => { n++; return g1 + items; });
      fs.writeFileSync(sp, x);
      log('styles.xml parcheado (' + n + ' temas)');
    }
  } else log('AVISO: no encontré styles.xml');

  // 3) Manifest: orientación libre (vertical y horizontal)
  const mp = path.join(base, 'AndroidManifest.xml');
  if (fs.existsSync(mp)) {
    let m = fs.readFileSync(mp, 'utf8');
    if (!m.includes('screenOrientation')) {
      m = m.replace(/<activity(\s)/, '<activity android:screenOrientation="fullSensor"$1');
      if (m.includes('screenOrientation')) { fs.writeFileSync(mp, m); log('AndroidManifest.xml: orientación libre añadida'); }
      else log('AVISO: no pude añadir la orientación al manifest');
    } else log('AndroidManifest.xml ya tenía orientación');
  } else log('AVISO: no encontré AndroidManifest.xml');

  // 4) Nombre de la app (lo que aparece bajo el ícono)
  const appName = (cfg.appName || 'Pocket Hero').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const stp = path.join(base, 'res', 'values', 'strings.xml');
  if (fs.existsSync(stp)) {
    let t = fs.readFileSync(stp, 'utf8');
    t = t.replace(/(<string\s+name="app_name"[^>]*>)[^<]*(<\/string>)/, '$1' + appName + '$2')
         .replace(/(<string\s+name="title_activity_main"[^>]*>)[^<]*(<\/string>)/, '$1' + appName + '$2');
    fs.writeFileSync(stp, t);
    log('strings.xml: nombre de la app = ' + cfg.appName);
  } else log('AVISO: no encontré strings.xml');

  // 5) Ícono de la app (adaptable + legado + redondo) y pantalla de carga con el logo
  const icons = path.join(root, 'tools', 'icons'), res = path.join(base, 'res');
  if (fs.existsSync(icons)) {
    const mine = /^(ic_launcher|ic_launcher_round|ic_launcher_foreground|ic_launcher_bg)\.[a-z0-9]+$/i;
    let n = 0;
    for (const d of fs.readdirSync(icons)) {
      const src = path.join(icons, d);
      if (!d.startsWith('mipmap-') || !fs.statSync(src).isDirectory()) continue;
      const dst = path.join(res, d); fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(dst)) if (mine.test(f)) fs.unlinkSync(path.join(dst, f)); // evita recursos duplicados
      for (const f of fs.readdirSync(src)) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
    }
    const any = path.join(res, 'mipmap-anydpi-v26'); fs.mkdirSync(any, { recursive: true });
    const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '    <background android:drawable="@mipmap/ic_launcher_bg"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
    fs.writeFileSync(path.join(any, 'ic_launcher.xml'), adaptive);
    fs.writeFileSync(path.join(any, 'ic_launcher_round.xml'), adaptive);
    log('íconos instalados (' + n + ' archivos)');

    const logoSrc = path.join(icons, 'drawable-nodpi', 'splash_logo.png');
    if (fs.existsSync(logoSrc)) {
      for (const d of fs.readdirSync(res)) {            // quita el splash por defecto (logo azul)
        if (!d.startsWith('drawable')) continue;
        const dp = path.join(res, d);
        for (const f of fs.readdirSync(dp)) if (/^splash\.[a-z0-9]+$/i.test(f)) fs.unlinkSync(path.join(dp, f));
      }
      const nd = path.join(res, 'drawable-nodpi'); fs.mkdirSync(nd, { recursive: true });
      fs.copyFileSync(logoSrc, path.join(nd, 'splash_logo.png'));
      const dd = path.join(res, 'drawable'); fs.mkdirSync(dd, { recursive: true });
      fs.writeFileSync(path.join(dd, 'splash.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n' +
        '    <item><shape android:shape="rectangle"><solid android:color="#000000"/></shape></item>\n' +
        '    <item><bitmap android:gravity="center" android:src="@drawable/splash_logo"/></item>\n</layer-list>\n');
      log('pantalla de carga con el logo instalada');
    }
    // fondo negro del splash de Android 12+ (solo si el tema lo soporta)
    if (fs.existsSync(sp)) {
      let x = fs.readFileSync(sp, 'utf8');
      if (x.includes('Theme.SplashScreen') && !x.includes('windowSplashScreenBackground')) {
        x = x.replace(/(<style\s+name="AppTheme\.NoActionBarLaunch"[^>]*>)/, '$1\n        <item name="windowSplashScreenBackground">#000000</item>');
        fs.writeFileSync(sp, x); log('splash de Android 12+: fondo negro');
      }
    }
  } else log('AVISO: no encontré tools/icons');
} catch (e) {
  console.log('[patch-android] error (se ignora): ' + e.message);
}
process.exit(0);
