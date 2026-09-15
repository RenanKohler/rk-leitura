"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers";
import { useState } from "react";

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    label: "My Texts",
    href: "/texts",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.962 8.962 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.962 8.962 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.962 8.962 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    label: "Reading History",
    href: "/history",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.38-.084.75-.384.917l-.822.764c-.273.255-.588.47-.919.632l-.913.184c-.615.126-.953.615-.822 1.138l.264.08c.38.126.726.273 1.021.454l.713.808c.308.345.59.718.78 1.124l.15.406c.11.306.237.597.375.873c.09.18.186.35.298.504c.076.112.15.222.222.328c.072.11.136.216.192.322c.036.068.072.134.1.2c.022.048.036.094.048.14l.03.14c.012.06.012.12.005.18l-.01.06c-.007.06-.02.12-.04.176c-.02.06-.045.116-.075.17c-.025.048-.05.09-.078.13l-.108.118c-.084.09-.175.17-.273.242l-.39.284c-.208.15-.448.27-.71.35l-.845.294c-.542.19-1.018.3-1.433.33l-.765.06c-.47.04-.88.04-1.225-.08l-.568-.194c-.345-.115-.64-.28-.88-.49c-.24-.21-.4-.45-.49-.72c-.09-.27-.115-.56-.08-.86l.06-.41c.03-.22.12-.4.25-.54l.39-.405c.13-.135.28-.245.45-.33l.595-.282c.33-.156.7-.268 1.09-.33l.89-.126c.615-.086 1.138-.126 1.562-.126h2.75c.434 0 .79.04 1.07.126l.625.168c.35.094.625.224.825.39l.485.402c.2.166.34.366.42.594c.06.16.105.325.135.494c.02.11.03.22.03.33c0 .11 0 .22-.005.33l-.01.11c-.005.055-.01.11-.02.164c-.007.037-.015.074-.025.11l-.03.115c-.008.034-.018.066-.03.098l-.035.098c-.012.03-.025.057-.04.084l-.045.08c-.015.025-.03.048-.048.07c-.017.02-.035.038-.055.055c-.022.017-.045.032-.07.046c-.025.014-.05.026-.077.037c-.03.01-.06.018-.09.024c-.03.006-.06.012-.09.015c-.03.003-.06.006-.09.007c-.015.001-.03.002-.045.002l-.09-.054c-.045-.005-.09-.012-.134-.02l-.105-.024c-.045-.008-.09-.018-.135-.027c-.045-.01-.09-.02-.135-.028c-.045-.01-.09-.018-.135-.028c-.06-.014-.118-.026-.174-.037c-.028-.006-.056-.01-.084-.015c-.028-.005-.056-.01-.084-.014c-.028-.004-.056-.008-.084-.012l-.084-.012c-.042-.005-.084-.008-.126-.01c-.0165-.001-.033-.002-.05-.002l-.095-.002c-.047 0-.095-.001-.143-.002c-.047 0-.095-.001-.143-.002c-.048-.001-.095-.002-.143-.003l-.095-.002c-.024-.001-.048-.002-.072-.003l-.024-.001c-.024-.001-.048-.002-.072-.003l-.024-.001c-.024-.001-.048-.002-.072-.003" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen bg-white border-r border-slate-200 transition-all duration-300 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className={`flex items-center border-b border-slate-100 p-4 ${collapsed ? "justify-center" : "justify-between"}`}>
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md group-hover:shadow-lg transition-shadow">
              <svg className="h-5 w-5 font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            {!collapsed && (
              <span className="text-lg font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                Wordrunner
              </span>
            )}
          </Link>
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-4.59 3.33m0 0l-4.59-3.33m4.59 3.33V8.58m4.59 3.33v-4.5a2.25 2.25 0 00-2.25-2.25h-4.5a2.25 2.25 0 00-2.25 2.25v4.5a2.25 2.25 0 002.25 2.25h4.5a2.25 2.25 0 002.25-2.25v-1.5" />
              </svg>
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <span className={`flex-shrink-0 transition-colors ${isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"}`}>
                  {item.icon}
                </span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-100 p-3">
          {collapsed ? (
            <div className="flex items-center justify-center rounded-lg bg-slate-50 p-2" title={user?.name}>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-medium">
                {user?.name?.charAt(0) || "U"}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-sm font-medium">
                {user?.name?.charAt(0) || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{user?.name || "User"}</p>
                <p className="truncate text-xs text-slate-500">{user?.email || ""}</p>
              </div>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors"
                title="Logout"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
