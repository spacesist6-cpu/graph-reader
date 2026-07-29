import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "그래프 리더 | Graph Reader · Graph Leader",
  description: "함수식의 계수를 읽고 그래프의 변화를 탐구하는 중학교 3학년 이차함수 맞춤형 학습 앱",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
