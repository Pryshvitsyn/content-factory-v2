# Quick Start: Video Factory

## Prerequisites

1. **Node.js** (v16 or higher)
2. **FFmpeg** installed and in PATH
   - macOS: `brew install ffmpeg`
   - Ubuntu: `sudo apt-get install ffmpeg`
   - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## Installation

```bash
# Install dependencies
npm install

# Verify FFmpeg is installed
ffmpeg -version
```

## Configuration

Edit `config/video-factory.json`:

```json
{
  "providers": ["nvidia"],
  "budget": {
    "enabled": true,
    "maxCostPerVideo": 5.00
  },
  "rendering": {
    "resolution": "1080x1920",
    "framerate": 30
  },
  "storage": {
    "type": "local",
    "basePath": "./output/videos"
  }
}
```

## Usage

### Generate a video

```bash
node scripts/factory-video-cli.js \
  --app=now \
  --lang=en \
  --duration=30 \
  --style=tech \
  --topic="Smart scheduling for busy professionals"
```

### Options

| Option     | Required | Description                           | Example                    |
|------------|----------|---------------------------------------|----------------------------|
| `--app`    | Yes      | Application identifier                | `now`, `attune`, `luxuryitaly` |
| `--lang`   | Yes      | Language code                         | `en`, `it`, `ru`           |
| `--duration` | No     | Target duration in seconds (default: 30) | `30`, `60`                 |
| `--style`  | No       | Visual style (default: `tech`)        | `tech`, `luxury`, `minimal` |
| `--topic`  | Yes      | Topic/theme for the video             | `"Smart scheduling..."`    |

### Examples

#### Now app (English, 30s)

```bash
node scripts/factory-video-cli.js \
  --app=now \
  --lang=en \
  --duration=30 \
  --style=tech \
  --topic="Smart scheduling for busy professionals"
```

#### Attune app (Italian, 45s)

```bash
node scripts/factory-video-cli.js \
  --app=attune \
  --lang=it \
  --duration=45 \
  --style=minimal \
  --topic="Personal focus and productivity tool"
```

#### Luxury Italy (Russian, 60s)

```bash
node scripts/factory-video-cli.js \
  --app=luxuryitaly \
  --lang=ru \
  --duration=60 \
  --style=luxury \
  --topic="Premium real estate in Italy"
```

## Output

Videos are saved to `./output/videos/`:

```
output/videos/
├── video-now-1724281234567.mp4
├── video-now-1724281234567.mp4.json
└── ...
```

## Troubleshooting

### FFmpeg not found

```bash
# Check if FFmpeg is installed
ffmpeg -version

# If not found, install it:
# macOS
brew install ffmpeg

# Ubuntu
sudo apt-get install ffmpeg
```

### Provider errors

Make sure you have configured API keys for providers in `.env`:

```bash
# Example .env
NVIDIA_API_KEY=your-api-key-here
```

### Storage errors

Check that the output directory exists and is writable:

```bash
mkdir -p output/videos
chmod 755 output/videos
```

## Next Steps

- See [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) for full documentation
- Configure custom voices and fonts in `config/video-factory.json`
- Set up S3 storage for production use
- Add API endpoint for web integration
