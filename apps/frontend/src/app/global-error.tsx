'use client';

/**
 * Last resort: the root layout itself failed, so this renders its own <html>. No app styles or
 * providers can be relied on here, hence the inline styles.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div role="alert" style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 24 }}>OpenPM could not load</h1>
          <p style={{ color: '#475569' }}>Something went wrong while starting the app.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
