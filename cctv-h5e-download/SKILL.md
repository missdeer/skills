---
name: cctv-h5e-download
description: Download and convert CCTV/CNTV web video pages that use encrypted H5e HLS streams into playable local MP4 files. Use when the user gives a tv.cctv.cn, cntv.cn, or related CCTV VOD URL and asks to download the highest-quality video, fix garbled video, decrypt H5e TS fragments, process a local ts_temp directory, or produce a normal MP4 for local playback.
---

# CCTV H5e Download

## Overview

Use the official CCTV browser JavaScript/WASM pipeline locally instead of trying to decode encrypted H5e TS files with ffmpeg directly. The verified path is:

1. Capture the real H5e media playlist from a Chrome page running with remote debugging.
2. Download all TS fragments to `ts_temp`.
3. Patch `vhs_drm2.min.js` to expose the CCTV transmux worker factory and video wrapper codec.
4. Feed local TS files to the official worker in batches, with `mediaTagID: "_video_player"` and periodic worker resets.
5. Remux the resulting fMP4 fragments to MP4 and validate with `ffmpeg -xerror`.

## Required Tools

- Node.js 20+.
- Chrome/Chromium with remote debugging on `http://127.0.0.1:9222`.
- `ffmpeg.exe` and `ffprobe.exe`; if the user specifies paths, use those exactly.
- Network access to CCTV/CDN/player URLs.

If Chrome is not already listening on 9222, start it with a separate profile, for example:

```powershell
Start-Process "chrome.exe" -WindowStyle Hidden -ArgumentList "--remote-debugging-port=9222","--user-data-dir=$PWD\chrome-cctv-profile"
```

## Workflow

Create one clean working directory per video. Copy or reference the scripts in this skill's `scripts/` directory, then run the workflow from that working directory.

1. Capture the H5e playlist:

```powershell
node <skill>/scripts/capture_h5e_playlist_from_browser.mjs --url "<CCTV page URL>" --out playlist_capture.json
```

Use the captured `selectedMediaPlaylist` URL. If no media playlist appears, reload the page, start playback muted, or inspect `playlist_capture.json` for a variant playlist under `/asp/h5e/hls/main/`.

2. Download the highest-quality TS fragments:

```powershell
node <skill>/scripts/download_h5e_segments.mjs --playlist "<media-or-master-m3u8-url>" --out-dir ts_temp
```

3. Fetch and patch the CCTV player DRM script:

```powershell
curl.exe -L --ssl-no-revoke -o vhs_drm2.min.js "https://player.cntv.cn/h5vod/vhs_drm2.min.js"
node <skill>/scripts/make_vhs_driver_patch.mjs --input vhs_drm2.min.js --output vhs_drm2.driver.js
```

4. Convert local TS to fMP4 fragments using the official worker:

```powershell
node <skill>/scripts/process_local_ts_with_worker.mjs --page-url "<CCTV page URL>" --ts-dir ts_temp --out-dir worker_out --driver vhs_drm2.driver.js --reset-every 50
```

Important invariants:

- Use `mediaTagID: "_video_player"` unless a fresh worker-init capture proves otherwise.
- Use `remux:false`, `alignGopsAtEnd:false`, `keepOriginalTimestamps:true`, `loaderType:"main"`.
- Reset the worker periodically. A single worker can drift after many fragments and produce locally corrupted video even when early segments look correct. `--reset-every 50` is the verified default.

5. Clean duplicate init segments, remux, and validate:

```powershell
node <skill>/scripts/clean_worker_fragments.mjs --out-dir worker_out
& "<ffmpeg.exe>" -y -hide_banner -loglevel warning -i "worker_out\video.clean.mp4frag" -i "worker_out\audio.clean.mp4frag" -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart "output.mp4"
& "<ffprobe.exe>" -v error -show_entries format=duration,size,bit_rate -show_entries stream=index,codec_name,codec_type,width,height,avg_frame_rate,bit_rate -of json "output.mp4"
& "<ffmpeg.exe>" -hide_banner -v warning -xerror -i "output.mp4" -f null -
```

`Duplicated SDTP atom` warnings during remux are acceptable for these fMP4 fragments. H.264 decode errors during validation are not acceptable.

## Debugging

Read `references/cctv-h5e-method.md` when:

- video is still garbled,
- `ffmpeg -xerror` fails,
- the playlist capture misses the H5e URL,
- worker output gets much smaller after a certain timestamp,
- CCTV changes player script structure and the patch fails.

Prefer byte-level and decode validation over visual guessing. Always report the final MP4 path and whether full `ffmpeg -xerror` validation passed.
