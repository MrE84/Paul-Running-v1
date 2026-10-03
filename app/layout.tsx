import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paul's Running",
  description: "Personal running platform for planning, analysis and Garmin delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="siteHeader">
          <Link className="siteBrand" href="/">Paul&apos;s Running</Link>
          <nav className="siteNav" aria-label="Main navigation">
            <Link href="/">Home</Link>
            <Link href="/training-calendar">Calendar</Link>
            <Link href="/training-plans">Plans</Link>
            <Link href="/master-plan">Master plan</Link>
            <Link href="/athlete-profile">Athlete profile</Link>
            <Link href="/activity-analysis">Activity analysis</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
