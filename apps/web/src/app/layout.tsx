import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IoT Platform",
  description: "Device fleet dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
