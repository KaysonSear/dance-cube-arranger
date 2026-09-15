import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "舞立方谱面编辑器",
  description: "Malody V 舞立方(mode:9)谱面生成、评价与可视化编辑工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full bg-parchment text-ink antialiased">{children}</body>
    </html>
  );
}
