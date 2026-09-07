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
  metadataBase: new URL('https://fo-pilot-risk-engine.basic-duck-9530.chatgpt.site'),
  title: 'F&O Pilot — Decision Engine',
  description: 'Risk-first NIFTY futures and options decision engine.',
  openGraph: {
    title: 'F&O Pilot',
    description: 'Risk-first F&O decision engine',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'F&O Pilot risk-first decision engine' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'F&O Pilot',
    description: 'Risk-first F&O decision engine',
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
