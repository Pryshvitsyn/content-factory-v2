# Как использовать Content Factory API (Полное руководство)

Кроссплатформенное руководство по созданию видео для TikTok, Instagram и YouTube на Mac, Windows, Linux, iPhone и Android.

> API создает записи о производстве контента и ставит в очередь задачу генерации скрипта. Worker затем обрабатывает задачу используя PostgreSQL и вашу NVIDIA API конфигурацию.

## Содержание

1. [Перед началом](#перед-началом)
2. [Выберите вашу платформу](#выберите-вашу-платформу)
3. [Быстрый старт по платформам](#быстрый-старт-по-платформам)
4. [Docker настройка (рекомендуется)](#docker-настройка-рекомендуется)
5. [Нативная настройка (Mac/Linux)](#нативная-настройка-maclinux)
6. [Нативная настройка (Windows)](#нативная-настройка-windows)
7. [Мобильная настройка (iPhone/Android)](#мобильная-настройка-iphoneandroid)
8. [Создание бизнес данных](#создание-бизнес-данных)
9. [Создание видео продукции](#создание-видео-продукции)
10. [Запуск Worker](#запуск-worker)
11. [Просмотр ваших видео](#просмотр-ваших-видео)
12. [Предпросмотр видео](#предпросмотр-видео)
13. [Одобрение и публикация](#одобрение-и-публикация)
14. [API Endpoints](#api-endpoints)
15. [Устранение неполадок](#устранение-неполадок)

---

## Перед началом

### Требования

**Для нативной настройки:
- Node.js 18 или новее — https://nodejs.org
- PostgreSQL 15 или новее — https://www.postgresql.org
- Git — https://git-scm.com

**Для Docker настройки:
- Docker Desktop — https://www.docker.com
  - Windows: Включите WSL2 backend
  - Mac: Docker Desktop для Mac
  - Linux: Docker Engine + Compose

**Для мобильных:
- iPhone (iOS 14+) или Android (8+)
- Та же WiFi сеть что и ваш компьютер
- Safari (iPhone) или Chrome (Android)

### Получите ваш NVIDIA API Key

1. Перейдите на https://build.nvidia.com
2. Зарегистрируйтесь или войдите
3. Перейдите в API Keys
4. Скопируйте ваш API key

Никогда не коммитьте реальные credentials. Храните их только в локальных `.env` файлах.

---

## Выберите вашу платформу

| Платформа | Рекомендуемый метод | Время настройки |
|-----------|-------------------|----------------|
| **Mac** | Native (setup.sh) или Docker | 5 минут |
| **Windows** | Docker (проще) или Native (setup.bat) | 10 минут |
| **Linux** | Native (setup.sh) или Docker | 5 минут |
| **iPhone** | PWA (Add to Home Screen) | 2 минуты |
| **Android** | PWA (Add to Home Screen) | 2 минуты |

---

## Быстрый старт по платформам

### Mac (быстрее всего)

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Запустите setup скрипт
chmod +x setup.sh
./setup.sh

# 3. Отредактируйте конфигурацию
nano apps/api/.env        # Добавьте NVIDIA_API_KEY
nano apps/dashboard/.env  # Добавьте BUSINESS_ID, BRAND_ID (из вывода setup)

# 4. Запустите все сервисы
./start.sh

# 5. Откройте браузер
http://localhost:3000
```

### Windows (просто)

```powershell
# 1. Клонируйте репозиторий
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Запустите setup скрипт
.\setup.bat

# 3. Отредактируйте конфигурацию
notepad apps\api\.env        # Добавьте NVIDIA_API_KEY
notepad apps\dashboard\.env  # Добавьте BUSINESS_ID, BRAND_ID (из вывода setup)

# 4. Запустите все сервисы
.\start.bat

# 5. Откройте браузер
http://localhost:3000
```

### Linux (быстро)

```bash
# Как и Mac
chmod +x setup.sh
./setup.sh
./start.sh
```

### Docker (любая платформа - наиболее надежно)

```bash
# 1. Клонируйте репозиторий
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant

# 2. Скопируйте и отредактируйте environment файл
cp .env.example .env
nano .env  # Добавьте NVIDIA_API_KEY, BUSINESS_ID, BRAND_ID

# 3. Запустите все
docker-compose up

# 4. Откройте браузер
http://localhost:3000
```

### iPhone/Android (мобильные)

1. **Запустите на вашем компьютере сначала** (см. выше)
2. **Найдите IP вашего компьютера:**
   - Mac: `ipconfig getifaddr en0`
   - Windows: `ipconfig` (ищите IPv4)
3. **Обновите конфигурацию dashboard:**
   ```bash
   # Отредактируйте apps/dashboard/.env
   NEXT_PUBLIC_API_URL=http://ВАШ_IP:3001
   ```
4. **Перезапустите dashboard**
5. **На мобильном, откройте:** `http://ВАШ_IP:3000`
6. **Добавьте на домашний экран:**
   - iPhone: Share → Add to Home Screen
   - Android: ⋮ menu → Add to Home screen
7. **Используйте как нативное приложение!**

---

## Docker настройка (рекомендуется)

Docker - самый простой и надежный способ запуска Content Factory на любой платформе.

### Шаг 1: Установите Docker

- **Windows:** https://www.docker.com/products/docker-desktop/
  - Во время установки включите WSL2 backend
- **Mac:** https://www.docker.com/products/docker-desktop/
  - Стандартная установка
- **Linux:** https://docs.docker.com/engine/install/
  - Следуйте инструкциям для вашего дистрибутива

### Шаг 2: Клонируйте репозиторий

```bash
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Шаг 3: Настройте environment

```bash
cp .env.example .env
nano .env
```

Добавьте ваши значения:

```env
NVIDIA_API_KEY=nvapi-ваш-key-здесь
NEXT_PUBLIC_BUSINESS_ID=uuid-из-базы-данных
NEXT_PUBLIC_BRAND_ID=uuid-из-базы-данных
```

### Шаг 4: Запустите все сервисы

```bash
docker-compose up
```

Вы увидите:

```
✅ Database connected
🚀 API server running on http://localhost:3001
🏭 Worker started
📱 Dashboard running on http://localhost:3000
```

### Шаг 5: Откройте Dashboard

Откройте http://localhost:3000 в вашем браузере.

### Шаг 6: Остановите сервисы

```bash
docker-compose down
```

### Преимущества Docker

- ✅ Не нужна ручная установка Node.js/PostgreSQL
- ✅ Работает идентично на всех платформах
- ✅ Одна команда для запуска/остановки
- ✅ Готово к production
- ✅ Легко деплоить в cloud
- ✅ Изолировано от вашей системы

---

## Нативная настройка (Mac/Linux)

### Шаг 1: Установите требования

```bash
# Установите Node.js (macOS с Homebrew)
brew install node@18

# Установите PostgreSQL (macOS с Homebrew)
brew install postgresql@15
brew services start postgresql@15

# Установите Git (если не установлен)
brew install git
```

### Шаг 2: Клонируйте репозиторий

```bash
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Шаг 3: Запустите setup скрипт

```bash
chmod +x setup.sh
./setup.sh
```

Скрипт:
- ✅ Проверит Node.js и PostgreSQL
- ✅ Установит API зависимости
- ✅ Установит Dashboard зависимости
- ✅ Создаст базу данных
- ✅ Запустит миграции
- ✅ Создаст тестовые бизнес/бренд данные
- ✅ Покажет вам UUID для копирования

### Шаг 4: Отредактируйте конфигурацию

Сохраните UUID из вывода setup, затем:

```bash
nano apps/api/.env
```

Добавьте ваш NVIDIA API key:

```env
DATABASE_URL=postgresql://localhost:5432/content_factory
NVIDIA_API_KEY=nvapi-ваш-key-здесь
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

```bash
nano apps/dashboard/.env
```

Добавьте ваши UUIDs:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=вставьте-business-uuid-здесь
NEXT_PUBLIC_BRAND_ID=вставьте-brand-uuid-здесь
```

### Шаг 5: Запустите все сервисы

```bash
./start.sh
```

Вы увидите:

```
🚀 Starting API server...
✅ API started
🔨 Starting worker...
✅ Worker started
📱 Starting dashboard...
✅ Dashboard started

Откройте ваш браузер: http://localhost:3000
```

### Шаг 6: Откройте Dashboard

Откройте http://localhost:3000 в вашем браузере.

---

## Нативная настройка (Windows)

### Шаг 1: Установите требования

- **Node.js 18+:** https://nodejs.org (скачайте Windows installer)
- **PostgreSQL 15+:** https://www.postgresql.org/download/windows/
- **Git:** https://git-scm.com/download/win

Во время установки PostgreSQL:
- Запомните пароль который установили
- Оставьте порт по умолчанию (5432)

### Шаг 2: Клонируйте репозиторий

Откройте PowerShell или Git Bash:

```powershell
git clone https://github.com/Pryshvitsyn/content-factory-v2.git
cd content-factory-v2
git checkout feature/perplexity-multi-tenant
```

### Шаг 3: Запустите setup скрипт

```powershell
.\setup.bat
```

Скрипт:
- ✅ Проверит Node.js и PostgreSQL
- ✅ Установит API зависимости
- ✅ Установит Dashboard зависимости
- ✅ Создаст базу данных
- ✅ Запустит миграции
- ✅ Создаст тестовые бизнес/бренд данные
- ✅ Покажет вам UUID для копирования

### Шаг 4: Отредактируйте конфигурацию

Сохраните UUIDs из вывода setup, затем:

Откройте Notepad:
```powershell
notepad apps\api\.env
```

Добавьте ваш NVIDIA API key:

```env
DATABASE_URL=postgresql://localhost:5432/content_factory
NVIDIA_API_KEY=nvapi-ваш-key-здесь
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
PORT=3001
NODE_ENV=development
```

```powershell
notepad apps\dashboard\.env
```

Добавьте ваши UUIDs:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_BUSINESS_ID=вставьте-business-uuid-здесь
NEXT_PUBLIC_BRAND_ID=вставьте-brand-uuid-здесь
```

### Шаг 5: Запустите все сервисы

```powershell
.\start.bat
```

Три терминальных окна откроются:
- API Server (порт 3001)
- Worker (обрабатывает задачи)
- Dashboard (порт 3000)

### Шаг 6: Откройте Dashboard

Откройте http://localhost:3000 в вашем браузере.

---

## Мобильная настройка (iPhone/Android)

### Шаг 1: Запустите на вашем компьютере

Сначала запустите систему на вашем компьютере используя один из методов выше.

### Шаг 2: Найдите IP адрес вашего компьютера

**Mac:**
```bash
ipconfig getifaddr en0
# Пример: 192.168.1.100
```

**Windows:**
```powershell
ipconfig
# Ищите "IPv4 Address" под вашим WiFi адаптером
# Пример: 192.168.1.100
```

**Linux:**
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# Пример: 192.168.1.100
```

### Шаг 3: Обновите конфигурацию Dashboard

```bash
# Отредактируйте apps/dashboard/.env
nano apps/dashboard/.env
```

Измените:
```env
NEXT_PUBLIC_API_URL=http://ВАШ_IP:3001
# Пример: NEXT_PUBLIC_API_URL=http://192.168.1.100:3001
```

### Шаг 4: Перезапустите Dashboard

```bash
cd apps/dashboard
npm run dev
```

### Шаг 5: Откройте на мобильном

**iPhone (Safari):**
1. Откройте Safari
2. Перейдите на `http://ВАШ_IP:3000`
3. Нажмите кнопку **Share** (квадрат со стрелкой)
4. Нажмите **Add to Home Screen**
5. Назовите "Content Factory"
6. Нажмите **Add**
7. Иконка приложения появится на домашнем экране
8. Нажмите чтобы открыть (полноэкранный режим, без UI браузера)

**Android (Chrome):**
1. Откройте Chrome
2. Перейдите на `http://ВАШ_IP:3000`
3. Нажмите **⋮** menu (три точки)
4. Нажмите **Add to Home screen**
5. Назовите "Content Factory"
6. Нажмите **Add**
7. Иконка приложения появится на домашнем экране
8. Нажмите чтобы открыть (полноэкранный режим, без UI браузера)

### Шаг 6: Используйте как нативное приложение

Теперь вы можете:
- ✅ Создавать видео с вашего телефона
- ✅ Смотреть предпросмотр видео
- ✅ Одобря и публиковать
- ✅ Доступ из любого места в той же сети

---

## Создание бизнес данных

Если вы использовали setup скрипты, тестовые данные уже созданы. Если нет, или если хотите создать свои:

### Используя SQL

```sql
-- Создать tenant
INSERT INTO tenants (name, slug)
VALUES ('My Factory', 'my-factory')
RETURNING id;

-- Создать business
INSERT INTO businesses (tenant_id, name, slug, industry)
VALUES ('TENANT_UUID', 'Roma Pizza', 'roma-pizza', 'food_beverage')
RETURNING id;

-- Создать brand
INSERT INTO brands (business_id, name, slug)
VALUES ('BUSINESS_UUID', 'Roma Pizza', 'roma-pizza')
RETURNING id;

-- Создать brand identity
INSERT INTO brand_identities (brand_id, tone, visual_language)
VALUES (
  'BRAND_UUID',
  'funny and local',
  '{"style":"warm_cinematic","lighting_type":"natural"}'::jsonb
);

-- Создать content universe (серия)
INSERT INTO content_universes (brand_id, name, type, format_rules)
VALUES (
  'BRAND_UUID',
  'Marco Explains Pizza',
  'series',
  '{"duration_ms":20000,"aspect_ratio":"9:16","hook_style":"unexpected","cta":"visit"}'::jsonb
)
RETURNING id;
```

Замените `TENANT_UUID`, `BUSINESS_UUID`, и `BRAND_UUID` на реальные ID.

### Получите ваши UUIDs

```sql
SELECT 
  b.id as business_id,
  br.id as brand_id
FROM businesses b
JOIN brands br ON br.business_id = b.id
WHERE b.slug = 'roma-pizza';
```

Скопируйте эти UUIDs для следующего шага.

---

## Создание видео продукции

### Используя Dashboard (проще всего)

1. Откройте http://localhost:3000 (или http://ВАШ_IP:3000 на мобильном)
2. Заполните форму:
   - **Topic:** "Why Roman pizza is thin"
   - **Platforms:** Выберите TikTok, Instagram, YouTube
   - **Series:** Опционально (оставьте пустым для первого видео)
3. Нажмите **Create Video**
4. Увидите сообщение об успехе ✅
5. Видео появится в секции "Your Videos"

### Используя curl (API)

```bash
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{
    "business_id": "BUSINESS_UUID",
    "brand_id": "BRAND_UUID",
    "topic": "Why Roman pizza is thin",
    "platforms": ["tiktok", "instagram", "youtube"]
  }'
```

Ответ:

```json
{
  "id": "PRODUCTION_UUID",
  "status": "queued",
  "message": "Production created. Script generation started."
}
```

### Обязательные поля

| Поле | Описание |
|---|---|
| `business_id` | UUID бизнеса которому принадлежит продукция |
| `brand_id` | UUID релевантного бренда |
| `topic` | Идея видео; минимум 10 символов |
| `platforms` | Одно или более из `tiktok`, `instagram`, `youtube` |

### Опциональные поля

| Поле | Описание |
|---|---|
| `series_id` | UUID content universe / повторяющейся серии |
| `audience_id` | UUID целевой аудитории |
| `product_id` | UUID продукта или сервиса |

---

## Запуск Worker

Worker обрабатывает задачи автоматически. Если вы использовали setup скрипты или Docker, он уже запущен.

### Ручной запуск (если нужно)

```bash
export DATABASE_URL='postgresql://localhost:5432/content_factory'
export NVIDIA_API_KEY='ваш-nvidia-api-key'
export NVIDIA_BASE_URL='https://integrate.api.nvidia.com/v1'
node worker/factory-worker-v2.js
```

Вы увидите:

```
🏭 Content Factory Worker v2.1 started
📊 Polling for jobs...
🔨 Claimed job SCRIPT_GENERATION for production abc-123
📝 Generated script for abc-123
✅ Job completed
```

---

## Просмотр ваших видео

### Используя Dashboard

1. Откройте http://localhost:3000
2. Прокрутите к секции "Your Videos"
3. Увидите все видео с:
   - Status badges (queued, in_progress, completed)
   - Platform icons (🎵 TikTok, 📸 Instagram, 📺 YouTube)
   - Created date
   - Video thumbnails

### Используя curl (API)

```bash
curl "http://localhost:3001/api/productions?business_id=BUSINESS_UUID"
```

Ответ:

```json
[
  {
    "id": "PRODUCTION_UUID",
    "title": "Why Roman pizza is thin",
    "status": "completed",
    "created_at": "2026-08-16T00:00:00Z",
    "platforms": ["tiktok", "instagram"]
  }
]
```

---

## Предпросмотр видео

### Смотрите видео в Dashboard

1. Откройте http://localhost:3000
2. Найдите ваше видео в "Your Videos"
3. Нажмите на video thumbnail
4. Video player откроется на весь экран
5. Controls:
   - ▶️ Play/Pause
   - ⏭️ Progress bar (перетяните для поиска)
   - ⏱️ Time display
   - ⊞ Fullscreen
   - ✕ Close

### Мобильный предпросмотр видео

1. Откройте приложение на iPhone/Android
2. Нажмите на video thumbnail
3. Видео воспроизводится на весь экран
4. Нажмите чтобы показать/скрыть controls
5. Свайп вниз чтобы закрыть

---

## Одобрение и публикация

### Одобрить продукцию

**Dashboard:**
1. Когда статус видео "completed"
2. Нажмите кнопку **Approve**
3. Статус изменится на "approved"

**API:**
```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/approve
```

### Опубликовать продукцию

**Dashboard:**
1. Когда статус видео "approved"
2. Нажмите кнопку **Publish**
3. Статус изменится на "published"

**API:**
```bash
curl -X POST http://localhost:3001/api/productions/PRODUCTION_UUID/publish \
  -H "Content-Type: application/json" \
  -d '{
    "platforms": ["tiktok", "instagram"],
    "scheduled_at": "2026-08-16T18:00:00Z"
  }'
```

---

## API Endpoints

| Method | Endpoint | Назначение |
|---|---|---|
| `GET` | `/health` | Подтвердить что API server запущен |
| `POST` | `/api/productions` | Создать продукцию и поставить в очередь генерацию скрипта |
| `GET` | `/api/productions?business_id=...` | Получить список продукции бизнеса |
| `GET` | `/api/productions/:id` | Получить статус продукции, jobs, artifacts, и editions |
| `POST` | `/api/productions/:id/approve` | Отметить продукцию как approved |
| `POST` | `/api/productions/:id/publish` | Создать scheduled publication records |

### Тест API

```bash
# Health check
curl http://localhost:3001/health

# Создать продукцию
curl -X POST http://localhost:3001/api/productions \
  -H "Content-Type: application/json" \
  -d '{"business_id":"UUID","brand_id":"UUID","topic":"Test video","platforms":["tiktok"]}'

# Получить список продукции
curl "http://localhost:3001/api/productions?business_id=UUID"

# Получить детали продукции
curl http://localhost:3001/api/productions/PRODUCTION_UUID
```

---

## Устранение неполадок

### Порт уже используется

**Mac/Linux:**
```bash
# Найти процесс
lsof -i :3000
lsof -i :3001

# Убить процесс
kill -9 <PID>
```

**Windows:**
```powershell
# Найти процесс
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# Убить процесс
taskkill /PID <PID> /F
```

### PostgreSQL Connection Error

**Проверьте запущен ли PostgreSQL:**

```bash
# Mac/Linux
pg_isready

# Windows
pg_isready -h localhost
```

**Запустите PostgreSQL:**

```bash
# Mac (Homebrew)
brew services start postgresql@15

# Windows
net start postgresql-x64-15

# Linux
sudo systemctl start postgresql
```

### Docker Issues

```bash
# Проверьте Docker запущен
docker ps

# Пересоберите контейнеры
docker-compose down
docker-compose up --build

# Посмотрите логи
docker-compose logs -f

# Удалите все контейнеры и volumes
docker-compose down -v
docker-compose up
```

### Мобильный не может подключиться

1. Убедитесь что компьютер и мобильный на одной WiFi сети
2. Проверьте firewall разрешает порт 3000 и 3001:
   - Mac: System Preferences → Security → Firewall
   - Windows: Windows Defender Firewall → Allow an app
3. Используйте локальный IP компьютера (не localhost)
4. Перезапустите dashboard после изменения .env
5. Попробуйте открыть сначала в браузере компьютера

### NVIDIA API Fails

1. Проверьте `NVIDIA_API_KEY` присутствует в .env
2. Проверьте key действителен на https://build.nvidia.com
3. Проверьте логи worker на сообщения об ошибках
4. Проверьте имя модели соответствует NVIDIA endpoint

### Worker не берет задачи

```sql
-- Проверьте queued jobs
SELECT id, production_id, job_type, status, attempts, created_at
FROM jobs
ORDER BY created_at DESC;

-- Проверьте DATABASE_URL установлен в worker терминале
```

### Dashboard показывает "Failed to load productions"

1. Проверьте API server запущен: http://localhost:3001/health
2. Проверьте `NEXT_PUBLIC_BUSINESS_ID` в dashboard .env
3. Проверьте консоль браузера на ошибки (F12)
4. Убедитесь API и dashboard в одной сети

---

## Следующие шаги

Когда все работает:

1. ✅ Создайте ваше первое видео из dashboard
2. ✅ Смотрите как worker генерирует скрипт
3. ✅ Предпросмотр видео в dashboard
4. ✅ Одобрите и опубликуйте в TikTok
5. ✅ Добавьте authentication для доступа команды
6. ✅ Deploy в cloud (Vercel + Railway)
7. ✅ Настройте автоматическую публикацию

---

## Документация

- **Quick Start:** Смотрите `README.md`
- **Architecture:** Смотрите `ARCHITECTURE_CONTRACT_V2.1_MULTI_TENANT.md`
- **API Reference:** Смотрите `apps/api/README.md`
- **Dashboard:** Смотрите `apps/dashboard/README.md`

---

## Поддержка

Для вопросов или проблем:
- Проверьте секцию troubleshooting выше
- Просмотрите файлы документации
- Откройте GitHub issue
