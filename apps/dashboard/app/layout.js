import './globals.css';
import { LanguageProvider } from './lib/i18n';

export const metadata = {
  title: 'Content Factory',
  description: 'Create TikTok videos from your iPhone',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
