# RUNTIME PROOF ORCH-1093 - Business Web Signed-In Route OOM

Date: 2026-06-06
Mode: Orchestrator intake evidence
Device: Samsung Galaxy A72, ADB serial `R58R54YV7JT`
Browser: Chrome 148.0.7778.215
Surface: `https://business.usemingla.com`

## Result

Physical Android Chrome proves the active blocker is still full signed-in Expo route memory pressure.

- `/home` renders successfully.
- Static Home shows a signed-in session label for `sethogieva@gmail.com`.
- Home tabs are visible: Home, Hub, Ari, Blast, Account.
- Direct full Expo routes such as `/hub/trips` can crash the Chrome renderer and show `Aw, Snap!`.
- Android logcat shows `V8 javascript OOM`, `CrRendererMain`, and sandboxed renderer process death during the route sweep.

This is not a Vercel 404, not a missing static Home deploy, and not the ORCH-1091 stale-chunk cache class.

## Commands Run

```bash
adb devices -l
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d 'https://business.usemingla.com/home' com.android.chrome
adb -s R58R54YV7JT shell uiautomator dump /sdcard/window.xml
adb -s R58R54YV7JT shell cat /sdcard/window.xml
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d 'https://business.usemingla.com/hub/trips' com.android.chrome
adb -s R58R54YV7JT shell logcat -d -t 800 | rg -i 'chrome|chromium|render|renderer|crash|fatal|sigsegv|business.usemingla|Cannot|Error|Exception|OutOfMemory'
```

Production export shape checked:

```bash
curl -s https://business.usemingla.com/event/create | rg -o '/_expo/static/js/web/[^"]+\.js' | sort -u
curl -s https://business.usemingla.com/_expo/static/js/web/__common-601546bb2451b3635cff8126e8ea20a5.js?v=orch1091 | wc -c
curl -s https://business.usemingla.com/_expo/static/js/web/index-673ede93709fe16629641db487c64add.js?v=orch1091 | wc -c
```

## Key Evidence

Home accessibility tree excerpt:

```text
text="Home | Mingla Business"
text="Mingla Business"
text="sethogieva@gmail.com"
text="Run your next drop."
text="Business tabs"
text="Home"
text="Hub"
text="Ari"
text="Blast"
text="Account"
```

Failed route accessibility tree excerpt:

```text
text="Aw, Snap!"
text="Something went wrong while displaying this webpage.

If you're seeing this frequently, try these suggestions."
text="Reload"
text="business.usemingla.com/hub/trips"
```

Android logcat excerpt:

```text
E chromium: V8 javascript OOM (Ineffective mark-compacts near heap limit).
F DEBUG   : Cmdline: com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:58
F DEBUG   : name: CrRendererMain  >>> com.android.chrome:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:58 <<<
W cr_ChildProcessConn: onServiceDisconnected (crash or killed by oom)
I cr_TabWebContentsObs: primaryMainFrameRenderProcessGone()
```

Production eager JS shape:

```text
/_expo/static/js/web/__expo-metro-runtime-0c48b0beee2d3ce6030b475fcc5b1846.js
/_expo/static/js/web/__common-601546bb2451b3635cff8126e8ea20a5.js
/_expo/static/js/web/index-673ede93709fe16629641db487c64add.js

__expo-metro-runtime: 3,802 bytes raw
__common: 1,881,365 bytes raw
index: 998,981 bytes raw
```

## Interpretation

The original 9.24 MB single-bundle class was reduced by later work, but signed-in full Expo route entry remains above the practical memory ceiling for this phone/browser path. ORCH-1093 must determine whether the deterministic fix is deeper route-family lazy loading, reducing the eager common chunk, moving root providers/imports behind route-safe boundaries, or a route-specific static/Expo split.

Release bar: no route family counts as restored until physical Android Chrome and mobile Safari both pass without blank screen, `Aw, Snap!`, generic error boundary, stale chunk request, or renderer OOM logs.
