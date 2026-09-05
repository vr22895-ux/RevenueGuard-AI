import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/shared/Navbar';

export const metadata: Metadata = {
  title: 'RevenueGuard AI — Revenue Recovery Agent',
  description:
    'AI-powered revenue recovery agent that detects at-risk payments, diagnoses root causes, and executes bounded recovery workflows with full audit trails.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
