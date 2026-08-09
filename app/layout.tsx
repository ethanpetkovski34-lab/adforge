import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AdForge — AI ads from your real product',
  description:
    'Upload a clip or paste your link, and AI turns it into a cinematic ad with narration, kinetic text and effects. Free to try.',
  icons: { icon: '/icon-192.png', apple: '/icon-512.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#05060f', color: '#e8edff', fontFamily: 'ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
