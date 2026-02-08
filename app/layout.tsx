import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Relay, a DevFest 2026 project',
  description: 'Vercel coordination backend with dependency graph polling UI',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
