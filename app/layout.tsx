import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "함수의 감각 | 이차함수 그래프 미션",
  description: "학생이 직접 탐색하며 이차함수 그래프 감각을 익히는 맞춤형 학습 미션.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
