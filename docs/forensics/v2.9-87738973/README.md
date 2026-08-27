# Forensic audit: production 87738973-ae73-4963-8bb0-721a903c879c

Conclusion: `SOURCE_VISUAL_DEFECT_PRESERVED_IN_MASTER`.

The multi-panel/triptych composition is visibly present in the immutable provider source at every representative timestamp. The final FFmpeg master preserves the same composition while scaling/cropping the visual, resampling it to 30 fps, and muxing external speech. No layout-composition operation was found in the master path, so FFmpeg did not introduce the triptych.

| Artifact | Technical values |
| --- | --- |
| Replicate source | 480x832, 16 fps, 5.0625 s, H.264/yuv420p, no audio, 282,173 bytes |
| OpenAI speech | MP3, 24 kHz, 7.656 s, 122,496 bytes |
| FFmpeg master | 1080x1920, 30 fps, 5.000 s, H.264/yuv420p, AAC 24 kHz, 2,326,146 bytes |

Evidence was generated read-only with zero provider calls. The production, its validation history, and all historical artifact bytes were not modified. New forensic evidence consists only of this report, the machine-readable [`report.json`](report.json), and deterministic 2%, 10%, 30%, 50%, 70%, 90%, and 98% frame samples under [`frames/`](frames/).

The source speech is 2.656 seconds longer than the master window, which V2.9 classifies as a hard `VOICEOVER_CUTOFF` failure for a comparable new run.

Reproduce the evidence from explicitly supplied immutable local paths with:

```bash
node scripts/v2.9-forensic-audit.js \
  --production-id 87738973-ae73-4963-8bb0-721a903c879c \
  --source /absolute/path/to/immutable/source \
  --speech /absolute/path/to/immutable/speech \
  --master /absolute/path/to/immutable/master \
  --output docs/forensics/v2.9-87738973
```

The script refuses to overwrite an existing report and performs local hashing, probing, and FFmpeg frame extraction only.
