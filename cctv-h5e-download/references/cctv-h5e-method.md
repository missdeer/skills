# CCTV H5e Method Notes

## Verified Root Cause

CCTV H5e TS fragments are not standard HLS AES. TS headers, PAT/PMT, and audio can look normal while video PES/NAL payloads are custom-encrypted. Direct ffmpeg copy, remux, re-encode, or hardware decode can produce normal audio and garbled video.

The browser path uses `vhs_drm2.min.js` plus `cctv.worker.js`. The worker transmuxes TS to fMP4 and applies a CCTV wrapper. The main thread decrypts the wrapped video fMP4 payload before appending to MSE. The NAL-level decode also depends on `mediaTagID`.

## Known-Good Worker Init

Captured from the real CCTV page:

```json
{
  "remux": false,
  "alignGopsAtEnd": false,
  "keepOriginalTimestamps": true,
  "loaderType": "main",
  "moduleURI": "https://player.cntv.cn/h5vod/cctv.worker.js",
  "mediaTagID": "_video_player"
}
```

Do not substitute the video GUID for `mediaTagID`. For the verified 2023-07-18 page, using the GUID caused corrupted output.

## Worker Reset Requirement

Processing all TS fragments through one worker can drift after many fragments. In the verified case, the first decode error appeared near `00:33:54`, around fragment 203, although fragments 0-60 were clean. Starting a fresh worker at fragment 202 produced clean output for the same TS data. The durable fix was to reset the worker every 50 fragments while preserving original timestamps.

Use `--reset-every 50` as the default. If validation fails later in the video, reduce to 25 and rerun.

## Validation Rules

Use all of these before declaring success:

```powershell
& "<ffprobe.exe>" -v error -show_entries format=duration,size,bit_rate -show_entries stream=index,codec_name,codec_type,width,height,avg_frame_rate,bit_rate -of json "output.mp4"
& "<ffmpeg.exe>" -hide_banner -v warning -xerror -i "output.mp4" -f null -
```

Pass means `ffmpeg -xerror` exits 0 without H.264 errors. `Duplicated SDTP atom` during remux is acceptable. `error while decoding MB`, `corrupt decoded frame`, `top block unavailable`, or `concealing ... errors` during validation is failure.

If failure occurs, locate the first bad timestamp:

```powershell
& "<ffmpeg.exe>" -hide_banner -v info -xerror -i "output.mp4" -vf showinfo -f null - 2>&1 | Select-Object -Last 100
```

Convert timestamp to approximate segment number by dividing by segment duration, usually 10 seconds.

## Expected Artifacts

- `playlist_capture.json`: captured candidate H5e m3u8 URLs.
- `ts_temp/*.ts`: encrypted TS fragments.
- `vhs_drm2.min.js`: original CCTV player DRM script.
- `vhs_drm2.driver.js`: patched script exposing `__CCTVWorkerFactory` and `__CCTVCodec`.
- `worker_out/video.clean.mp4frag`, `worker_out/audio.clean.mp4frag`: decrypted fMP4 fragments.
- final `.mp4`: remuxed playable file.

## Fallbacks

If playlist capture fails, open the page manually in Chrome 9222 and inspect Network for URLs containing `/asp/h5e/hls/` and ending in `.m3u8`. Prefer the media playlist with a numeric bitrate path such as `/hls/2000/.../2000.m3u8` over `/hls/main/.../main.m3u8`.

If patching `vhs_drm2.min.js` fails, inspect the minified script for the worker factory assignment around `bi=gi(_i)` and the codec object near `Zi=function`. The goal is still to expose:

```javascript
self.__CCTVWorkerFactory = gi(_i)
self.__CCTVCodec = <codec object with getInstance().dct>
```

If a user already has `ts_temp`, skip playlist capture and download. Use the provided local TS directory directly with `process_local_ts_with_worker.mjs`.
