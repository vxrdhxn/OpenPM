import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import './globals.css';
import { FeedbackProvider } from '@/components/ui/feedback';
import MotionLayer from '@/components/motion/MotionLayer';
import { THEME_SCRIPT } from '@/lib/theme';

// Display type for headings, a grotesk for reading, a mono for numbers and labels. The first two are
// variable fonts: with no `weight`, next/font serves one file per font that holds every weight,
// instead of one file per weight. Plex Mono is not variable, so it names the two weights it uses.
const sans = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'OpenPM - Modern Project Management',
  description: 'Self-hosted, real-time, open-source project management platform.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f4f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0f0f11' },
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
  // The theme script runs inline, before first paint, so it needs this request's nonce too.
  const csp = (await headers()).get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  return (
    // data-theme is set by the script before React hydrates, so React must not complain about it.
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates. This
          silences that mismatch for <body>'s own attributes only, not for anything inside it. */}
      <body className="font-sans min-h-screen antialiased" suppressHydrationWarning>
        <FeedbackProvider>{children}</FeedbackProvider>
        <MotionLayer />
      </body>
    </html>
  );
}
