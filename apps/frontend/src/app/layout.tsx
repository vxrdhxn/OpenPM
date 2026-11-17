import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/feedback';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OpenPM - Modern Project Management',
  description: 'Self-hosted, real-time, open-source project management platform.',
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
    <html lang="en">
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates. This
          silences that mismatch for <body>'s own attributes only, not for anything inside it. */}
      <body className={`${inter.className} min-h-screen antialiased`} suppressHydrationWarning>
        <FeedbackProvider>{children}</FeedbackProvider>
      </body>
    </html>
  );
}
