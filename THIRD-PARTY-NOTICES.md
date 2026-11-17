# Video engine assets

The site self-hosts the unmodified assets from `@ffmpeg/core@0.12.10` and
`@ffmpeg/ffmpeg@0.12.15`, installed with the exact versions and integrity recorded in
`package-lock.json`. Generated files live under `/vendor/ffmpeg-core/0.12.10/` and `/vendor/ffmpeg/`.

- FFmpeg core package license: GPL-2.0-or-later (as declared in its package manifest).
- Core source and build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg source: https://github.com/FFmpeg/FFmpeg
- Wrapper source and license: https://github.com/ffmpegwasm/ffmpeg.wasm

The app's source and dependency manifests are available at https://github.com/ALPKV/Flipper.
No private recordings are bundled with or sent to these projects.
