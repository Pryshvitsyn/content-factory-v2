# Video Production Pipeline (V2.1)

## Overview

Video production pipeline — это end-to-end пайплайн для генерации промо-видео для приложений (Now, Attune, luxuryitaly.net и др.) с использованием NVIDIA API.

## Architecture

```
Input (app, lang, duration, style, topic)
  ↓
Stage 1: Script Generation (NVIDIA text)
  ↓
Stage 2: Audio Generation (NVIDIA TTS)
  ↓
Stage 3: Visual Elements (NVIDIA images)
  ↓
Stage 4: Video Rendering (FFmpeg / renderer)
  ↓
Stage 5: QA Checks
  ↓
Stage 6: Storage
  ↓
Output: MP4 video file
```

## Usage

### CLI

```bash
node scripts/factory-video-cli.js \
  --app=now \
  --lang=en \
  --duration=30 \
  --style=tech \
  --topic="Smart scheduling for busy professionals"
```

### Options

| Option     | Required | Description                                      | Example                    |
|------------|----------|--------------------------------------------------|----------------------------|
| `--app`    | Yes      | Application identifier                           | `now`, `attune`, `luxuryitaly` |
| `--lang`   | Yes      | Language code                                    | `en`, `it`, `ru`           |
| `--duration` | No     | Target duration in seconds (default: 30)         | `30`, `60`                 |
| `--style`  | No       | Visual style (default: `tech`)                   | `tech`, `luxury`, `minimal` |
| `--topic`  | Yes      | Topic/theme for the video                        | `"Smart scheduling..."`    |

### Example Commands

#### Now app (English, 30s, tech style)

```bash
node scripts/factory-video-cli.js \
  --app=now \
  --lang=en \
  --duration=30 \
  --style=tech \
  --topic="Smart scheduling for busy professionals"
```

#### Attune app (Italian, 45s, minimal style)

```bash
node scripts/factory-video-cli.js \
  --app=attune \
  --lang=it \
  --duration=45 \
  --style=minimal \
  --topic="Personal focus and productivity tool"
```

#### Luxury Italy (Russian, 60s, luxury style)

```bash
node scripts/factory-video-cli.js \
  --app=luxuryitaly \
  --lang=ru \
  --duration=60 \
  --style=luxury \
  --topic="Premium real estate in Italy"
```

## Pipeline Stages

### Stage 1: Script Generation

- **Provider**: NVIDIA (text generation)
- **Input**: app, lang, duration, style, topic
- **Output**: Structured script/scenario
- **File**: `video-production-pipeline.js::_generateScript()`

### Stage 2: Audio Generation

- **Provider**: NVIDIA (TTS / voiceover)
- **Input**: script content, lang, voice selection
- **Output**: Audio data (duration, voice characteristics)
- **File**: `video-production-pipeline.js::_generateAudio()`

### Stage 3: Visual Elements

- **Provider**: NVIDIA (image generation)
- **Input**: script, style, aspect ratio
- **Output**: Array of visual elements (scenes)
- **File**: `video-production-pipeline.js::_generateVisuals()`

### Stage 4: Video Rendering

- **Renderer**: FFmpeg-based (TODO: implement)
- **Input**: script, audio, visuals
- **Output**: Rendered video structure
- **File**: `video-production-pipeline.js::_renderVideo()`

### Stage 5: QA Checks

- **Checks**:
  - Script content is not empty
  - Audio data is present
  - Visual elements are generated
  - Duration is within expected range
- **Output**: QA result (passed/failed, issues list)
- **File**: `video-production-pipeline.js::_runQA()`

### Stage 6: Storage

- **Storage**: S3 / local filesystem (TODO: implement)
- **Output**: Path/URL to final video file
- **File**: `video-production-pipeline.js::_storeResult()`

## Output Structure

```javascript
{
  jobId: "video-now-1724281234567",
  artifacts: {
    script: {
      type: "script",
      content: "...",
      metadata: { ... }
    },
    audio: {
      type: "audio",
      data: "...",
      duration: 30,
      metadata: { ... }
    },
    visuals: {
      type: "visuals",
      elements: [ ... ],
      metadata: { ... }
    },
    rendered: {
      type: "rendered",
      status: "placeholder",
      metadata: { ... }
    }
  },
  qa: {
    passed: true,
    issues: [],
    checkedAt: "2026-08-21T22:00:00.000Z"
  },
  outputPath: "/output/videos/video-now-1724281234567.mp4"
}
```

## TODO / Next Steps

1. **Implement video renderer**
   - FFmpeg-based renderer
   - Support for vertical (9:16) and horizontal (16:9) formats
   - Text overlay (subtitles, branding)

2. **Implement storage**
   - S3 integration
   - Local filesystem fallback
   - CDN integration (optional)

3. **Improve QA**
   - Video duration validation
   - Audio/video sync check
   - Visual quality metrics

4. **Add API endpoint**
   - `POST /factory/video`
   - Async job processing
   - Status endpoint: `GET /factory/video/:jobId`

5. **Provider selection**
   - Support for multiple providers (not just NVIDIA)
   - Provider scoring/rating per task type
   - Automatic provider selection based on task

## Branch

This implementation is on branch: `feat/v2.1-video-pipeline-perplexity`

## Integration with Main

After testing and validation:

1. Test with real video generation scenarios
2. Fix any issues
3. Open PR to `main`
4. Merge after approval
