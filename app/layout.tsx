import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Flipper", template: "%s · Flipper" },
  description:
    "Turn net-session recordings into editable sound-triggered clips. Your videos stay on your device.",
};

export const viewport: Viewport = { themeColor: "#f4f4ef" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
