import "./globals.css";

export const metadata = {
  title: "Companion Wallet UI Experiment",
  description: "Design prototype for a supportive AI wallet portal."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
