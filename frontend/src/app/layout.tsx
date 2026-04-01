import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import '../globals.css';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'IERG4340 Paper Trading Bot',
  description: 'Multi-strategy paper trading system with covered calls, stock screening, and forex trading',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Some browser extensions inject attributes into html/body before React hydrates.
    // Keep this to avoid noisy false-positive hydration mismatch warnings.
    <html lang="en" suppressHydrationWarning>
      <body className={spaceGrotesk.className} suppressHydrationWarning>{children}</body>
    </html>
  );
}
