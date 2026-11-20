import type { Metadata, Viewport } from 'next';
import { Inter, Plus_Jakarta_Sans } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/feedback';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['600', '700', '800'] });

export const metadata: Metadata = {
  title: 'OpenPM - Modern Project Management',
  description: 'Self-hosted, real-time, open-source project management platform.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is rendered per request, never prerendered at build time: its scripts need this
  // request's CSP nonce (proxy.ts), and a page built in advance would carry none, so it would not run.
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates. This
          silences that mismatch for <body>'s own attributes only, not for anything inside it. */}
      <body className="font-sans min-h-screen antialiased" suppressHydrationWarning>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
