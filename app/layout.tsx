import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "度昂订单协作中台",
  description: "订单汇总、多人跟进、MES核对与客户交期报表。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: { url: "/brand/doon-eyewear-manufacturing.jpg", type: "image/jpeg" },
    shortcut: "/brand/doon-eyewear-manufacturing.jpg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
