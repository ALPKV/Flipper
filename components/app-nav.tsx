"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./brand";

const NAV = [
  { href: "/highlights", label: "Clip Farmer" },
  { href: "/tracking", label: "Speed Check" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white text-ink">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand href="/highlights" light={false} />
        <nav aria-label="Main">
          <ul className="flex gap-1">
            {NAV.map((item) => {
              const active = path === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-3 py-2 text-sm font-medium ${
                      active ? "bg-navy-100 text-navy" : "text-slate hover:bg-paper hover:text-ink"
                    }`}
                  >
                    {item.label}{item.href==="/tracking"?<span className="ml-2 hidden text-[10px] text-mute sm:inline">In progress</span>:null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
