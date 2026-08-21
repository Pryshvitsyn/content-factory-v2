# Video Production Pipeline (V2.1)

## Overview

Video production pipeline — это production-grade пайплайн для генерации промо-видео для приложений (Now, Attune, luxuryitaly.net и др.) с использованием NVIDIA API и других провайдеров.

## Architecture

### Best Practices from Top Projects

Наша архитектура взяла лучшее из топовых open-source проектов:

- **MoneyPrinterTurbo** (65K звёзд) — MVC, кэширование, мульти-язычность
- **OpenMontage** (38K звёзд) — агентовая архитектура, scored provider selection, quality gates
- **AutoVio** — multi-provider AI pipeline, TypeScript/Node.js

### Pipeline Stages

```
Input (app, lang, duration, style, topic)
  ↓
Stage 0: Budget Estimation
  ↓
Stage 1: Provider Selection (7-dimension scoring)
  ↓
Stage 2: Pre-Compose Quality Gate
  ↓
Stage 3: Script Generation (LLM)
  ↓
Stage 4: Audio Generation (TTS)
  ↓
Stage 5: Visual Elements (Image Generation)
  ↓
Stage 6: Video Rendering (FFmpeg)
  ↓
Stage 7: Post-Render Quality Gate
  ↓
Stage 8: Final QA
  ↓
Stage 9: Storage
  ↓
Output: MP4 video file
```

## Key Features

### 1. Scored Provider Selection

Выбор лучшего провайдера по 7 измерениям (как в OpenMontage):

- **Quality** — качество генерации
- **Speed** — скорость выполнения
- **Cost** — стоимость
- **Reliability** — надёжность
- **Feature Match** — соответствие требованиям задачи
- **Latency** — задержка
- **Availability** — доступность

Веса настраиваются в конфигурации:

```json
{
  "scoringWeights": {
    "quality": 0.25,
    "speed": 0.15,
    "cost": 0.15,
    "reliability": 0.15,
    "feature_match": 0.15,
    "latency": 0.10,
    "availability": 0.05
  }
}
```

### 2. Quality Gates

Три уровня контроля качества:

1. **Pre-Compose Gate** — валидация входных данных перед генерацией
2. **Post-Render Gate** — проверка артефактов после рендеринга
3. **Final QA** — финальные метрики качества

### 3. Budget Governance

- Оценка стоимости перед запуском
- Лимиты на стоимость видео
- Audit trail всех решений

### 4. Decision Audit Trail

Логирование всех решений для отладки и анализа:

- Выбор провайдера
- Пройденные quality gates
- Метрики качества

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

## Configuration

Конфигурация находится в `config/video-factory.json`:

- **providers** — список провайдеров
- **scoringWeights** — веса для scoring
- **qualityGates** — включение/выключение gates
- **budget** — лимиты и настройки бюджета
- **rendering** — настройки FFmpeg (кодеки, битрейты, resolution)
- **storage** — настройки хранилища (local/S3)
- **voices** — голоса по языкам и стилям
- **fonts** — шрифты по стилям
- **branding** — логотипы и цвета для приложений

## Output Structure

```javascript
{
  jobId: "video-now-1724281234567",
  status: "success",
  duration: 15000, // ms
  artifacts: {
    script: { type: "script", content: "...", provider: "nvidia" },
    audio: { type: "audio", data: "...", duration: 30, provider: "nvidia" },
    visuals: { type: "visuals", elements: [...], provider: "nvidia" },
    rendered: { type: "rendered", status: "success", provider: "nvidia" }
  },
  outputPath: "/output/videos/video-now-1724281234567.mp4",
  decisionLog: [
    { type: "budget_check", data: { passed: true, estimate: 0.50 } },
    { type: "provider_selection", data: { selected: "nvidia", scores: {...} } },
    { type: "pre_compose_gate", data: { passed: true } },
    { type: "post_render_gate", data: { passed: true } },
    { type: "final_qa", data: { passed: true, metrics: {...} } }
  ],
  qa: {
    preCompose: true,
    postRender: true,
    finalQA: true
  }
}
```

## Files

- `src/v2.1/video-factory.js` — основная фабрика с scoring и quality gates
- `src/v2.1/video-production-pipeline.js` — базовый пайплайн
- `src/renderers/ffmpeg-video-renderer.js` — FFmpeg-рендерер
- `scripts/factory-video-cli.js` — CLI для запуска
- `config/video-factory.json` — конфигурация
- `docs/VIDEO_PIPELINE.md` — документация

## TODO / Next Steps

1. **Реализовать FFmpeg-рендерер полностью**
   - Сохранение изображений из base64
   - Сохранение аудио из buffer
   - Реальное выполнение FFmpeg
   - Текст overlay (субтитры, branding)
   - Переходы между сценами

2. **Реализовать хранилище**
   - Local filesystem
   - S3 integration
   - CDN integration (опционально)

3. **Улучшить scoring провайдеров**
   - Реальные метрики для каждого измерения
   - Кэширование результатов scoring
   - Адаптивные веса

4. **Добавить API endpoint**
   - `POST /factory/video`
   - Async job processing
   - Status endpoint: `GET /factory/video/:jobId`

5. **Добавить WebUI**
   - Next.js dashboard
   - Форма для создания видео
   - Галерея сгенерированных видео

6. **Тесты на реальных сценариях**
   - Генерация видео для Now
   - Генерация видео для Attune
   - Генерация видео для luxuryitaly.net

## Branch

`feat/v2.1-video-pipeline-perplexity`

## Integration with Main

После тестирования и валидации:

1. Протестировать с реальной генерацией видео
2. Исправить ошибки
3. Открыть PR в `main`
4. Merge после approval
