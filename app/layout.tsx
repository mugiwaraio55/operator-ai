import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'Operator AI — Sales Manager & Media Buyer',
  description: 'A focused AI command center for sales coaching and Meta Ads performance.',
  openGraph: {
    title: 'Operator AI — Sales Manager & Media Buyer',
    description: 'Run sales coaching and Meta Ads decisions from one focused command center.',
    images: [{ url: '/og.png', width: 1734, height: 907, alt: 'Operator AI — AI Sales Manager and AI Media Buyer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Operator AI — Sales Manager & Media Buyer',
    description: 'Run sales coaching and Meta Ads decisions from one focused command center.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
