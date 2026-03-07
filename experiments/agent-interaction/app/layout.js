import "./globals.css";

export const metadata = {
  title: "Agent Interaction Experiment",
  description: "Prototype portal for agent-scoped wallet sessions."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
