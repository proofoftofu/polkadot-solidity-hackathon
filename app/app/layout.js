import "./globals.css";

export const metadata = {
  title: "Agent Wallet Portal",
  description: "Minimal portal for scoped AI-agent wallet execution."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
