'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const LanguageContext = createContext();

// Translations
const translations = {
  en: {
    app: {
      title: 'Content Factory',
      subtitle: 'Create TikTok videos from your iPhone',
    },
    form: {
      title: 'Create New Video',
      topicLabel: "What's the video about?",
      topicPlaceholder: 'e.g., Why Roman pizza is thin',
      topicHint: 'Minimum 10 characters',
      platformsLabel: 'Platforms',
      seriesLabel: 'Series (optional)',
      seriesPlaceholder: 'Series UUID',
      createButton: 'Create Video',
      creatingButton: 'Creating...',
      success: '✅ Video created!',
    },
    list: {
      title: 'Your Videos',
      loading: 'Loading...',
      empty: 'No videos yet. Create your first one!',
      error: 'Failed to load productions. Is the API server running?',
      businessIdError: 'Business ID not configured. Set NEXT_PUBLIC_BUSINESS_ID in .env',
    },
    card: {
      created: 'Created',
      videos: 'Videos',
      approve: 'Approve',
      approving: 'Approving...',
      publish: 'Publish',
      publishing: 'Publishing...',
      platforms: {
        tiktok: '🎵 TikTok',
        instagram: '📸 Instagram',
        youtube: '📺 YouTube',
      },
      status: {
        queued: 'queued',
        in_progress: 'in progress',
        completed: 'completed',
        approved: 'approved',
        published: 'published',
      },
    },
    language: {
      label: 'Language',
      en: 'English',
      ru: 'Русский',
      it: 'Italiano',
    },
  },
  ru: {
    app: {
      title: 'Content Factory',
      subtitle: 'Создавайте TikTok видео с iPhone',
    },
    form: {
      title: 'Создать новое видео',
      topicLabel: 'О чем видео?',
      topicPlaceholder: 'например, Почему римская пицца тонкая',
      topicHint: 'Минимум 10 символов',
      platformsLabel: 'Платформы',
      seriesLabel: 'Серия (опционально)',
      seriesPlaceholder: 'UUID серии',
      createButton: 'Создать видео',
      creatingButton: 'Создание...',
      success: '✅ Видео создано!',
    },
    list: {
      title: 'Ваши видео',
      loading: 'Загрузка...',
      empty: 'Пока нет видео. Создайте первое!',
      error: 'Не удалось загрузить. API сервер запущен?',
      businessIdError: 'Business ID не настроен. Установите NEXT_PUBLIC_BUSINESS_ID в .env',
    },
    card: {
      created: 'Создано',
      videos: 'Видео',
      approve: 'Одобрить',
      approving: 'Одобрение...',
      publish: 'Опубликовать',
      publishing: 'Публикация...',
      platforms: {
        tiktok: '🎵 TikTok',
        instagram: '📸 Instagram',
        youtube: '📺 YouTube',
      },
      status: {
        queued: 'в очереди',
        in_progress: 'в процессе',
        completed: 'готово',
        approved: 'одобрено',
        published: 'опубликовано',
      },
    },
    language: {
      label: 'Язык',
      en: 'English',
      ru: 'Русский',
      it: 'Italiano',
    },
  },
  it: {
    app: {
      title: 'Content Factory',
      subtitle: 'Crea video TikTok dal tuo iPhone',
    },
    form: {
      title: 'Crea Nuovo Video',
      topicLabel: 'Di cosa parla il video?',
      topicPlaceholder: 'es. Perché la pizza romana è sottile',
      topicHint: 'Minimo 10 caratteri',
      platformsLabel: 'Piattaforme',
      seriesLabel: 'Serie (opzionale)',
      seriesPlaceholder: 'UUID Serie',
      createButton: 'Crea Video',
      creatingButton: 'Creazione...',
      success: '✅ Video creato!',
    },
    list: {
      title: 'I Tuoi Video',
      loading: 'Caricamento...',
      empty: 'Nessun video. Crea il primo!',
      error: 'Impossibile caricare. Il server API è in esecuzione?',
      businessIdError: 'Business ID non configurato. Imposta NEXT_PUBLIC_BUSINESS_ID in .env',
    },
    card: {
      created: 'Creato',
      videos: 'Video',
      approve: 'Approva',
      approving: 'Approvazione...',
      publish: 'Pubblica',
      publishing: 'Pubblicazione...',
      platforms: {
        tiktok: '🎵 TikTok',
        instagram: '📸 Instagram',
        youtube: '📺 YouTube',
      },
      status: {
        queued: 'in coda',
        in_progress: 'in corso',
        completed: 'completato',
        approved: 'approvato',
        published: 'pubblicato',
      },
    },
    language: {
      label: 'Lingua',
      en: 'English',
      ru: 'Русский',
      it: 'Italiano',
    },
  },
};

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    // Load saved language or detect from browser
    const saved = localStorage.getItem('language');
    if (saved && ['en', 'ru', 'it'].includes(saved)) {
      setLanguage(saved);
    } else {
      // Auto-detect from browser
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith('ru')) {
        setLanguage('ru');
      } else if (browserLang.startsWith('it')) {
        setLanguage('it');
      }
    }
  }, []);

  function changeLanguage(lang) {
    setLanguage(lang);
    localStorage.setItem('language', lang);
  }

  const t = (keyPath) => {
    const keys = keyPath.split('.');
    let value = translations[language];
    for (const key of keys) {
      value = value?.[key];
    }
    return value || keyPath;
  };

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
}
