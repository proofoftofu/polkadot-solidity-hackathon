import "./globals.css";

export const metadata = {
  title: "Secure Agent Wallet Hub",
  description: "Design prototype for managing secure wallet session keys for AI agents."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
