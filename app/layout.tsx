import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paul's Running",
  description: "Personal running platform for planning, analysis and Garmin delivery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
