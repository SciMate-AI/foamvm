import type { Metadata } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: 'PhysicsOS Cloud | 物理仿真云端运行平台',
  description: 'PhysicsOS Cloud provides invite-gated physics simulation runners, starting with CFD/OpenFOAM and CLI device-code access.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html className="h-full" lang="zh-CN">
      <body className="min-h-full bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  )
}
