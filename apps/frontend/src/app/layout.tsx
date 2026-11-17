import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/feedback';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'OpenPM - Modern Project Management',
  description: 'Self-hosted, real-time, open-source project management platform.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
